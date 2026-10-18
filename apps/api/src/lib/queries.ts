// Reusable read queries that turn rows into the shapes in #shared/types. Each takes
// the viewer and applies the visibility predicate itself, so callers can't forget.
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  ChapterSummary,
  CrewRef,
  CrewSummary,
  EventSummary,
  IdeaSummary,
  MediaRef,
  ParticipantRole,
  RsvpStatus,
  UserSummary,
} from '#shared';
import type { Db } from '../db/index.ts';
import {
  chapterPeople,
  chapters,
  contributions,
  crewMembers,
  crews,
  eventParticipants,
  events,
  ideaInterest,
  ideas,
  media,
  users,
} from '../db/schema.ts';
import { chapterVisible, eventVisible, ideaVisible } from './access.ts';
import { signedMediaPath } from './mediaUrls.ts';

export const mediaUrl = (id: string) => signedMediaPath(id);

export const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
export const isoOrNull = (d: Date | string | null | undefined) => (d == null ? null : iso(d));

export const userColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarMediaId: users.avatarMediaId,
};

export function toUserSummary(u: {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
}): UserSummary {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarMediaId ? mediaUrl(u.avatarMediaId) : null,
  };
}

export async function userSummaries(db: Db, ids: string[]): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select(userColumns).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, toUserSummary(r)]));
}

export async function userSummary(db: Db, id: string | null): Promise<UserSummary | null> {
  if (!id) return null;
  return (await userSummaries(db, [id])).get(id) ?? null;
}

const crewRef = (id: string | null, name: string | null, emoji: string | null): CrewRef | null =>
  id && name ? { id, name, emoji: emoji ?? '🔥' } : null;

export function toMediaRef(m: {
  id: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}): MediaRef {
  return { id: m.id, url: mediaUrl(m.id), mimeType: m.mimeType, width: m.width, height: m.height };
}

// ---------------------------------------------------------------------------
// Events

export async function eventSummaries(
  db: Db,
  viewerId: string,
  where?: SQL,
  opts: { limit?: number; order?: 'asc' | 'desc' } = {},
): Promise<EventSummary[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      category: events.category,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      timeZone: events.timeZone,
      locationName: events.locationName,
      audience: events.audience,
      crewId: crews.id,
      crewName: crews.name,
      crewEmoji: crews.emoji,
      myRsvp: sql<RsvpStatus | null>`(select ${eventParticipants.rsvp} from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${viewerId})`,
      myRole: sql<ParticipantRole | null>`(select ${eventParticipants.role} from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${viewerId})`,
      goingCount: sql<number>`(select count(*)::int from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.rsvp} = 'going')`,
      chapterId: sql<string | null>`(select ${chapters.id} from ${chapters} where ${chapters.eventId} = ${events.id} and ${chapterVisible(viewerId)})`,
    })
    .from(events)
    .leftJoin(crews, eq(crews.id, events.crewId))
    .where(and(eventVisible(viewerId), where))
    .orderBy(opts.order === 'desc' ? desc(events.startsAt) : asc(events.startsAt))
    .limit(opts.limit ?? 500);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    startsAt: iso(r.startsAt),
    endsAt: isoOrNull(r.endsAt),
    allDay: r.allDay,
    timeZone: r.timeZone,
    locationName: r.locationName,
    crew: crewRef(r.crewId, r.crewName, r.crewEmoji),
    audience: r.audience,
    myRsvp: r.myRsvp,
    myRole: r.myRole,
    goingCount: r.goingCount,
    chapterId: r.chapterId,
  }));
}

// ---------------------------------------------------------------------------
// Crews

/** Crews the viewer belongs to (or is invited to). Non-members never see a crew. */
export async function crewSummaries(db: Db, viewerId: string, where?: SQL): Promise<CrewSummary[]> {
  const rows = await db
    .select({
      id: crews.id,
      name: crews.name,
      emoji: crews.emoji,
      description: crews.description,
      myRole: crewMembers.role,
      myStatus: crewMembers.status,
      memberCount: sql<number>`(select count(*)::int from ${crewMembers} m where m.crew_id = ${crews.id} and m.status = 'active')`,
    })
    .from(crews)
    .innerJoin(crewMembers, and(eq(crewMembers.crewId, crews.id), eq(crewMembers.userId, viewerId)))
    .where(where)
    .orderBy(asc(crews.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Ideas

const ideaCreator = alias(users, 'idea_creator');

export async function ideaSummaries(
  db: Db,
  viewerId: string,
  where?: SQL,
  opts: { limit?: number; orderBy?: SQL[] } = {},
): Promise<IdeaSummary[]> {
  const rows = await db
    .select({
      id: ideas.id,
      title: ideas.title,
      category: ideas.category,
      status: ideas.status,
      audience: ideas.audience,
      createdAt: ideas.createdAt,
      crewId: crews.id,
      crewName: crews.name,
      crewEmoji: crews.emoji,
      creatorId: ideaCreator.id,
      creatorUsername: ideaCreator.username,
      creatorName: ideaCreator.displayName,
      creatorAvatar: ideaCreator.avatarMediaId,
      interestedCount: sql<number>`(select count(*)::int from ${ideaInterest} where ${ideaInterest.ideaId} = ${ideas.id})`,
      iAmInterested: sql<boolean>`exists (select 1 from ${ideaInterest} where ${ideaInterest.ideaId} = ${ideas.id} and ${ideaInterest.userId} = ${viewerId})`,
    })
    .from(ideas)
    .leftJoin(crews, eq(crews.id, ideas.crewId))
    .leftJoin(ideaCreator, eq(ideaCreator.id, ideas.createdBy))
    .where(and(ideaVisible(viewerId), where))
    .orderBy(...(opts.orderBy ?? [desc(ideas.createdAt)]))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    audience: r.audience,
    createdAt: iso(r.createdAt),
    crew: crewRef(r.crewId, r.crewName, r.crewEmoji),
    createdBy:
      r.creatorId && r.creatorUsername && r.creatorName
        ? toUserSummary({
            id: r.creatorId,
            username: r.creatorUsername,
            displayName: r.creatorName,
            avatarMediaId: r.creatorAvatar,
          })
        : null,
    interestedCount: r.interestedCount,
    iAmInterested: r.iAmInterested,
  }));
}

// ---------------------------------------------------------------------------
// Chapters

const cover = alias(media, 'cover');

export async function chapterSummaries(
  db: Db,
  viewerId: string,
  where?: SQL,
  opts: { limit?: number } = {},
): Promise<ChapterSummary[]> {
  const rows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      summary: chapters.summary,
      occurredOn: chapters.occurredOn,
      endedOn: chapters.endedOn,
      locationName: chapters.locationName,
      audience: chapters.audience,
      eventId: chapters.eventId,
      crewId: crews.id,
      crewName: crews.name,
      crewEmoji: crews.emoji,
      coverId: cover.id,
      coverMime: cover.mimeType,
      coverWidth: cover.width,
      coverHeight: cover.height,
      peopleCount: sql<number>`(select count(*)::int from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id})`,
      contributionCount: sql<number>`(select count(*)::int from ${contributions} where ${contributions.chapterId} = ${chapters.id})`,
    })
    .from(chapters)
    .leftJoin(crews, eq(crews.id, chapters.crewId))
    .leftJoin(cover, eq(cover.id, chapters.coverMediaId))
    .where(and(chapterVisible(viewerId), where))
    .orderBy(desc(chapters.occurredOn), desc(chapters.createdAt))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    occurredOn: r.occurredOn,
    endedOn: r.endedOn,
    locationName: r.locationName,
    audience: r.audience,
    eventId: r.eventId,
    crew: crewRef(r.crewId, r.crewName, r.crewEmoji),
    cover:
      r.coverId && r.coverMime
        ? toMediaRef({ id: r.coverId, mimeType: r.coverMime, width: r.coverWidth, height: r.coverHeight })
        : null,
    peopleCount: r.peopleCount,
    contributionCount: r.contributionCount,
  }));
}
