import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { sessions } from '../db/schema.ts';

const DAY = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL = 60 * 60 * 1000;

export const SESSION_COOKIE = 'lore_session';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a session and returns the raw token (only ever held by the client). */
export async function createSession(db: Db, userId: string, userAgent: string | undefined, days: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * DAY);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Resolves a token to its user. Sliding expiry: active sessions keep extending. */
export async function resolveSession(db: Db, token: string, days: number): Promise<string | null> {
  const id = hashToken(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now), expiresAt: new Date(now + days * DAY) })
      .where(eq(sessions.id, id));
  }
  return session.userId;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}
