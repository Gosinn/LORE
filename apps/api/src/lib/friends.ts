import { and, eq, inArray, or } from 'drizzle-orm';
import type { FriendshipState } from '#shared';
import type { Db } from '../db/index.ts';
import { blocks, friendships } from '../db/schema.ts';

/** The viewer's relationship to each of `others`, as seen from the viewer's side. */
export async function friendshipStates(
  db: Db,
  viewerId: string,
  others: string[],
): Promise<Map<string, { state: FriendshipState; friendshipId: string | null }>> {
  const result = new Map<string, { state: FriendshipState; friendshipId: string | null }>();
  for (const id of others) result.set(id, { state: id === viewerId ? 'self' : 'none', friendshipId: null });
  const ids = others.filter((id) => id !== viewerId);
  if (ids.length === 0) return result;

  const rows = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, viewerId), inArray(friendships.addresseeId, ids)),
        and(eq(friendships.addresseeId, viewerId), inArray(friendships.requesterId, ids)),
      ),
    );
  for (const f of rows) {
    const other = f.requesterId === viewerId ? f.addresseeId : f.requesterId;
    const state: FriendshipState =
      f.status === 'accepted' ? 'friends' : f.requesterId === viewerId ? 'outgoing' : 'incoming';
    result.set(other, { state, friendshipId: f.id });
  }

  const blocked = await db
    .select({ id: blocks.blockedId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, ids)));
  for (const b of blocked) result.set(b.id, { state: 'blocked', friendshipId: null });
  return result;
}

export async function friendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      ),
    );
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}
