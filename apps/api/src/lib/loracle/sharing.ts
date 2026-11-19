// The Loracle, phase C: what showing a quest to a crew leaves behind, undone when a bond breaks.
//
// lib/access.ts already hides a shown quest the moment its Lorer or a reader leaves the crew, or a
// block stands between them. These helpers make that last: run in the same transaction as the leave,
// the removal or the block, they keep a rejoin from silently showing the quest again, and they let go
// of walks nobody could undo any more (a hidden quest's walker gets a 404 on "Walk no more").
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.ts';
import { wishes, wishWalkers, wishWaypoints } from '../../db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * `userId` leaves (or is removed from) `crewId`: every quest of theirs shown to that crew is theirs
 * alone again (and its walkers are let go), and every walk of theirs on a quest shown to that crew ends.
 */
export async function letGoOfCrew(tx: Tx, crewId: string, userId: string): Promise<void> {
  const shown = await tx
    .select({ id: wishes.id })
    .from(wishes)
    .where(and(eq(wishes.userId, userId), eq(wishes.crewId, crewId)));
  const ids = shown.map((w) => w.id);
  if (ids.length) {
    await tx.delete(wishWalkers).where(inArray(wishWalkers.waypointId, tx.select({ id: wishWaypoints.id }).from(wishWaypoints).where(inArray(wishWaypoints.wishId, ids))));
    await tx.update(wishes).set({ audience: 'only_me', crewId: null, sharedAt: null, updatedAt: new Date() }).where(inArray(wishes.id, ids));
  }
  await tx
    .delete(wishWalkers)
    .where(
      and(
        eq(wishWalkers.userId, userId),
        inArray(
          wishWalkers.waypointId,
          tx
            .select({ id: wishWaypoints.id })
            .from(wishWaypoints)
            .innerJoin(wishes, eq(wishes.id, wishWaypoints.wishId))
            .where(eq(wishes.crewId, crewId)),
        ),
      ),
    );
}

/**
 * A block between `a` and `b`, either way: neither walks a quest of the other's any more. (The quest
 * itself is hidden from a blocked reader by lib/access.ts wishVisible; nothing else is undone.)
 */
export async function letGoOnBlock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.delete(wishWalkers).where(
    or(
      and(eq(wishWalkers.userId, b), walksOn(a)),
      and(eq(wishWalkers.userId, a), walksOn(b)),
    ),
  );
}

/** The walker's waypoint is on a quest of `lorerId`'s. */
const walksOn = (lorerId: string) =>
  sql`exists (select 1 from ${wishWaypoints} join ${wishes} on ${wishes.id} = ${wishWaypoints.wishId} where ${wishWaypoints.id} = ${wishWalkers.waypointId} and ${wishes.userId} = ${lorerId})`;
