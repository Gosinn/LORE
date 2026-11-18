import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ReportInput,
  ResolveReportInput,
  SupportMessageInput,
  type ModerationReport,
  type ModerationSummary,
  type ReportReason,
  type ReportTarget,
  type SupportMessage,
  type SupportTopic,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import {
  blocks,
  chapters,
  comments,
  contributions,
  events,
  friendships,
  ideas,
  media,
  reports,
  sessions,
  supportMessages,
  users,
} from '../db/schema.ts';
import { idParam, loadVisibleChapter, loadVisibleEvent, loadVisibleIdea } from '../lib/access.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { iso, isoOrNull, userColumns, toUserSummary, userSummaries } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';
import { deleteMediaFiles } from './chapters.ts';

const clip = (s: string | null | undefined, n = 600) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '');

/**
 * Keeping LORE safe (App Store guideline 1.2): anyone can report a person or
 * anything they can see, and block them in the same step. Moderators (the
 * usernames in ADMIN_USERNAMES) review reports, take content down, suspend
 * accounts, and read the contact form.
 */
export async function safetyRoutes(app: FastifyInstance, { db, config, storage }: AppContext) {
  async function requireAdmin(req: FastifyRequest) {
    const me = requireUser(req);
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, me)).limit(1);
    // Not a moderator: these routes don't exist for you.
    if (!u || !config.adminUsernames.includes(u.username)) throw notFound();
    return me;
  }

  /** What's being reported, if the reporter can see it: who's behind it, what it says, where it lives. */
  async function describe(me: string, type: ReportTarget, id: string) {
    switch (type) {
      case 'user': {
        const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!u) throw notFound('That person');
        return { subjectId: u.id, snapshot: clip(`${u.displayName} (@${u.username})${u.bio ? `\n${u.bio}` : ''}`), href: `/u/${u.username}` };
      }
      case 'event': {
        const e = await loadVisibleEvent(db, me, id);
        return { subjectId: e.createdBy, snapshot: clip(`${e.title}\n${e.description ?? ''}`), href: `/events/${e.id}` };
      }
      case 'idea': {
        const i = await loadVisibleIdea(db, me, id);
        return { subjectId: i.createdBy, snapshot: clip(`${i.title}\n${i.description ?? ''}`), href: `/ideas/${i.id}` };
      }
      case 'chapter': {
        const c = await loadVisibleChapter(db, me, id);
        return { subjectId: c.createdBy, snapshot: clip(`${c.title}\n${c.summary ?? ''}`), href: `/chapters/${c.id}` };
      }
      case 'contribution': {
        const [c] = await db.select().from(contributions).where(eq(contributions.id, id)).limit(1);
        if (!c) throw notFound('That contribution');
        await loadVisibleChapter(db, me, c.chapterId);
        const text = [c.title, c.body, c.caption, c.mediaId ? '[photo]' : null].filter(Boolean).join('\n');
        return { subjectId: c.authorId, snapshot: clip(text), href: `/chapters/${c.chapterId}` };
      }
      case 'comment': {
        const [c] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
        if (!c) throw notFound('That comment');
        let href: string;
        if (c.eventId) href = `/events/${(await loadVisibleEvent(db, me, c.eventId)).id}`;
        else if (c.ideaId) href = `/ideas/${(await loadVisibleIdea(db, me, c.ideaId)).id}`;
        else href = `/chapters/${(await loadVisibleChapter(db, me, c.chapterId!)).id}`;
        return { subjectId: c.authorId, snapshot: clip(c.body), href };
      }
    }
  }

  app.post('/reports', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(ReportInput, req.body);
    const target = await describe(me, input.targetType, input.targetId);
    if (input.targetType === 'user' && target.subjectId === me) throw badRequest("You can't report yourself.");

    const [already] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, me),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.status, 'open'),
        ),
      )
      .limit(1);
    if (!already) {
      await db.insert(reports).values({
        reporterId: me,
        targetType: input.targetType,
        targetId: input.targetId,
        subjectId: target.subjectId,
        reason: input.reason,
        details: input.details ?? null,
        snapshot: target.snapshot || null,
        href: target.href,
      });
    }
    if (input.block && target.subjectId && target.subjectId !== me) {
      const other = target.subjectId;
      await db.transaction(async (tx) => {
        await tx.insert(blocks).values({ blockerId: me, blockedId: other }).onConflictDoNothing();
        await tx
          .delete(friendships)
          .where(
            or(
              and(eq(friendships.requesterId, me), eq(friendships.addresseeId, other)),
              and(eq(friendships.requesterId, other), eq(friendships.addresseeId, me)),
            ),
          );
      });
    }
    reply.status(201);
    return { ok: true, blocked: !!(input.block && target.subjectId && target.subjectId !== me) };
  });

  // --- Contact form: open to everyone, signed in or not --------------------------

  app.post('/support', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const input = parse(SupportMessageInput, req.body);
    const userId = req.userId;
    let replyTo = input.replyTo ?? null;
    if (!replyTo && userId) {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      replyTo = u?.email ?? null;
    }
    if (!replyTo) throw badRequest('Leave an email address so we can answer.', { replyTo: 'Required' });
    await db.insert(supportMessages).values({ userId, replyTo, topic: input.topic, body: input.body });
    reply.status(201);
    return { ok: true };
  });

  // --- Moderation ------------------------------------------------------------------

  app.get('/admin/summary', async (req): Promise<ModerationSummary> => {
    await requireAdmin(req);
    const [r] = await db
      .select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${reports.createdAt})` })
      .from(reports)
      .where(eq(reports.status, 'open'));
    const [m] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportMessages)
      .where(sql`${supportMessages.handledAt} is null`);
    return { openReports: r?.n ?? 0, oldestOpenAt: isoOrNull(r?.oldest), openMessages: m?.n ?? 0 };
  });

  app.get('/admin/reports', async (req): Promise<ModerationReport[]> => {
    await requireAdmin(req);
    const closed = (req.query as { status?: string } | undefined)?.status === 'closed';
    const rows = await db
      .select()
      .from(reports)
      .where(closed ? sql`${reports.status} <> 'open'` : eq(reports.status, 'open'))
      .orderBy(closed ? desc(reports.resolvedAt) : asc(reports.createdAt))
      .limit(100);
    const people = await userSummaries(
      db,
      rows.flatMap((r) => [r.reporterId, r.subjectId].filter((x): x is string => !!x)),
    );
    const subjectIds = [...new Set(rows.map((r) => r.subjectId).filter((x): x is string => !!x))];
    const suspended = new Set(
      subjectIds.length
        ? (
            await db
              .select({ id: users.id })
              .from(users)
              .where(and(inArray(users.id, subjectIds), sql`${users.suspendedAt} is not null`))
          ).map((u) => u.id)
        : [],
    );
    const openCounts = new Map<string, number>();
    for (const r of rows) if (r.status === 'open') openCounts.set(`${r.targetType}:${r.targetId}`, (openCounts.get(`${r.targetType}:${r.targetId}`) ?? 0) + 1);
    return rows.map((r) => {
      const subject = r.subjectId ? people.get(r.subjectId) : undefined;
      return {
        id: r.id,
        targetType: r.targetType as ReportTarget,
        targetId: r.targetId,
        reason: r.reason as ReportReason,
        details: r.details,
        snapshot: r.snapshot,
        href: r.href,
        reporter: r.reporterId ? (people.get(r.reporterId) ?? null) : null,
        subject: subject ? { ...subject, suspended: suspended.has(subject.id) } : null,
        status: r.status as ModerationReport['status'],
        resolution: r.resolution,
        createdAt: iso(r.createdAt),
        resolvedAt: isoOrNull(r.resolvedAt),
        sameTarget: Math.max(0, (openCounts.get(`${r.targetType}:${r.targetId}`) ?? 1) - 1),
      };
    });
  });

  /** Take reported content down. Returns false when it was already gone. */
  async function removeTarget(type: ReportTarget, id: string): Promise<boolean> {
    switch (type) {
      case 'comment':
        return (await db.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id })).length > 0;
      case 'contribution': {
        const [c] = await db.select({ mediaId: contributions.mediaId }).from(contributions).where(eq(contributions.id, id));
        if (!c) return false;
        if (c.mediaId) {
          await deleteMediaFiles(db, storage, eq(media.id, c.mediaId));
          await db.delete(media).where(eq(media.id, c.mediaId)); // cascades to the contribution
        } else {
          await db.delete(contributions).where(eq(contributions.id, id));
        }
        return true;
      }
      case 'chapter':
        await deleteMediaFiles(db, storage, eq(media.chapterId, id));
        return (await db.delete(chapters).where(eq(chapters.id, id)).returning({ id: chapters.id })).length > 0;
      case 'event':
        await deleteMediaFiles(db, storage, eq(media.eventId, id));
        return (await db.delete(events).where(eq(events.id, id)).returning({ id: events.id })).length > 0;
      case 'idea':
        return (await db.delete(ideas).where(eq(ideas.id, id)).returning({ id: ideas.id })).length > 0;
      case 'user':
        return false; // People are suspended, not removed.
    }
  }

  app.post('/admin/reports/:id/resolve', async (req) => {
    const me = await requireAdmin(req);
    const id = idParam(req.params);
    const input = parse(ResolveReportInput, req.body);
    const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report) throw notFound('That report');

    let resolution: string;
    if (input.action === 'dismiss') {
      resolution = 'Dismissed: nothing against the Terms.';
    } else if (input.action === 'remove') {
      if (report.targetType === 'user') throw badRequest('People are suspended, not removed. Choose suspend.');
      const removed = await removeTarget(report.targetType as ReportTarget, report.targetId);
      resolution = removed ? `Removed the ${report.targetType}.` : `The ${report.targetType} was already gone.`;
    } else {
      if (!report.subjectId) throw badRequest('There is no account to suspend (it was deleted).');
      if (report.subjectId === me) throw forbidden("You can't suspend yourself.");
      await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, report.subjectId));
      await db.delete(sessions).where(eq(sessions.userId, report.subjectId));
      if (report.targetType !== 'user') await removeTarget(report.targetType as ReportTarget, report.targetId);
      resolution = report.targetType === 'user' ? 'Suspended the account.' : `Suspended the account and removed the ${report.targetType}.`;
    }
    if (input.note) resolution += ` ${input.note}`;

    // One decision settles every open report about the same thing.
    await db
      .update(reports)
      .set({
        status: input.action === 'dismiss' ? 'dismissed' : 'actioned',
        resolution,
        resolvedBy: me,
        resolvedAt: new Date(),
      })
      .where(
        or(
          eq(reports.id, id),
          and(eq(reports.targetType, report.targetType), eq(reports.targetId, report.targetId), eq(reports.status, 'open')),
        ),
      );
    return { ok: true, resolution };
  });

  app.post('/admin/users/:id/unsuspend', async (req) => {
    await requireAdmin(req);
    const id = idParam(req.params);
    await db.update(users).set({ suspendedAt: null }).where(eq(users.id, id));
    return { ok: true };
  });

  app.get('/admin/support', async (req): Promise<SupportMessage[]> => {
    await requireAdmin(req);
    const rows = await db
      .select({ m: supportMessages, u: userColumns })
      .from(supportMessages)
      .leftJoin(users, eq(users.id, supportMessages.userId))
      .orderBy(sql`${supportMessages.handledAt} is not null`, desc(supportMessages.createdAt))
      .limit(100);
    return rows.map(({ m, u }) => ({
      id: m.id,
      topic: m.topic as SupportTopic,
      body: m.body,
      replyTo: m.replyTo,
      user: u?.id ? toUserSummary(u) : null,
      createdAt: iso(m.createdAt),
      handledAt: isoOrNull(m.handledAt),
    }));
  });

  app.post('/admin/support/:id/handled', async (req) => {
    await requireAdmin(req);
    const id = idParam(req.params);
    await db.update(supportMessages).set({ handledAt: new Date() }).where(eq(supportMessages.id, id));
    return { ok: true };
  });
}
