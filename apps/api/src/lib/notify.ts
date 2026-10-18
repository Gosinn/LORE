import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { NotificationType } from '#shared';
import type { Db } from '../db/index.ts';
import { notifications } from '../db/schema.ts';

interface NotificationInput {
  type: NotificationType;
  actorId: string | null;
  title: string;
  href: string;
}

/**
 * Sends one in-app notification to each recipient (never to the actor). With
 * `collapse`, a recipient who still has an unread notification for the same link
 * doesn't get another one: ten photos added to a chapter are one update, not ten.
 */
export async function notify(
  db: Db,
  recipients: Iterable<string>,
  n: NotificationInput,
  opts: { collapse?: boolean } = {},
) {
  let ids = [...new Set(recipients)].filter((id) => id !== n.actorId);
  if (ids.length === 0) return;
  if (opts.collapse) {
    const pending = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          inArray(notifications.userId, ids),
          eq(notifications.href, n.href),
          eq(notifications.type, n.type),
          isNull(notifications.readAt),
        ),
      );
    const skip = new Set(pending.map((p) => p.userId));
    ids = ids.filter((id) => !skip.has(id));
    if (ids.length === 0) return;
  }
  await db.insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
}
