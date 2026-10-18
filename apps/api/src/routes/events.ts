import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import {
  ChecklistItemInput,
  CreateEventInput,
  EventRangeQuery,
  EventStatusInput,
  InviteUsersInput,
  RsvpInput,
  SetOrganizerInput,
  UpdateChecklistItemInput,
  UpdateEventInput,
  type EventDetail,
  type EventSummary,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { eventChecklistItems, eventParticipants, events, ideas, users } from '../db/schema.ts';
import { canReach, eventParticipant, idParam, isActiveCrewMember, loadVisibleEvent } from '../lib/access.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { notify } from '../lib/notify.ts';
import { eventSummaries, isoOrNull, toUserSummary, userColumns, userSummary } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const assignee = alias(users, 'assignee');
const CLOSED = new Set(['completed', 'canceled']);

export async function loadEventDetail(db: Db, viewerId: string, eventId: string): Promise<EventDetail> {
  const [summary] = await eventSummaries(db, viewerId, eq(events.id, eventId));
  if (!summary) throw notFound('That event');
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);

  const participants = await db
    .select({
      ...userColumns,
      role: eventParticipants.role,
      rsvp: eventParticipants.rsvp,
      respondedAt: eventParticipants.respondedAt,
    })
    .from(eventParticipants)
    .innerJoin(users, eq(users.id, eventParticipants.userId))
    .where(eq(eventParticipants.eventId, eventId))
    .orderBy(
      sql`case ${eventParticipants.role} when 'organizer' then 0 else 1 end`,
      sql`case ${eventParticipants.rsvp} when 'going' then 0 when 'maybe' then 1 when 'invited' then 2 else 3 end`,
      asc(users.displayName),
    );

  const checklist = await db
    .select({
      id: eventChecklistItems.id,
      text: eventChecklistItems.text,
      done: eventChecklistItems.done,
      createdById: eventChecklistItems.createdBy,
      assigneeId: assignee.id,
      assigneeUsername: assignee.username,
      assigneeName: assignee.displayName,
      assigneeAvatar: assignee.avatarMediaId,
    })
    .from(eventChecklistItems)
    .leftJoin(assignee, eq(assignee.id, eventChecklistItems.assigneeId))
    .where(eq(eventChecklistItems.eventId, eventId))
    .orderBy(asc(eventChecklistItems.createdAt));

  return {
    ...summary,
    description: event!.description,
    capacity: event!.capacity,
    createdBy: await userSummary(db, event!.createdBy),
    ideaId: event!.ideaId,
    participants: participants.map((p) => ({
      user: toUserSummary(p),
      role: p.role,
      rsvp: p.rsvp,
      respondedAt: isoOrNull(p.respondedAt),
    })),
    checklist: checklist.map((c) => ({
      id: c.id,
      text: c.text,
      done: c.done,
      createdById: c.createdById ?? '',
      assignee:
        c.assigneeId && c.assigneeUsername && c.assigneeName
          ? toUserSummary({
              id: c.assigneeId,
              username: c.assigneeUsername,
              displayName: c.assigneeName,
              avatarMediaId: c.assigneeAvatar,
            })
          : null,
    })),
    canEdit: summary.myRole === 'organizer',
    canRsvp: !CLOSED.has(summary.status),
  };
}

/** Invites people the inviter is allowed to reach. Returns who was newly invited. */
export async function inviteToEvent(
  db: Db,
  eventId: string,
  inviterId: string,
  userIds: string[],
  opts: { skipUnreachable?: boolean } = {},
): Promise<string[]> {
  const candidates = [...new Set(userIds)].filter((id) => id !== inviterId);
  if (candidates.length === 0) return [];
  const already = await db
    .select({ userId: eventParticipants.userId })
    .from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), inArray(eventParticipants.userId, candidates)));
  const skip = new Set(already.map((a) => a.userId));
  const fresh: string[] = [];
  for (const id of candidates) {
    if (skip.has(id)) continue;
    if (!(await canReach(db, inviterId, id))) {
      if (opts.skipUnreachable) continue;
      throw badRequest('You can only invite your friends or people you share a crew with.');
    }
    fresh.push(id);
  }
  if (fresh.length) {
    await db
      .insert(eventParticipants)
      .values(fresh.map((userId) => ({ eventId, userId, invitedBy: inviterId })))
      .onConflictDoNothing();
  }
  return fresh;
}

export async function eventRoutes(app: FastifyInstance, { db }: AppContext) {
  async function requireOrganizer(eventId: string, userId: string) {
    const event = await loadVisibleEvent(db, userId, eventId);
    const p = await eventParticipant(db, eventId, userId);
    if (p?.role !== 'organizer') throw forbidden('Only organizers can change this event.');
    return event;
  }

  async function activeRecipients(eventId: string) {
    const rows = await db
      .select({ userId: eventParticipants.userId })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), ne(eventParticipants.rsvp, 'declined')));
    return rows.map((r) => r.userId);
  }

  async function actorName(userId: string) {
    return (await userSummary(db, userId))?.displayName ?? 'Someone';
  }

  /** The LORE calendar: every event you can see that overlaps the range. */
  app.get('/events', async (req): Promise<EventSummary[]> => {
    const me = requireUser(req);
    const q = parse(EventRangeQuery, req.query);
    return eventSummaries(
      db,
      me,
      and(
        lt(events.startsAt, new Date(q.to)),
        gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, new Date(q.from)),
        q.crewId ? eq(events.crewId, q.crewId) : undefined,
      ),
    );
  });

  app.post('/events', async (req, reply) => {
    const me = requireUser(req);
    const input = parse(CreateEventInput, req.body);
    if (input.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }
    const eventId = await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          title: input.title,
          description: input.description ?? null,
          category: input.category ?? 'gathering',
          status: input.status ?? 'planning',
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          allDay: input.allDay ?? false,
          timeZone: input.timeZone,
          locationName: input.locationName ?? null,
          crewId: input.crewId ?? null,
          audience: input.audience ?? (input.crewId ? 'crew' : 'participants'),
          capacity: input.capacity ?? null,
          createdBy: me,
        })
        .returning({ id: events.id });
      await tx.insert(eventParticipants).values({
        eventId: event!.id,
        userId: me,
        role: 'organizer',
        rsvp: 'going',
        respondedAt: new Date(),
      });
      return event!.id;
    });
    const invited = await inviteToEvent(db, eventId, me, input.inviteUserIds ?? []);
    await notify(db, invited, {
      type: 'event_invite',
      actorId: me,
      title: `${await actorName(me)} invited you to ${input.title}`,
      href: `/events/${eventId}`,
    });
    reply.status(201);
    return loadEventDetail(db, me, eventId);
  });

  app.get('/events/:id', async (req) => loadEventDetail(db, requireUser(req), idParam(req.params)));

  app.patch('/events/:id', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const event = await requireOrganizer(eventId, me);
    const input = parse(UpdateEventInput, req.body);

    const next = {
      startsAt: input.startsAt ? new Date(input.startsAt) : event.startsAt,
      endsAt: input.endsAt === undefined ? event.endsAt : input.endsAt ? new Date(input.endsAt) : null,
      crewId: input.crewId === undefined ? event.crewId : input.crewId,
      audience: input.audience ?? event.audience,
    };
    if (next.endsAt && next.endsAt < next.startsAt) throw badRequest('The end must be after the start', { endsAt: 'Too early' });
    if (next.audience === 'crew' && !next.crewId) throw badRequest('Pick a crew to share with the crew', { crewId: 'Required' });
    if (input.crewId && input.crewId !== event.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }

    await db
      .update(events)
      .set({
        title: input.title,
        description: input.description,
        category: input.category,
        allDay: input.allDay,
        timeZone: input.timeZone,
        locationName: input.locationName,
        capacity: input.capacity,
        ...next,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    const moved =
      next.startsAt.getTime() !== event.startsAt.getTime() ||
      (next.endsAt?.getTime() ?? null) !== (event.endsAt?.getTime() ?? null) ||
      (input.locationName !== undefined && input.locationName !== event.locationName);
    if (moved) {
      await notify(db, await activeRecipients(eventId), {
        type: 'event_changed',
        actorId: me,
        title: `The plan for ${input.title ?? event.title} changed`,
        href: `/events/${eventId}`,
      }, { collapse: true });
    }
    return loadEventDetail(db, me, eventId);
  });

  app.post('/events/:id/status', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const event = await requireOrganizer(eventId, me);
    const { status } = parse(EventStatusInput, req.body);
    if (status === event.status) return loadEventDetail(db, me, eventId);

    await db
      .update(events)
      .set({ status, completedAt: status === 'completed' ? new Date() : null, updatedAt: new Date() })
      .where(eq(events.id, eventId));

    if (status === 'completed' && event.ideaId) {
      await db
        .update(ideas)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(ideas.id, event.ideaId), inArray(ideas.status, ['scheduled', 'planning'])));
    }
    if (status === 'canceled') {
      await notify(db, await activeRecipients(eventId), {
        type: 'event_canceled',
        actorId: me,
        title: `${event.title} was canceled`,
        href: `/events/${eventId}`,
      });
    }
    return loadEventDetail(db, me, eventId);
  });

  app.post('/events/:id/invites', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const event = await requireOrganizer(eventId, me);
    if (CLOSED.has(event.status)) throw conflict('This event is closed.');
    const { userIds } = parse(InviteUsersInput, req.body);
    const invited = await inviteToEvent(db, eventId, me, userIds);
    await notify(db, invited, {
      type: 'event_invite',
      actorId: me,
      title: `${await actorName(me)} invited you to ${event.title}`,
      href: `/events/${eventId}`,
    });
    return loadEventDetail(db, me, eventId);
  });

  app.post('/events/:id/rsvp', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const event = await loadVisibleEvent(db, me, eventId);
    if (CLOSED.has(event.status)) throw conflict('This event is closed.');
    const { status } = parse(RsvpInput, req.body);
    const mine = await eventParticipant(db, eventId, me);

    if (status === 'going' && event.capacity && mine?.rsvp !== 'going') {
      const [{ going } = { going: 0 }] = await db
        .select({ going: sql<number>`count(*)::int` })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.rsvp, 'going')));
      if (going >= event.capacity) throw conflict("It's full. Ask an organizer to make room.");
    }

    if (mine) {
      await db
        .update(eventParticipants)
        .set({ rsvp: status, respondedAt: new Date() })
        .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, me)));
    } else {
      // Not invited, but the event is open to your friends or crew: you can join.
      await db.insert(eventParticipants).values({ eventId, userId: me, rsvp: status, respondedAt: new Date() });
    }
    return loadEventDetail(db, me, eventId);
  });

  app.put('/events/:id/participants/:userId/organizer', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const target = idParam(req.params, 'userId');
    await requireOrganizer(eventId, me);
    const { organizer } = parse(SetOrganizerInput, req.body);
    const theirs = await eventParticipant(db, eventId, target);
    if (!theirs) throw notFound('That participant');
    if (!organizer && theirs.role === 'organizer') await assertAnotherOrganizer(eventId, target);
    await db
      .update(eventParticipants)
      .set({ role: organizer ? 'organizer' : 'participant' })
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, target)));
    return loadEventDetail(db, me, eventId);
  });

  async function assertAnotherOrganizer(eventId: string, leavingUserId: string) {
    const [{ others } = { others: 0 }] = await db
      .select({ others: sql<number>`count(*)::int` })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.eventId, eventId),
          eq(eventParticipants.role, 'organizer'),
          ne(eventParticipants.userId, leavingUserId),
        ),
      );
    if (others === 0) throw conflict('Every event needs an organizer. Make someone else one first.');
  }

  /** Leave an event yourself, or (as an organizer) remove someone from it. */
  app.delete('/events/:id/participants/:userId', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const target = idParam(req.params, 'userId');
    await loadVisibleEvent(db, me, eventId);
    const theirs = await eventParticipant(db, eventId, target);
    if (!theirs) throw notFound('That participant');
    if (target !== me) {
      const mine = await eventParticipant(db, eventId, me);
      if (mine?.role !== 'organizer') throw forbidden('Only organizers can remove people.');
      if (theirs.role === 'organizer') throw forbidden('Make them a regular participant first.');
    } else if (theirs.role === 'organizer') {
      await assertAnotherOrganizer(eventId, me);
    }
    await db
      .delete(eventParticipants)
      .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, target)));
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Packing list / checklist: anyone taking part can add and tick things off.

  async function requireTakingPart(eventId: string, userId: string) {
    await loadVisibleEvent(db, userId, eventId);
    const p = await eventParticipant(db, eventId, userId);
    if (!p || p.rsvp === 'declined') throw forbidden('Join the event to help with the list.');
    return p;
  }

  async function loadItem(eventId: string, itemId: string) {
    const [item] = await db
      .select()
      .from(eventChecklistItems)
      .where(and(eq(eventChecklistItems.id, itemId), eq(eventChecklistItems.eventId, eventId)))
      .limit(1);
    if (!item) throw notFound('That item');
    return item;
  }

  app.post('/events/:id/checklist', async (req, reply) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    await requireTakingPart(eventId, me);
    const { text } = parse(ChecklistItemInput, req.body);
    await db.insert(eventChecklistItems).values({ eventId, text, createdBy: me });
    reply.status(201);
    return loadEventDetail(db, me, eventId);
  });

  app.patch('/events/:id/checklist/:itemId', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const itemId = idParam(req.params, 'itemId');
    await requireTakingPart(eventId, me);
    await loadItem(eventId, itemId);
    const input = parse(UpdateChecklistItemInput, req.body);
    if (input.assigneeId) {
      const p = await eventParticipant(db, eventId, input.assigneeId);
      if (!p || p.rsvp === 'declined') throw badRequest('Only people taking part can be assigned.');
    }
    await db
      .update(eventChecklistItems)
      .set({ text: input.text, done: input.done, assigneeId: input.assigneeId })
      .where(eq(eventChecklistItems.id, itemId));
    return loadEventDetail(db, me, eventId);
  });

  app.delete('/events/:id/checklist/:itemId', async (req) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const itemId = idParam(req.params, 'itemId');
    const p = await requireTakingPart(eventId, me);
    const item = await loadItem(eventId, itemId);
    if (item.createdBy !== me && p.role !== 'organizer') throw forbidden('Only whoever added it or an organizer can remove it.');
    await db.delete(eventChecklistItems).where(eq(eventChecklistItems.id, itemId));
    return loadEventDetail(db, me, eventId);
  });
}

