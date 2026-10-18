import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppNotification } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { notifications, users } from '../db/schema.ts';
import { iso, isoOrNull, toUserSummary } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const actor = alias(users, 'actor');
const MarkRead = z.object({ ids: z.array(z.uuid()).max(200).optional() });

export async function notificationRoutes(app: FastifyInstance, { db }: AppContext) {
  /** The 50 most recent. Old notifications aren't worth scrolling back through. */
  app.get('/notifications', async (req): Promise<AppNotification[]> => {
    const me = requireUser(req);
    const rows = await db
      .select({
        n: notifications,
        actorId: actor.id,
        actorUsername: actor.username,
        actorName: actor.displayName,
        actorAvatar: actor.avatarMediaId,
      })
      .from(notifications)
      .leftJoin(actor, eq(actor.id, notifications.actorId))
      .where(eq(notifications.userId, me))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return rows.map((r) => ({
      id: r.n.id,
      type: r.n.type,
      title: r.n.title,
      href: r.n.href,
      readAt: isoOrNull(r.n.readAt),
      createdAt: iso(r.n.createdAt),
      actor:
        r.actorId && r.actorUsername && r.actorName
          ? toUserSummary({ id: r.actorId, username: r.actorUsername, displayName: r.actorName, avatarMediaId: r.actorAvatar })
          : null,
    }));
  });

  app.get('/notifications/unread-count', async (req) => {
    const me = requireUser(req);
    const [row] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, me), isNull(notifications.readAt)));
    return { count: row?.n ?? 0 };
  });

  /** Mark some (or, without ids, all) notifications as read. */
  app.post('/notifications/read', async (req) => {
    const me = requireUser(req);
    const { ids } = parse(MarkRead, req.body);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, me),
          isNull(notifications.readAt),
          ids?.length ? inArray(notifications.id, ids) : undefined,
        ),
      );
    return { ok: true };
  });
}
