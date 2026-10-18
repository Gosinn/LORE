// The privacy model, enforced in SQL. Every query that returns events, ideas or
// chapters goes through one of the `*Visible` predicates below, so the rules live in
// exactly one place. See docs/ARCHITECTURE.md § Privacy and permissions.
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
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
