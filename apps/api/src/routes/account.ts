import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DeleteAccountInput } from '#shared';
import { verifyPassword } from '../auth/password.ts';
import { SESSION_COOKIE } from '../auth/sessions.ts';
import { requireUser, type AppContext } from '../context.ts';
import { users } from '../db/schema.ts';
import { deleteAccount, exportAccount } from '../lib/accounts.ts';
import { HttpError } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

export async function accountRoutes(app: FastifyInstance, { db, storage }: AppContext) {
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
