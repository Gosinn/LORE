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
import { authRoutes } from './routes/auth.ts';
import { chapterRoutes } from './routes/chapters.ts';
import { commentRoutes } from './routes/comments.ts';
import { crewRoutes } from './routes/crews.ts';
import { eventRoutes } from './routes/events.ts';
import { friendRoutes } from './routes/friends.ts';
import { homeRoutes } from './routes/home.ts';
import { ideaRoutes } from './routes/ideas.ts';
import { mediaRoutes } from './routes/media.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { personalRoutes } from './routes/personal.ts';
import { userRoutes } from './routes/users.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(ctx: AppContext) {
  const { config, db } = ctx;
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: false });

  app.decorateRequest('userId', null);
  app.decorateRequest('sessionToken', null);

  const sameOrigin = (req: FastifyRequest, origin: string) =>
    config.webOrigins.includes(origin) || origin === `${req.protocol}://${req.host}`;

  app.addHook('onRequest', async (req, reply) => {
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
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong on our side.' } });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      for (const routes of [
        authRoutes,
        userRoutes,
        friendRoutes,
        crewRoutes,
        eventRoutes,
        personalRoutes,
        ideaRoutes,
        chapterRoutes,
        mediaRoutes,
        commentRoutes,
        notificationRoutes,
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
