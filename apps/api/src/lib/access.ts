// The privacy model, enforced in SQL. Every query that returns events, ideas,
// chapters or the Loracle's wishes goes through one of the `*Visible` predicates below,
// so the rules live in exactly one place. See docs/ARCHITECTURE.md § Privacy and permissions.
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLACE_GRID_DEG, type PlacePoint, type PlacePrecision } from '#shared';
import type { Config } from '../config.ts';
import { requireUser } from '../context.ts';
import type { Db } from '../db/index.ts';
import {
  blocks,
  chapterPeople,
  chapters,
  crewMembers,
  eventParticipants,
  events,
  friendships,
  ideas,
  users,
  wishes,
  wishRoads,
  wishWaypoints,
} from '../db/schema.ts';
import { notFound } from './errors.ts';

type Ref = AnyColumn | SQL;

export const isActiveMember = (crewId: Ref, userId: string) =>
  sql`exists (select 1 from ${crewMembers} where ${crewMembers.crewId} = ${crewId} and ${crewMembers.userId} = ${userId} and ${crewMembers.status} = 'active')`;

export const areFriends = (userId: Ref, viewerId: string) =>
  sql`exists (select 1 from ${friendships} where ${friendships.status} = 'accepted' and ((${friendships.requesterId} = ${userId} and ${friendships.addresseeId} = ${viewerId}) or (${friendships.addresseeId} = ${userId} and ${friendships.requesterId} = ${viewerId})))`;

/**
 * Events: participants (anyone invited, whatever they answered) always see it.
 * `friends` adds the creator's friends; `crew` adds the crew's active members.
 */
export const eventVisible = (viewerId: string) => sql`(
  exists (select 1 from ${eventParticipants} where ${eventParticipants.eventId} = ${events.id} and ${eventParticipants.userId} = ${viewerId})
  or (${events.audience} = 'friends' and ${events.createdBy} is not null and ${areFriends(events.createdBy, viewerId)})
  or (${events.audience} = 'crew' and ${events.crewId} is not null and ${isActiveMember(events.crewId, viewerId)})
)`;

/** Ideas: the creator, plus their friends or the crew depending on the audience. */
export const ideaVisible = (viewerId: string) => sql`(
  ${ideas.createdBy} = ${viewerId}
  or (${ideas.audience} = 'friends' and ${ideas.createdBy} is not null and ${areFriends(ideas.createdBy, viewerId)})
  or (${ideas.audience} = 'crew' and ${ideas.crewId} is not null and ${isActiveMember(ideas.crewId, viewerId)})
)`;

/**
 * Chapters: `only_me` is a private journal entry. Otherwise the people in the
 * chapter see it, and `crew` adds the crew's active members.
 */
export const chapterVisible = (viewerId: string) => sql`(
  ${chapters.createdBy} = ${viewerId}
  or (${chapters.audience} <> 'only_me' and exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${viewerId}))
  or (${chapters.audience} = 'crew' and ${chapters.crewId} is not null and ${isActiveMember(chapters.crewId, viewerId)})
)`;

// ---------------------------------------------------------------------------
// Places (the Lore Map, docs/DECISIONS.md D35). On top of seeing an item, who gets its point:
// - its author (whoever created it) always, exactly, with their setting ('own');
// - nobody else while the author's "Show my places on maps" is off, or across a block either way ('none');
// - everyone else who sees the item by its place_precision ('shared'): exact → the point; approximate →
//   the point rounded here (approximatePoint), never the exact one; only_me → nothing.
// A former member's item (author null) is 'shared'; account deletion already rounded or cleared it.
// Every response that carries an item's coordinates goes through placeFor, and the map's SQL
// filter (placeShown) is the same rule.

export type PlaceAccess = 'own' | 'shared' | 'none';

/** The author's switch is off, or a block stands between author and viewer. */
const placeWithheld = (author: Ref, viewerId: string) => sql`(
  exists (select 1 from ${users} place_author where place_author.id = ${author} and not place_author.show_places)
  or exists (select 1 from ${blocks} place_block where (place_block.blocker_id = ${author} and place_block.blocked_id = ${viewerId})
                                                  or (place_block.blocker_id = ${viewerId} and place_block.blocked_id = ${author}))
)`;

/** How much of an item's place the viewer may have, as a column (`author` is the item's created_by). */
export const placeAccess = (author: Ref, viewerId: string) => sql<PlaceAccess>`(case
  when ${author} = ${viewerId} then 'own'
  when ${author} is not null and ${placeWithheld(author, viewerId)} then 'none'
  else 'shared' end)`;

/** The item has a point this viewer gets: placeFor would not answer null. For the map's queries. */
export const placeShown = (
  t: { lat: AnyColumn; lon: AnyColumn; placePrecision: AnyColumn; createdBy: AnyColumn },
  viewerId: string,
) => sql`(${t.lat} is not null and ${t.lon} is not null and (
  ${t.createdBy} = ${viewerId}
  or (${t.placePrecision} <> 'only_me' and (${t.createdBy} is null or not ${placeWithheld(t.createdBy, viewerId)}))
))`;

/** placeAccess for one item, when the row was loaded without it. */
export async function placeAccessFor(db: Db, authorId: string | null, viewerId: string): Promise<PlaceAccess> {
  if (authorId === viewerId) return 'own';
  if (!authorId) return 'shared';
  const result = await db.execute<{ withheld: boolean }>(sql`select ${placeWithheld(sql`${authorId}::uuid`, viewerId)} as withheld`);
  return result.rows[0]?.withheld ? 'none' : 'shared';
}

/**
 * Whether anyone but the author gets an item's point at all, blocks aside: the author's "Show my places
 * on maps" is on (a former member's item: yes, as placeAccess has it). For telling whether a change
 * reached the others.
 */
export async function sharesPlaces(db: Db, authorId: string | null): Promise<boolean> {
  if (!authorId) return true;
  const [author] = await db.select({ showPlaces: users.showPlaces }).from(users).where(eq(users.id, authorId)).limit(1);
  return author?.showPlaces !== false;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0; // + 0 turns -0 into 0

/**
 * An approximate place: the point rounded to a grid of PLACE_GRID_DEG of latitude (about 5.5 km)
 * and, along each row, a whole number of equal longitude steps of about the same length (so the
 * cells stay about 5 km wide away from the equator; at the poles a row is one cell). The same
 * point always rounds to the same node, so asking again tells nothing more.
 */
export function approximatePoint(lat: number, lon: number): { lat: number; lon: number } {
  const rLat = Math.min(90, Math.max(-90, Math.round(lat / PLACE_GRID_DEG) * PLACE_GRID_DEG));
  const cells = Math.max(1, Math.floor((360 * Math.cos((rLat * Math.PI) / 180)) / PLACE_GRID_DEG));
  const step = 360 / cells;
  let rLon = Math.round((lon + 180) / step) * step - 180;
  if (rLon >= 180) rLon -= 360;
  return { lat: round6(rLat), lon: round6(rLon) };
}

/** An item's point as the viewer may have it (see above). The only way coordinates leave the server. */
export function placeFor(
  access: PlaceAccess,
  p: { lat: number | null; lon: number | null; precision: PlacePrecision },
): PlacePoint | null {
  if (p.lat == null || p.lon == null || access === 'none') return null;
  if (access === 'own') return { lat: p.lat, lon: p.lon, precision: p.precision };
  if (p.precision === 'only_me') return null;
  if (p.precision === 'approximate') return { ...approximatePoint(p.lat, p.lon), precision: 'approximate' };
  return { lat: p.lat, lon: p.lon, precision: 'exact' };
}

// ---------------------------------------------------------------------------
// Loaders that 404 instead of 403, so hidden things don't reveal they exist.

const uuid = z.uuid();

export function idParam(params: unknown, key = 'id'): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export async function loadVisibleEvent(db: Db, viewerId: string, eventId: string) {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eventVisible(viewerId)))
    .limit(1);
  if (!row) throw notFound('That event');
  return row;
}

export async function loadVisibleIdea(db: Db, viewerId: string, ideaId: string) {
  const [row] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), ideaVisible(viewerId)))
    .limit(1);
  if (!row) throw notFound('That idea');
  return row;
}

export async function loadVisibleChapter(db: Db, viewerId: string, chapterId: string) {
  const [row] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), chapterVisible(viewerId)))
    .limit(1);
  if (!row) throw notFound('That chapter');
  return row;
}

// The Loracle: wishes, their roads and waypoints are visible to the Lorer who cast them, and to no
// one else (no sharing in phase A). Sealing is not visibility: routes/loracle.ts strips sealed
// waypoints when it builds the view.

/** Wishes: only the Lorer who cast it. */
export const wishVisible = (viewerId: string) => eq(wishes.userId, viewerId);

export async function loadVisibleWish(db: Db, viewerId: string, wishId: string) {
  const [row] = await db
    .select()
    .from(wishes)
    .where(and(eq(wishes.id, wishId), wishVisible(viewerId)))
    .limit(1);
  if (!row) throw notFound('That wish');
  return row;
}

/** A road with its wish (the wish decides who sees it). */
export async function loadVisibleRoad(db: Db, viewerId: string, roadId: string) {
  const [found] = await db
    .select({ road: wishRoads, wish: wishes })
    .from(wishRoads)
    .innerJoin(wishes, eq(wishes.id, wishRoads.wishId))
    .where(and(eq(wishRoads.id, roadId), wishVisible(viewerId)))
    .limit(1);
  if (!found) throw notFound('That road');
  return found;
}

/** A waypoint with its wish (the wish decides who sees it). */
export async function loadVisibleWaypoint(db: Db, viewerId: string, waypointId: string) {
  const [found] = await db
    .select({ waypoint: wishWaypoints, wish: wishes })
    .from(wishWaypoints)
    .innerJoin(wishes, eq(wishes.id, wishWaypoints.wishId))
    .where(and(eq(wishWaypoints.id, waypointId), wishVisible(viewerId)))
    .limit(1);
  if (!found) throw notFound('That waypoint');
  return found;
}

// ---------------------------------------------------------------------------
// Roles

export async function eventParticipant(db: Db, eventId: string, userId: string) {
  const [row] = await db
    .select()
    .from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function crewMembership(db: Db, crewId: string, userId: string) {
  const [row] = await db
    .select()
    .from(crewMembers)
    .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function isActiveCrewMember(db: Db, crewId: string, userId: string) {
  const m = await crewMembership(db, crewId, userId);
  return m?.status === 'active';
}

export async function isCrewAdmin(db: Db, crewId: string, userId: string) {
  const m = await crewMembership(db, crewId, userId);
  return m?.status === 'active' && (m.role === 'owner' || m.role === 'admin');
}

export async function chapterPerson(db: Db, chapterId: string, userId: string) {
  const [row] = await db
    .select()
    .from(chapterPeople)
    .where(and(eq(chapterPeople.chapterId, chapterId), eq(chapterPeople.userId, userId)))
    .limit(1);
  return row ?? null;
}

export interface Relationship {
  blocked: boolean;
  friends: boolean;
  shareCrew: boolean;
}

export async function relationship(db: Db, a: string, b: string): Promise<Relationship> {
  const result = await db.execute<{ blocked: boolean; friends: boolean; share_crew: boolean }>(sql`
    select
      exists (select 1 from ${blocks} where (${blocks.blockerId} = ${a} and ${blocks.blockedId} = ${b})
                                         or (${blocks.blockerId} = ${b} and ${blocks.blockedId} = ${a})) as blocked,
      ${areFriends(sql`${a}::uuid`, b)} as friends,
      exists (select 1 from ${crewMembers} m1 join ${crewMembers} m2 on m1.crew_id = m2.crew_id
              where m1.user_id = ${a} and m2.user_id = ${b} and m1.status = 'active' and m2.status = 'active') as share_crew
  `);
  const row = result.rows[0];
  return { blocked: !!row?.blocked, friends: !!row?.friends, shareCrew: !!row?.share_crew };
}

/**
 * Who you can invite to things or add to a chapter: friends, or people you share a
 * crew with, and never across a block. Keeps strangers from spamming invitations.
 */
export async function canReach(db: Db, from: string, to: string): Promise<boolean> {
  if (from === to) return false;
  const r = await relationship(db, from, to);
  return !r.blocked && (r.friends || r.shareCrew);
}

// ---------------------------------------------------------------------------
// The owner: moderation and live text. One rule, used by loadMe, safety.ts and routes/copy.ts.

type OwnerConfig = Pick<Config, 'adminUsernames' | 'ownerDefault'>;

/**
 * Whether an account is the owner: listed in ADMIN_USERNAMES (exactly today's rule), or, when that
 * variable is unset, the default owner's username on an account created before the cut-off
 * (config.ts OWNER_DEFAULT), so a name taken later never inherits the role.
 */
export function ownerMatch(config: OwnerConfig, user: { username: string; createdAt: Date }): boolean {
  if (config.adminUsernames.includes(user.username)) return true;
  const d = config.ownerDefault;
  return !!d && user.username === d.username && (d.createdBefore === null || user.createdAt < d.createdBefore);
}

export async function isOwner(db: Db, config: OwnerConfig, userId: string): Promise<boolean> {
  const [u] = await db
    .select({ username: users.username, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!u && ownerMatch(config, u);
}

/** The signed-in owner's id: 401 when signed out, 404 for everyone else (the routes don't exist for them). */
export async function requireOwner(req: FastifyRequest, ctx: { db: Db; config: OwnerConfig }): Promise<string> {
  const me = requireUser(req);
  if (!(await isOwner(ctx.db, ctx.config, me))) throw notFound();
  return me;
}

/** One line for the start-up log: who the owner is, and a warning when nobody can be. */
export async function ownerStartupNote(db: Db, config: OwnerConfig): Promise<{ level: 'info' | 'warn'; message: string }> {
  const d = config.ownerDefault;
  if (d) {
    const [u] = await db
      .select({ username: users.username, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.username, d.username))
      .limit(1);
    if (u && ownerMatch(config, u)) {
      return { level: 'info', message: `Owner: ${d.username} (default; set ADMIN_USERNAMES to change)` };
    }
    const when = d.createdBefore ? ` created before ${d.createdBefore.toISOString().slice(0, 10)}` : '';
    return {
      level: 'warn',
      message: `Owner: nobody. The default owner is the account ${d.username}${when}, and there is none here. Set ADMIN_USERNAMES to choose.`,
    };
  }
  if (config.adminUsernames.length === 0) {
    return { level: 'warn', message: 'Owner: nobody (ADMIN_USERNAMES is empty): no one can moderate or change words.' };
  }
  return { level: 'info', message: `Owner: ${config.adminUsernames.join(', ')} (ADMIN_USERNAMES)` };
}
