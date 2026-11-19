import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import { installCopyResolver, MAX_MEDIA_BYTES } from '#shared';
import { resolveSession, SESSION_COOKIE } from './auth/sessions.ts';
import type { AppContext } from './context.ts';
import { createLiveCopy, readCatalog, type LiveCopy } from './lib/copy.ts';
import { forbidden, HttpError } from './lib/errors.ts';
import { anthropicBatches } from './lib/loracle/client.ts';
import { createDawnLane, type DawnLane } from './lib/loracle/dawn.ts';
import { createWishJobs, type WishJobs } from './lib/loracle/jobs.ts';
import { mindFor } from './lib/loracle/mind.ts';
import { setMediaUrlSecret } from './lib/mediaUrls.ts';
import { safeErr } from './lib/safeLog.ts';
import { accountRoutes } from './routes/account.ts';
import { appUpdateRoutes } from './routes/appUpdates.ts';
import { authRoutes } from './routes/auth.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { commentRoutes } from './routes/comments.ts';
import { copyRoutes } from './routes/copy.ts';
import { crewRoutes } from './routes/crews.ts';
import { eventRoutes } from './routes/events.ts';
import { friendRoutes } from './routes/friends.ts';
import { homeRoutes } from './routes/home.ts';
import { ideaRoutes } from './routes/ideas.ts';
import { loracleRoutes, mindState } from './routes/loracle.ts';
import { mapRoutes } from './routes/map.ts';
import { mediaRoutes } from './routes/media.ts';
import { noteRoutes } from './routes/notes.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { oracleRoutes } from './routes/oracle.ts';
import { personalRoutes } from './routes/personal.ts';
import { safetyRoutes } from './routes/safety.ts';
import { userRoutes } from './routes/users.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'fastify' {
  interface FastifyInstance {
    /** The Loracle's background jobs (tests: `await app.wishJobs.idle()`). */
    wishJobs: WishJobs;
    /** The Loracle's dawn lane (phase B): Message Batches read by the hourly tick. */
    dawn: DawnLane;
    /** Live text: the owner's published words (lib/copy.ts). */
    liveCopy: LiveCopy;
  }
}

export async function buildApp(appCtx: AppContext) {
  const { config, db } = appCtx;
  const app = Fastify({
    // Errors are logged without the values bound to a failed query (lib/safeLog.ts).
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel, serializers: { err: safeErr } },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: false });

  app.decorateRequest('userId', null);
  app.decorateRequest('sessionToken', null);

  setMediaUrlSecret(config.mediaUrlSecret);

  // Live text: the owner's published words, from the database into memory, checked against the
  // served build's catalog of texts (production). After a deploy, words whose text moved to another
  // file follow it. Server messages and notification titles read them through copy() (#shared).
  const copyLog = app.log.child({ module: 'copy' });
  const copyCatalog =
    appCtx.copyCatalog !== undefined ? appCtx.copyCatalog : config.env === 'test' ? null : readCatalog(config.publicDir, copyLog);
  const liveCopy = createLiveCopy({ db, config, catalog: copyCatalog, log: copyLog });
  await liveCopy.load();
  if (liveCopy.checkCatalog && copyCatalog) {
    try {
      await liveCopy.followMoved();
    } catch (err) {
      copyLog.error({ err }, 'following moved words failed');
    }
  }
  app.decorate('liveCopy', liveCopy);
  const uninstallCopy = installCopyResolver(liveCopy.resolve);
  app.addHook('onClose', async () => uninstallCopy());

  // The Loracle's mind: the one passed in (tests), else Claude when a key is set, the dev fake when
  // LORACLE_MIND=fake, none while asleep. Made here so its lines (stages, cost, request ids, safety
  // faults; never text) reach the app's log.
  const ctx: AppContext = {
    ...appCtx,
    mind: appCtx.mind ?? mindFor(config.loracle, { log: app.log.child({ module: 'loracle' }) }),
    copyCatalog,
    liveCopy,
  };

  // The Loracle's job runner. Stopped when the app closes (rows in progress are picked up again by
  // the next boot's sweep, see server.ts).
  const wishJobs = createWishJobs({ db, mind: ctx.mind, world: ctx.world, config: config.loracle, log: app.log });
  app.decorate('wishJobs', wishJobs);
  app.addHook('onClose', async () => {
    await wishJobs.close();
  });

  // The dawn lane (phase B): on only with LORACLE_TICK_SECRET, a batches client (the real one from
  // the key; tests pass their own) and a mind. Off, every cast and ask is drawn at once.
  const key = config.loracle.mode === 'awake' ? config.loracle.apiKey : undefined;
  const batches = appCtx.batches ?? (key ? anthropicBatches(key) : undefined);
  const dawn = createDawnLane({
    db,
    config: config.loracle,
    batches,
    jobs: wishJobs,
    log: app.log.child({ module: 'loracle-dawn' }),
    awake: !!ctx.mind,
  });
  app.decorate('dawn', dawn);

  const sameOrigin = (req: FastifyRequest, origin: string) =>
    config.webOrigins.includes(origin) ||
    config.nativeOrigins.includes(origin) ||
    origin === `${req.protocol}://${req.host}`;

  app.addHook('onRequest', async (req, reply) => {
    // Native apps (Capacitor) call the API cross-origin with bearer tokens. They get
    // CORS headers; browsers on other sites don't, and never get credentials.
    const origin = req.headers.origin;
    if (origin && config.nativeOrigins.includes(origin)) {
      reply
        .header('access-control-allow-origin', origin)
        .header('vary', 'Origin')
        .header('access-control-allow-headers', 'authorization, content-type, x-lore-client')
        .header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        // The live-text version, so the app knows when LORE's words changed.
        .header('access-control-expose-headers', 'x-lore-copy')
        .header('access-control-max-age', '600');
      if (req.method === 'OPTIONS') return reply.status(204).send();
    }

    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null;

    // Cross-site write protection for browser (cookie) clients. Native clients
    // authenticate with a bearer token, which a cross-site page can't attach.
    if (!bearer && !SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin ? !sameOrigin(req, origin) : req.headers['sec-fetch-site'] === 'cross-site') {
        throw forbidden('Cross-site request blocked.');
      }
    }

    const token = bearer ?? req.cookies[SESSION_COOKIE] ?? null;
    if (!token) return;
    const userId = await resolveSession(db, token, config.sessionDays);
    if (userId) {
      req.userId = userId;
      req.sessionToken = token;
    } else if (!bearer) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }
  });

  // Every API response says which version of LORE's words is live (from memory, no database).
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('x-lore-copy', liveCopy.tag());
    return payload;
  });

  // Error messages go out in the words the owner published for them (static messages only: one
  // with a name or title in it is never a key, lib/copy.ts).
  const say = liveCopy.say;
  const sayFields = (fields: Record<string, string> | undefined) =>
    fields && Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, say(v)]));

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: say(err.message), fields: sayFields(err.fields) } });
    }
    const status = err.statusCode ?? 500;
    if (status === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'too_large', message: say('That file is too large.') } });
    }
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: say('Slow down a little and try again.') } });
    }
    if (status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: err.message } });
    }
    // Logged under `err` with a fixed message: pino would otherwise use the error's message as the
    // line's msg, and a failed query's message holds its bound values (lib/safeLog.ts).
    req.log.error({ err }, 'request failed');
    return reply.status(500).send({ error: { code: 'server_error', message: say('Something went wrong on our side.') } });
  });

  // "embedded" in production means DATABASE_URL is missing and data won't survive a restart.
  app.get('/api/health', async () => ({
    ok: true,
    database: ctx.dbKind === 'pglite' ? 'embedded' : (ctx.dbKind ?? 'unknown'),
    photos: config.mediaStorage,
    /** The Loracle's mind: awake (Claude), asleep (no ANTHROPIC_API_KEY) or fake (LORACLE_MIND=fake, dev only). */
    loracle: mindState(ctx.mind),
  }));

  await app.register(
    async (api) => {
      for (const routes of [
        authRoutes,
        appUpdateRoutes,
        accountRoutes,
        userRoutes,
        friendRoutes,
        crewRoutes,
        eventRoutes,
        personalRoutes,
        noteRoutes,
        ideaRoutes,
        chapterRoutes,
        mediaRoutes,
        commentRoutes,
        notificationRoutes,
        oracleRoutes,
        loracleRoutes,
        safetyRoutes,
        homeRoutes,
        mapRoutes,
        copyRoutes,
      ]) {
        await routes(api, ctx);
      }
    },
    { prefix: '/api' },
  );

  // Single-server deploy: serve the built web app, falling back to index.html so
  // client-side routes work on reload.
  const publicDir = path.resolve(config.publicDir);
  if (config.env !== 'test' && existsSync(path.join(publicDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: { code: 'not_found', message: say('Not found.') } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'not_found', message: say('Not found.') } }),
    );
  }

  return app;
}
