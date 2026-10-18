import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FriendRequestInput, type FriendRequest, type UserSummary } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { blocks, friendships, users } from '../db/schema.ts';
import { relationship, idParam } from '../lib/access.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { friendIds } from '../lib/friends.ts';
import { notify } from '../lib/notify.ts';
import { iso, toUserSummary, userColumns, userSummaries, userSummary } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const BlockInput = z.object({ userId: z.uuid() });

export async function friendRoutes(app: FastifyInstance, { db }: AppContext) {
  const pairWhere = (a: string, b: string) =>
    or(
      and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
      and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
    );

  app.get('/friends', async (req): Promise<UserSummary[]> => {
    const me = requireUser(req);
    const ids = await friendIds(db, me);
    if (ids.length === 0) return [];
    const rows = await db.select(userColumns).from(users).where(inArray(users.id, ids)).orderBy(asc(users.displayName));
    return rows.map(toUserSummary);
  });

  app.get('/friends/requests', async (req): Promise<FriendRequest[]> => {
    const me = requireUser(req);
    const rows = await db
      .select()
      .from(friendships)
      .where(and(eq(friendships.status, 'pending'), or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me))));
    const people = await userSummaries(db, rows.map((r) => (r.requesterId === me ? r.addresseeId : r.requesterId)));
    return rows.flatMap((r) => {
      const other = r.requesterId === me ? r.addresseeId : r.requesterId;
      const user = people.get(other);
      return user
        ? [{ id: r.id, user, direction: r.requesterId === me ? 'outgoing' : 'incoming', createdAt: iso(r.createdAt) } as const]
        : [];
    });
  });

  app.post('/friends/requests', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = requireUser(req);
    const { username } = parse(FriendRequestInput, req.body);
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!target) throw notFound('That person');
    if (target.id === me) throw badRequest("You can't befriend yourself (but we admire the spirit).");
    const rel = await relationship(db, me, target.id);
    if (rel.blocked) throw notFound('That person');

    const [existing] = await db.select().from(friendships).where(pairWhere(me, target.id)).limit(1);
    const actor = await userSummary(db, me);
    if (existing) {
      if (existing.status === 'accepted') throw conflict("You're already friends.");
      if (existing.requesterId === me) throw conflict('Your request is already on its way.');
      // They already asked you: asking back means yes.
      await db
        .update(friendships)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(eq(friendships.id, existing.id));
      await notify(db, [target.id], {
        type: 'friend_accepted',
        actorId: me,
        title: `${actor?.displayName} accepted your friend request`,
        href: `/u/${actor?.username}`,
      });
      return { status: 'accepted' as const };
    }

    await db.insert(friendships).values({ requesterId: me, addresseeId: target.id });
    await notify(db, [target.id], {
      type: 'friend_request',
      actorId: me,
      title: `${actor?.displayName} wants to be friends`,
      href: '/friends',
    });
    reply.status(201);
    return { status: 'pending' as const };
  });

  app.post('/friends/requests/:id/accept', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const [request] = await db.select().from(friendships).where(eq(friendships.id, id)).limit(1);
    if (!request || request.addresseeId !== me) throw notFound('That request');
    if (request.status === 'accepted') return { status: 'accepted' as const };
    await db.update(friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendships.id, id));
    const actor = await userSummary(db, me);
    await notify(db, [request.requesterId], {
      type: 'friend_accepted',
      actorId: me,
      title: `${actor?.displayName} accepted your friend request`,
      href: `/u/${actor?.username}`,
    });
    return { status: 'accepted' as const };
  });

  /** Decline (if it was sent to you) or cancel (if you sent it). Quietly: no notification. */
  app.delete('/friends/requests/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const [request] = await db.select().from(friendships).where(eq(friendships.id, id)).limit(1);
    if (!request || request.status !== 'pending' || (request.addresseeId !== me && request.requesterId !== me)) {
      throw notFound('That request');
    }
    await db.delete(friendships).where(eq(friendships.id, id));
    return { ok: true };
  });

  app.delete('/friends/:userId', async (req) => {
    const me = requireUser(req);
    const other = idParam(req.params, 'userId');
    await db.delete(friendships).where(and(eq(friendships.status, 'accepted'), pairWhere(me, other)));
    return { ok: true };
  });

  app.get('/blocks', async (req): Promise<UserSummary[]> => {
    const me = requireUser(req);
    const rows = await db
      .select(userColumns)
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(eq(blocks.blockerId, me));
    return rows.map(toUserSummary);
  });

  /** Blocking ends any friendship or pending request, and hides you from them. */
  app.post('/blocks', async (req) => {
    const me = requireUser(req);
    const { userId } = parse(BlockInput, req.body);
    if (userId === me) throw forbidden();
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw notFound('That person');
    await db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId: me, blockedId: userId }).onConflictDoNothing();
      await tx.delete(friendships).where(pairWhere(me, userId));
    });
    return { ok: true };
  });

  app.delete('/blocks/:userId', async (req) => {
    const me = requireUser(req);
    const other = idParam(req.params, 'userId');
    await db.delete(blocks).where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, other)));
    return { ok: true };
  });
}
