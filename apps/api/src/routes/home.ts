import { and, count, eq, gte, inArray, isNull, lt, ne, not, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HomeData } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { chapterPeople, chapters, eventParticipants, events, ideaInterest, ideas, notifications } from '../db/schema.ts';
import { isActiveMember } from '../lib/access.ts';
import { chapterSummaries, crewSummaries, eventSummaries, ideaSummaries } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const HomeQuery = z.object({ today: z.iso.date().optional() });
const DAY = 24 * 60 * 60 * 1000;

/**
 * Home answers three questions (brief part III): what's happening, what could we
 * do, what should I remember. Every section is a short, finite list. No feed.
 */
export async function homeRoutes(app: FastifyInstance, { db }: AppContext) {
  app.get('/home', async (req): Promise<HomeData> => {
    const me = requireUser(req);
    const { today = new Date().toISOString().slice(0, 10) } = parse(HomeQuery, req.query);
    const now = new Date();
    const mine = (rsvps: ('invited' | 'going' | 'maybe' | 'declined')[]) =>
      sql`exists (select 1 from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${me} and ${inArray(eventParticipants.rsvp, rsvps)})`;
    const notOver = gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now);
    const open = notInArray(events.status, ['completed', 'canceled']);
    // Plans you organize that aren't settled yet go under "still being planned",
    // so nothing shows up in two sections.
    const organizingUnsettled = and(
      inArray(events.status, ['proposed', 'planning']),
      sql`exists (select 1 from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${me} and ${eventParticipants.role} = 'organizer')`,
    )!;

    const [invitations, comingUp, continuePlanning, toDocument] = await Promise.all([
      eventSummaries(db, me, and(mine(['invited']), open, notOver), { limit: 5 }),
      eventSummaries(db, me, and(mine(['going', 'maybe']), open, notOver, not(organizingUnsettled)), { limit: 5 }),
      eventSummaries(db, me, and(organizingUnsettled, notOver), { limit: 5 }),
      // Things that happened and don't have a chapter yet.
      eventSummaries(
        db,
        me,
        and(
          mine(['going']),
          ne(events.status, 'canceled'),
          or(eq(events.status, 'completed'), lt(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now)),
          gte(events.startsAt, new Date(now.getTime() - 90 * DAY)),
          sql`not exists (select 1 from ${chapters} where ${chapters.eventId} = ${events.id})`,
        ),
        { limit: 3, order: 'desc' },
      ),
    ]);

    const crews = await crewSummaries(db, me);

    // A few open ideas close to you. The pick changes daily, not on every refresh.
    const ideasPick = await ideaSummaries(
      db,
      me,
      and(
        inArray(ideas.status, ['dreaming', 'gathering_interest', 'planning']),
        or(
          eq(ideas.createdBy, me),
          sql`exists (select 1 from ${ideaInterest} where ${ideaInterest.ideaId} = ${ideas.id} and ${ideaInterest.userId} = ${me})`,
          and(sql`${ideas.crewId} is not null`, isActiveMember(ideas.crewId, me)),
        ),
      ),
      { limit: 3, orderBy: [sql`md5(${ideas.id}::text || ${today})`] },
    );

    const involved = or(
      eq(chapters.createdBy, me),
      sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${me})`,
    );
    const [onThisDay, recentLore] = await Promise.all([
      chapterSummaries(
        db,
        me,
        and(
          sql`to_char(${chapters.occurredOn}, 'MM-DD') = ${today.slice(5)}`,
          sql`${chapters.occurredOn} < ${today.slice(0, 4) + '-01-01'}`,
        ),
        { limit: 3 },
      ),
      chapterSummaries(db, me, involved, { limit: 5 }),
    ]);

    const [unread] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, me), isNull(notifications.readAt)));

    return {
      invitations,
      comingUp,
      continuePlanning,
      toDocument,
      crews: crews.filter((c) => c.myStatus === 'active').slice(0, 8),
      crewInvites: crews.filter((c) => c.myStatus === 'invited'),
      ideas: ideasPick,
      onThisDay,
      recentLore,
      unreadNotifications: unread?.n ?? 0,
    };
  });
}

