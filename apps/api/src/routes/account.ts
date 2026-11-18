import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ChangePasswordInput, DeleteAccountInput } from '#shared';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { hashToken, SESSION_COOKIE } from '../auth/sessions.ts';
import { requireUser, type AppContext } from '../context.ts';
import { sessions, users } from '../db/schema.ts';
import { deleteAccount, exportAccount } from '../lib/accounts.ts';
import { HttpError } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

export async function accountRoutes(app: FastifyInstance, { db, config, storage }: AppContext) {
  /** Everything you've put into LORE, as a JSON file. */
  app.get('/me/export', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = requireUser(req);
    const data = await exportAccount(db, me);
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="lore-${data.profile?.username ?? 'export'}.json"`);
    return JSON.stringify(data, null, 2);
  });

  /**
   * Delete your account. Your personal data goes; what you added to shared chapters
   * stays, anonymised. See lib/accounts.ts for the full policy.
   */
  /** Change your password. Other devices are signed out; this one stays signed in. */
  app.post('/me/password', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const me = requireUser(req);
    const { currentPassword, newPassword } = parse(ChangePasswordInput, req.body);
    const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me)).limit(1);
    if (!user || !(await verifyPassword(currentPassword, user.hash))) {
      throw new HttpError(403, 'wrong_password', 'That password isn’t right.', { currentPassword: 'Wrong password' });
    }
    if (newPassword === currentPassword) {
      throw new HttpError(400, 'bad_request', 'Choose a password you haven’t used here.', {
        newPassword: 'Same as your current password',
      });
    }
    const passwordHash = await hashPassword(newPassword, { cost: config.scryptCost, parallelism: config.scryptParallelism });
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, me));
    const keep = req.sessionToken ? hashToken(req.sessionToken) : null;
    const ended = await db
      .delete(sessions)
      .where(keep ? and(eq(sessions.userId, me), ne(sessions.id, keep)) : eq(sessions.userId, me))
      .returning({ id: sessions.id });
    return { ok: true, signedOutOthers: ended.length };
  });

  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = requireUser(req);
    const { password } = parse(DeleteAccountInput, req.body);
    const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, me)).limit(1);
    if (!user || !(await verifyPassword(password, user.hash))) {
      throw new HttpError(403, 'wrong_password', 'That password isn’t right.', { password: 'Wrong password' });
    }
    await deleteAccount(db, storage, me);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
