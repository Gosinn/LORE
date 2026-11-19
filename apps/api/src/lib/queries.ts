// Reusable read queries that turn rows into the shapes in #shared/types. Each takes
// the viewer and applies the visibility predicate itself, so callers can't forget.
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  EVENT_CATEGORY_LABELS,
  MAP_CAP,
  type ChapterSummary,
  type CrewQuestSummary,
  type CrewRef,
  type CrewSummary,
  type Emblem,
  type EventSummary,
  type IdeaSummary,
  type MapFeature,
  type MapMode,
  type MapResponse,
  type MediaRef,
  type ParticipantRole,
  type PlacePrecision,
  type RsvpStatus,
  type UserSummary,
  type WishSummary,
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
  oracleSettings,
  users,
  wishes,
  wishRoads,
  wishWaypoints,
} from '../db/schema.ts';
import {
  chapterVisible,
  eventVisible,
  ideaVisible,
  placeAccess,
  placeFor,
  placeShown,
  wishOwned,
  wishVisible,
  type PlaceAccess,
} from './access.ts';
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
      lat: events.lat,
      lon: events.lon,
      placePrecision: events.placePrecision,
      placeAccess: placeAccess(events.createdBy, viewerId),
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
    place: placeFor(r.placeAccess, { lat: r.lat, lon: r.lon, precision: r.placePrecision }),
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
      locationName: ideas.locationName,
      lat: ideas.lat,
      lon: ideas.lon,
      placePrecision: ideas.placePrecision,
      placeAccess: placeAccess(ideas.createdBy, viewerId),
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

  return rows.map((r) => {
    const place = placeFor(r.placeAccess, { lat: r.lat, lon: r.lon, precision: r.placePrecision });
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      audience: r.audience,
      createdAt: iso(r.createdAt),
      crew: crewRef(r.crewId, r.crewName, r.crewEmoji),
      // An idea's place name only ever comes with its point (the Place row sets both), and a town or
      // hamlet can say more than an "About here" circle: it goes only where the point (or circle) goes.
      locationName: r.placeAccess === 'own' || place ? r.locationName : null,
      place,
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
    };
  });
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
      lat: chapters.lat,
      lon: chapters.lon,
      placePrecision: chapters.placePrecision,
      placeAccess: placeAccess(chapters.createdBy, viewerId),
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
    place: placeFor(r.placeAccess, { lat: r.lat, lon: r.lon, precision: r.placePrecision }),
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

// ---------------------------------------------------------------------------
// The Loracle's quest log

/** The Lorer's own wishes, newest first: the active ones, or the ones let go. Never anyone else's. */
export async function wishSummaries(
  db: Db,
  viewerId: string,
  opts: { letGo: boolean; limit: number },
): Promise<WishSummary[]> {
  const rows = await db
    .select({
      id: wishes.id,
      text: wishes.text,
      status: wishes.status,
      createdAt: wishes.createdAt,
      title: sql<string | null>`${wishRoads.quest} ->> 'title'`,
      lane: wishRoads.lane,
    })
    .from(wishes)
    .leftJoin(wishRoads, and(eq(wishRoads.wishId, wishes.id), eq(wishRoads.n, 1)))
    .where(and(wishOwned(viewerId), opts.letGo ? eq(wishes.status, 'released') : ne(wishes.status, 'released')))
    .orderBy(desc(wishes.createdAt))
    .limit(opts.limit);
  if (!rows.length) return [];
  const counts = await walkedRoads(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const c = counts.get(r.id);
    return {
      id: r.id,
      title: c?.title ?? r.title ?? null,
      text: r.text,
      status: r.status,
      seal: c?.seal ?? null,
      inked: c?.inked ?? 0,
      total: c?.total ?? 0,
      lane: r.lane ?? 'now',
      createdAt: iso(r.createdAt),
    };
  });
}

/**
 * For each wish, the road walked furthest (most waypoints inked; ties: the first road): its title,
 * its seal (the first waypoint's emblem) and how much of it is inked. Phase B gives a wish more roads.
 */
export async function walkedRoads(
  db: Db,
  wishIds: string[],
): Promise<Map<string, { roadId: string; n: number; title: string | null; seal: Emblem | null; inked: number; total: number }>> {
  if (!wishIds.length) return new Map();
  const counts = await db
    .select({
      wishId: wishWaypoints.wishId,
      roadId: wishWaypoints.roadId,
      n: wishRoads.n,
      title: sql<string | null>`${wishRoads.quest} ->> 'title'`,
      total: sql<number>`count(*)::int`,
      inked: sql<number>`count(${wishWaypoints.inkedAt})::int`,
      seal: sql<Emblem | null>`max(case when ${wishWaypoints.position} = 0 then ${wishWaypoints.emblem} end)`,
    })
    .from(wishWaypoints)
    .innerJoin(wishRoads, eq(wishRoads.id, wishWaypoints.roadId))
    .where(inArray(wishWaypoints.wishId, wishIds))
    .groupBy(wishWaypoints.wishId, wishWaypoints.roadId, wishRoads.n, wishRoads.quest);
  const best = new Map<string, (typeof counts)[number]>();
  for (const c of counts) {
    const b = best.get(c.wishId);
    if (!b || c.inked > b.inked || (c.inked === b.inked && c.n < b.n)) best.set(c.wishId, c);
  }
  return best;
}

/**
 * Quests other Lorers showed to the viewer's crews (phase C), newest shown first: only those the
 * viewer may open (lib/access.ts wishVisible), never their own, never one let go.
 */
export async function crewQuestSummaries(db: Db, viewerId: string, limit: number): Promise<CrewQuestSummary[]> {
  const rows = await db
    .select({
      id: wishes.id,
      text: wishes.text,
      status: wishes.status,
      createdAt: wishes.createdAt,
      sharedAt: wishes.sharedAt,
      title: sql<string | null>`${wishRoads.quest} ->> 'title'`,
      lane: wishRoads.lane,
      owner: userColumns,
      crewId: crews.id,
      crewName: crews.name,
      crewEmoji: crews.emoji,
    })
    .from(wishes)
    .innerJoin(users, eq(users.id, wishes.userId))
    .innerJoin(crews, eq(crews.id, wishes.crewId))
    .leftJoin(wishRoads, and(eq(wishRoads.wishId, wishes.id), eq(wishRoads.n, 1)))
    .where(and(wishVisible(viewerId), ne(wishes.userId, viewerId), ne(wishes.status, 'released')))
    .orderBy(desc(sql`coalesce(${wishes.sharedAt}, ${wishes.createdAt})`))
    .limit(limit);
  if (!rows.length) return [];
  const counts = await walkedRoads(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const c = counts.get(r.id);
    return {
      id: r.id,
      title: c?.title ?? r.title ?? null,
      text: r.text,
      status: r.status,
      seal: c?.seal ?? null,
      inked: c?.inked ?? 0,
      total: c?.total ?? 0,
      lane: r.lane ?? 'now',
      createdAt: iso(r.createdAt),
      owner: toUserSummary(r.owner),
      crew: { id: r.crewId, name: r.crewName, emoji: r.crewEmoji },
      sharedAt: iso(r.sharedAt ?? r.createdAt),
    };
  });
}

// ---------------------------------------------------------------------------
// The Lore Map

interface Ranked {
  feature: MapFeature;
  /** How far from now in time (ms): the map keeps the nearest. */
  distance: number;
}
interface Kind {
  ranked: Ranked[];
  /** Everything that matched, before the cap. */
  total: number;
}
const noKind: Kind = { ranked: [], total: 0 };

const mapAuthor = alias(users, 'map_author');
/** Matches before the cap, read off each kind's own query. */
const matched = sql<number>`(count(*) over())::int`;
const sinceNow = (at: Date | string, now: number) => Math.abs(new Date(at).getTime() - now);

interface PinRow {
  lat: number | null;
  lon: number | null;
  placePrecision: PlacePrecision;
  placeAccess: PlaceAccess;
  authorId: string | null;
  authorName: string | null;
}

/** A chapter, plan or idea as a pin: the point as this viewer may have it (placeFor), never more. */
function itemPin(r: PinRow, viewerId: string): Pick<MapFeature, 'lat' | 'lon' | 'precision' | 'who' | 'sharing'> | null {
  const point = placeFor(r.placeAccess, { lat: r.lat, lon: r.lon, precision: r.placePrecision });
  if (!point) return null;
  if (r.placeAccess === 'own') return { lat: point.lat, lon: point.lon, precision: 'exact', sharing: r.placePrecision };
  return {
    lat: point.lat,
    lon: point.lon,
    precision: point.precision === 'approximate' ? 'approximate' : 'exact',
    ...(r.authorId && r.authorId !== viewerId && r.authorName ? { who: r.authorName } : {}),
  };
}

/** Chapters on the map: the crew's in crew mode, else the ones you're in or wrote. */
const mapChapterFilter = (viewerId: string, mode: MapMode, crewId: string | undefined) =>
  and(
    chapterVisible(viewerId),
    placeShown(chapters, viewerId),
    mode === 'crew'
      ? eq(chapters.crewId, crewId!)
      : or(
          eq(chapters.createdBy, viewerId),
          sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${viewerId})`,
        ),
  );

async function mapChapters(db: Db, viewerId: string, mode: MapMode, crewId: string | undefined, now: number): Promise<Kind> {
  const rows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      occurredOn: chapters.occurredOn,
      endedOn: chapters.endedOn,
      locationName: chapters.locationName,
      crewId: chapters.crewId,
      lat: chapters.lat,
      lon: chapters.lon,
      placePrecision: chapters.placePrecision,
      placeAccess: placeAccess(chapters.createdBy, viewerId),
      authorId: mapAuthor.id,
      authorName: mapAuthor.displayName,
      total: matched,
    })
    .from(chapters)
    .leftJoin(mapAuthor, eq(mapAuthor.id, chapters.createdBy))
    .where(mapChapterFilter(viewerId, mode, crewId))
    .orderBy(sql`abs(${chapters.occurredOn} - current_date)`, desc(chapters.createdAt))
    .limit(MAP_CAP);
  const ranked: Ranked[] = [];
  for (const r of rows) {
    const pin = itemPin(r, viewerId);
    if (!pin) continue;
    ranked.push({
      distance: sinceNow(`${r.occurredOn}T00:00:00Z`, now),
      feature: {
        kind: 'chapter',
        id: r.id,
        title: r.title,
        date: r.occurredOn,
        ...(r.endedOn ? { endDate: r.endedOn } : {}),
        ...(r.locationName ? { placeName: r.locationName } : {}),
        ...pin,
        ...(r.crewId ? { crewId: r.crewId } : {}),
        href: `/chapters/${r.id}`,
      },
    });
  }
  return { ranked, total: rows[0]?.total ?? 0 };
}

async function mapEvents(db: Db, viewerId: string, mode: MapMode, crewId: string | undefined, now: number): Promise<Kind> {
  // When a plan is over: an all-day plan is stored from its first day's midnight (and its last day's,
  // for endsAt), so it lasts to the end of that day. A plan marked done is over (as on Home).
  const ends = sql`(coalesce(${events.endsAt}, ${events.startsAt}) + case when ${events.allDay} then interval '1 day' else interval '0 seconds' end)`;
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      category: events.category,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      timeZone: events.timeZone,
      locationName: events.locationName,
      crewId: events.crewId,
      lat: events.lat,
      lon: events.lon,
      placePrecision: events.placePrecision,
      placeAccess: placeAccess(events.createdBy, viewerId),
      authorId: mapAuthor.id,
      authorName: mapAuthor.displayName,
      total: matched,
    })
    .from(events)
    .leftJoin(mapAuthor, eq(mapAuthor.id, events.createdBy))
    .where(
      and(
        eventVisible(viewerId),
        placeShown(events, viewerId),
        ne(events.status, 'canceled'),
        mode === 'crew'
          ? eq(events.crewId, crewId!)
          : sql`exists (select 1 from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${viewerId} and ${eventParticipants.rsvp} <> 'declined')`,
        mode === 'memories'
          ? sql`(${events.status} = 'completed' or ${ends} < now())`
          : mode === 'adventures'
            ? sql`(${events.status} <> 'completed' and ${ends} >= now())`
            : undefined,
        // A plan whose chapter is on this map already is that chapter's pin (no double pins).
        mode === 'adventures'
          ? undefined
          : sql`not exists (select 1 from ${chapters} where ${chapters.eventId} = ${events.id} and ${mapChapterFilter(viewerId, mode, crewId)})`,
      ),
    )
    .orderBy(sql`abs(extract(epoch from (${events.startsAt} - now())))`)
    .limit(MAP_CAP);
  const ranked: Ranked[] = [];
  for (const r of rows) {
    const pin = itemPin(r, viewerId);
    if (!pin) continue;
    ranked.push({
      distance: sinceNow(r.startsAt, now),
      feature: {
        kind: 'event',
        id: r.id,
        title: r.title,
        emoji: EVENT_CATEGORY_LABELS[r.category].emoji,
        date: iso(r.startsAt),
        ...(r.endsAt ? { endDate: iso(r.endsAt) } : {}),
        allDay: r.allDay,
        timeZone: r.timeZone,
        ...(r.locationName ? { placeName: r.locationName } : {}),
        ...pin,
        ...(r.crewId ? { crewId: r.crewId } : {}),
        href: `/events/${r.id}`,
      },
    });
  }
  return { ranked, total: rows[0]?.total ?? 0 };
}

async function mapIdeas(db: Db, viewerId: string, mode: MapMode, crewId: string | undefined, now: number): Promise<Kind> {
  const rows = await db
    .select({
      id: ideas.id,
      title: ideas.title,
      category: ideas.category,
      createdAt: ideas.createdAt,
      locationName: ideas.locationName,
      crewId: ideas.crewId,
      lat: ideas.lat,
      lon: ideas.lon,
      placePrecision: ideas.placePrecision,
      placeAccess: placeAccess(ideas.createdBy, viewerId),
      authorId: mapAuthor.id,
      authorName: mapAuthor.displayName,
      total: matched,
    })
    .from(ideas)
    .leftJoin(mapAuthor, eq(mapAuthor.id, ideas.createdBy))
    .where(
      and(
        ideaVisible(viewerId),
        placeShown(ideas, viewerId),
        notInArray(ideas.status, mode === 'adventures' ? ['archived', 'completed'] : ['archived']),
        mode === 'crew'
          ? eq(ideas.crewId, crewId!)
          : or(
              eq(ideas.createdBy, viewerId),
              sql`exists (select 1 from ${ideaInterest} where ${ideaInterest.ideaId} = ${ideas.id} and ${ideaInterest.userId} = ${viewerId})`,
            ),
      ),
    )
    .orderBy(desc(ideas.createdAt))
    .limit(MAP_CAP);
  const ranked: Ranked[] = [];
  for (const r of rows) {
    const pin = itemPin(r, viewerId);
    if (!pin) continue;
    ranked.push({
      distance: sinceNow(r.createdAt, now),
      feature: {
        kind: 'idea',
        id: r.id,
        title: r.title,
        emoji: EVENT_CATEGORY_LABELS[r.category].emoji,
        ...(r.locationName ? { placeName: r.locationName } : {}),
        ...pin,
        ...(r.crewId ? { crewId: r.crewId } : {}),
        href: `/ideas/${r.id}`,
      },
    });
  }
  return { ranked, total: rows[0]?.total ?? 0 };
}

/** 'YYYY-MM' | 'YYYY-MM-DD' → that day (a month: its first), for ranking; anything else → null. */
const atDay = (at: string | null) =>
  !at ? null : /^\d{4}-\d{2}$/.test(at) ? `${at}-01T00:00:00Z` : /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : null;

/** The Loracle's waypoints with a pin: only ever the wish's owner's (wishOwned), never a let-go wish's. */
async function mapWaypoints(db: Db, viewerId: string, mode: MapMode, now: number): Promise<Kind> {
  const rows = await db
    .select({
      id: wishWaypoints.id,
      wishId: wishes.id,
      name: wishWaypoints.name,
      at: wishWaypoints.at,
      place: wishWaypoints.place,
      town: wishWaypoints.town,
      country: wishWaypoints.country,
      lat: wishWaypoints.lat,
      lon: wishWaypoints.lon,
      wishCreatedAt: wishes.createdAt,
      total: matched,
    })
    .from(wishWaypoints)
    .innerJoin(wishes, eq(wishes.id, wishWaypoints.wishId))
    .where(
      and(
        wishOwned(viewerId),
        sql`${wishWaypoints.lat} is not null and ${wishWaypoints.lon} is not null`,
        mode === 'adventures'
          ? and(notInArray(wishes.status, ['released', 'fulfilled']), isNull(wishWaypoints.inkedAt))
          : ne(wishes.status, 'released'),
        // Made a plan or kept as an idea whose pin this map shows: it shows as that plan or idea (no double
        // pins). The same rules as their own pins (seen, and its point shown to this viewer), so a link to
        // a plan or idea whose point is withheld neither loses the pin nor tells that a point exists.
        sql`not exists (select 1 from ${events} where ${events.id} = ${wishWaypoints.eventId} and ${events.status} <> 'canceled' and ${eventVisible(viewerId)} and ${placeShown(events, viewerId)})`,
        sql`not exists (select 1 from ${ideas} where ${ideas.id} = ${wishWaypoints.ideaId} and ${ideas.status} <> 'archived' and ${ideaVisible(viewerId)} and ${placeShown(ideas, viewerId)})`,
      ),
    )
    // No cap here: only the owner's own waypoints come back (wishOwned), and mapFeatures keeps the
    // nearest in time across every kind.
    .orderBy(desc(wishes.createdAt), asc(wishWaypoints.position));
  const ranked = rows.map((r): Ranked => {
    const placeName = [...new Set([r.place, r.town, r.country].filter((s): s is string => !!s?.trim()))].join(', ');
    return {
      distance: sinceNow(atDay(r.at) ?? r.wishCreatedAt, now),
      feature: {
        kind: 'waypoint',
        id: r.id,
        title: r.name,
        ...(r.at ? { date: r.at } : {}),
        ...(placeName ? { placeName } : {}),
        lat: r.lat!,
        lon: r.lon!,
        precision: 'exact',
        href: `/oracle/quest/${r.wishId}`,
      },
    };
  });
  return { ranked, total: rows[0]?.total ?? 0 };
}

/** Where you stand (the Loracle's realm): only ever yours. */
async function mapHome(db: Db, viewerId: string): Promise<MapFeature | null> {
  const [row] = await db
    .select({ label: oracleSettings.homeLabel, lat: oracleSettings.homeLat, lon: oracleSettings.homeLon })
    .from(oracleSettings)
    .where(eq(oracleSettings.userId, viewerId))
    .limit(1);
  if (!row || row.lat == null || row.lon == null) return null;
  const label = row.label ?? '';
  return {
    kind: 'home',
    id: 'home',
    title: label,
    ...(label ? { placeName: label } : {}),
    lat: row.lat,
    lon: row.lon,
    precision: 'exact',
    href: '/oracle',
  };
}

/**
 * GET /map: what the viewer may see, where they may see it. Each kind goes through its visibility
 * predicate (lib/access.ts) and placeShown, the same rule placeFor applies to the item routes, so
 * the map never shows more than they do. Modes: mine (connected to you: plans you haven't
 * declined, chapters you're in or wrote, ideas you added or are in for, your waypoints), crew (that
 * crew's plans, chapters and ideas you can see), memories (your chapters and past plans),
 * adventures (your plans ahead, open ideas with a place, waypoints not yet inked). Canceled plans
 * and archived ideas never show; a plan whose chapter is on the same map shows as the chapter, and
 * a waypoint made a plan or kept as an idea with a place shows as that plan or idea.
 * Nearest in time to now first, at most MAP_CAP; home (yours alone) comes first, extra. The caller
 * checks the crew.
 */
export async function mapFeatures(db: Db, viewerId: string, opts: { mode: MapMode; crewId?: string }): Promise<MapResponse> {
  const { mode, crewId } = opts;
  const now = Date.now();
  const kinds: Kind[] = [
    mode === 'adventures' ? noKind : await mapChapters(db, viewerId, mode, crewId, now),
    await mapEvents(db, viewerId, mode, crewId, now),
    mode === 'memories' ? noKind : await mapIdeas(db, viewerId, mode, crewId, now),
    mode === 'mine' || mode === 'adventures' ? await mapWaypoints(db, viewerId, mode, now) : noKind,
  ];
  const shown = kinds
    .flatMap((k) => k.ranked)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAP_CAP)
    .map((r) => r.feature);
  const total = kinds.reduce((n, k) => n + k.total, 0);
  const home = await mapHome(db, viewerId);
  return { features: home ? [home, ...shown] : shown, hidden: Math.max(0, total - shown.length) };
}
