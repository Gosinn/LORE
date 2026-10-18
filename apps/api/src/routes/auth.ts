import { eq, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginInput, RegisterInput, type Me } from '#shared';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from '../auth/password.ts';
import { createSession, deleteSession, SESSION_COOKIE } from '../auth/sessions.ts';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { conflict, HttpError, isUniqueViolation, unauthorized } from '../lib/errors.ts';
import { iso, toUserSummary } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

export async function loadMe(db: Db, userId: string): Promise<Me> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw unauthorized();
  return { ...toUserSummary(u), email: u.email, bio: u.bio, createdAt: iso(u.createdAt) };
}

export async function authRoutes(app: FastifyInstance, { db, config }: AppContext) {
  const hashCost = { cost: config.scryptCost, parallelism: config.scryptParallelism };
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  /** Browsers get an httpOnly cookie. Native apps ask for the token in the body. */
  async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const { token, expiresAt } = await createSession(db, userId, req.headers['user-agent'], config.sessionDays);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      expires: expiresAt,
    });
    const native = req.headers['x-lore-client'] === 'native';
    return { user: await loadMe(db, userId), ...(native ? { token } : {}) };
  }

  app.post('/auth/register', limit(10), async (req, reply) => {
    const input = parse(RegisterInput, req.body);
    const taken = await db
      .select({ username: users.username, email: users.email })
      .from(users)
      .where(or(eq(users.username, input.username), eq(users.email, input.email)));
    if (taken.length) {
      const fields: Record<string, string> = {};
      if (taken.some((t) => t.username === input.username)) fields.username = 'That username is taken';
      if (taken.some((t) => t.email === input.email)) fields.email = 'An account with that email already exists';
      throw conflict(Object.values(fields)[0]!, fields);
    }
    const passwordHash = await hashPassword(input.password, hashCost);
    const [user] = await db
      .insert(users)
      .values({ username: input.username, displayName: input.displayName, email: input.email, passwordHash })
      .returning({ id: users.id })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw conflict('That username or email is already taken.');
        throw err;
      });
    reply.status(201);
    return startSession(req, reply, user!.id);
  });

  app.post('/auth/login', limit(10), async (req, reply) => {
    const input = parse(LoginInput, req.body);
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(or(eq(users.username, input.login), eq(users.email, input.login)))
      .limit(1);
    if (!user) {
      await burnPasswordCheck(input.password, hashCost);
      throw new HttpError(401, 'invalid_login', 'That username and password don’t match.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'invalid_login', 'That username and password don’t match.');
    }
    if (needsRehash(user.passwordHash, hashCost)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.password, hashCost) })
        .where(eq(users.id, user.id));
    }
    return startSession(req, reply, user.id);
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionToken) await deleteSession(db, req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => loadMe(db, requireUser(req)));
}
