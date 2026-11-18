import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import { MAX_MEDIA_BYTES } from '#shared';
import { resolveSession, SESSION_COOKIE } from './auth/sessions.ts';
import type { AppContext } from './context.ts';
import { forbidden, HttpError } from './lib/errors.ts';
import { createWishJobs, type WishJobs } from './lib/loracle/jobs.ts';
import { mindFor } from './lib/loracle/mind.ts';
import { setMediaUrlSecret } from './lib/mediaUrls.ts';
import { safeErr } from './lib/safeLog.ts';
import { accountRoutes } from './routes/account.ts';
import { appUpdateRoutes } from './routes/appUpdates.ts';
import { authRoutes } from './routes/auth.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { commentRoutes } from './routes/comments.ts';
import { crewRoutes } from './routes/crews.ts';
import { eventRoutes } from './routes/events.ts';
import { friendRoutes } from './routes/friends.ts';
import { homeRoutes } from './routes/home.ts';
import { ideaRoutes } from './routes/ideas.ts';
import { loracleRoutes, mindState } from './routes/loracle.ts';
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

  // The Loracle's mind: the one passed in (tests), else Claude when a key is set, the dev fake when
  // LORACLE_MIND=fake, none while asleep. Made here so its lines (stages, cost, request ids, safety
  // faults; never text) reach the app's log.
  const ctx: AppContext = {
    ...appCtx,
    mind: appCtx.mind ?? mindFor(config.loracle, { log: app.log.child({ module: 'loracle' }) }),
  };

  // The Loracle's job runner. Stopped when the app closes (rows in progress are picked up again by
  // the next boot's sweep, see server.ts).
  const wishJobs = createWishJobs({ db, mind: ctx.mind, world: ctx.world, config: config.loracle, log: app.log });
  app.decorate('wishJobs', wishJobs);
  app.addHook('onClose', async () => {
    await wishJobs.close();
  });

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

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
    }
    const status = err.statusCode ?? 500;
    if (status === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'too_large', message: 'That file is too large.' } });
    }
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: 'Slow down a little and try again.' } });
    }
    if (status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: err.message } });
    }
    // Logged under `err` with a fixed message: pino would otherwise use the error's message as the
    // line's msg, and a failed query's message holds its bound values (lib/safeLog.ts).
    req.log.error({ err }, 'request failed');
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong on our side.' } });
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
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
    );
  }

  return app;
}
