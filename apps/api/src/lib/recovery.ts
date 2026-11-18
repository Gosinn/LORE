import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { RegisterInput } from '#shared';
import { hashPassword, type HashCost } from '../auth/password.ts';
import type { Db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';

/** The hashing cost the live server (Render) uses, so a reset password isn't re-hashed at sign-in. */
export const PRODUCTION_HASH_COST: HashCost = { cost: 2 ** 15, parallelism: 3 };

export interface FoundAccount {
  id: string;
  username: string;
  displayName: string;
  email: string;
  createdAt: Date;
  suspendedAt: Date | null;
}

const columns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  email: users.email,
  createdAt: users.createdAt,
  suspendedAt: users.suspendedAt,
};

/**
 * Find an account by username or email (exact, any case). If nothing matches
 * exactly, look for accounts whose username, email or name contains the text.
 */
export async function findAccounts(db: Db, query: string): Promise<{ exact: boolean; accounts: FoundAccount[] }> {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return { exact: false, accounts: [] };
  const exact = await db
    .select(columns)
    .from(users)
    .where(or(eq(users.username, q), eq(users.email, q)))
    .limit(1);
  if (exact.length) return { exact: true, accounts: exact };
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const near = await db
    .select(columns)
    .from(users)
    .where(or(ilike(users.username, like), ilike(users.email, like), ilike(users.displayName, like)))
    .orderBy(desc(users.createdAt))
    .limit(8);
  return { exact: false, accounts: near };
}

export async function countAccounts(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

/**
 * Give an account a new password and sign it out everywhere. Uses the same rules
 * as sign-up (at least 10 characters).
 */
export async function resetPassword(
  db: Db,
  userId: string,
  password: string,
  cost: HashCost = PRODUCTION_HASH_COST,
): Promise<{ signedOut: number }> {
  const checked = RegisterInput.shape.password.safeParse(password);
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? 'That password won’t work.');
  const passwordHash = await hashPassword(checked.data, cost);
  const updated = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated.length) throw new Error('That account no longer exists.');
  const ended = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return { signedOut: ended.length };
}
