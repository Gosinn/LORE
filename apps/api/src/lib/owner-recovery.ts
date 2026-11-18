import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';

// One-time, 2026-11-18: the owner lost access to their account and had no time to run
// `npm run account:recover`. On start-up, the owner's account (username "gosinn", or
// the only account if there's just one) gets a temporary password, once. It never
// touches an account changed after CUTOFF, and does nothing after UNTIL.
// Remove this file (and its two call sites) once the owner is back in.

const TEMP_HASH = 'scrypt$32768$8$3$mZvUAdNfhLIcKTLINO2OHg==$OMPD0ffzUL+i4DdZ2XSOxs1XKxE6Xx/lgvYm1FhIhZw=';
const CUTOFF = new Date('2026-11-18T08:56:00Z');
const UNTIL = new Date('2026-11-21T00:00:00Z');

/** Reported by /api/health while this exists, so it can be checked from outside. */
export let ownerRecoveryStatus: { applied: boolean; username?: string } | null = null;

export async function ownerRecovery(db: Db): Promise<void> {
  if (Date.now() > UNTIL.getTime()) return;
  const columns = { id: users.id, username: users.username, updatedAt: users.updatedAt, passwordHash: users.passwordHash };
  let [owner] = await db.select(columns).from(users).where(eq(users.username, 'gosinn')).limit(1);
  if (!owner) {
    const all = await db.select(columns).from(users).limit(2);
    if (all.length === 1) owner = all[0];
  }
  if (!owner) {
    ownerRecoveryStatus = { applied: false };
    return;
  }
  if (owner.passwordHash === TEMP_HASH || owner.updatedAt.getTime() >= CUTOFF.getTime()) {
    // Already done on an earlier start (or the account changed since): leave it alone.
    ownerRecoveryStatus = { applied: true, username: owner.username };
    return;
  }
  await db.update(users).set({ passwordHash: TEMP_HASH, updatedAt: new Date() }).where(eq(users.id, owner.id));
  await db.delete(sessions).where(eq(sessions.userId, owner.id));
  ownerRecoveryStatus = { applied: true, username: owner.username };
}
