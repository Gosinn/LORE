// Account deletion and data export (brief part XXVIII).
//
// Policy (owner, 2026-10-18): personal data is deleted; what the person added to
// shared history stays, anonymised ("a former member"). Anything that only they
// could see goes. Shared things they ran are handed to someone else so nothing is
// left without an organizer.
import { and, asc, eq, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  chapterPeople,
  chapters,
  comments,
  contributions,
  crewMembers,
  crews,
  eventParticipants,
  events,
  ideaInterest,
  ideas,
  media,
  personalEntries,
  users,
} from '../db/schema.ts';
import { signedMediaPath } from './mediaUrls.ts';
import type { MediaStorage } from './storage.ts';

export async function deleteAccount(db: Db, storage: MediaStorage, userId: string): Promise<void> {
  const filesToRemove: string[] = [];

  await db.transaction(async (tx) => {
    // Crews they own pass to the longest-standing admin, else member. A crew with no
    // one else active in it goes away (its plans and chapters stay, without a crew).
    const owned = await tx
      .select({ crewId: crewMembers.crewId })
      .from(crewMembers)
      .where(and(eq(crewMembers.userId, userId), eq(crewMembers.role, 'owner')));
    for (const { crewId } of owned) {
      const [heir] = await tx
        .select({ userId: crewMembers.userId })
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.status, 'active'), ne(crewMembers.userId, userId)))
        .orderBy(sql`case ${crewMembers.role} when 'admin' then 0 else 1 end`, asc(crewMembers.joinedAt))
        .limit(1);
      if (heir) {
        await tx
          .update(crewMembers)
          .set({ role: 'owner' })
          .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, heir.userId)));
      } else {
        await tx.delete(crews).where(eq(crews.id, crewId));
      }
    }

    // Events they organize alone get a new organizer; events nobody else is part of go.
    const organizing = await tx
      .select({ eventId: eventParticipants.eventId })
      .from(eventParticipants)
      .where(and(eq(eventParticipants.userId, userId), eq(eventParticipants.role, 'organizer')));
    for (const { eventId } of organizing) {
      const others = await tx
        .select({ userId: eventParticipants.userId, role: eventParticipants.role })
        .from(eventParticipants)
        .where(and(eq(eventParticipants.eventId, eventId), ne(eventParticipants.userId, userId)))
        .orderBy(
          sql`case ${eventParticipants.rsvp} when 'going' then 0 when 'maybe' then 1 when 'invited' then 2 else 3 end`,
          asc(eventParticipants.createdAt),
        );
      if (others.length === 0) {
        await tx.delete(events).where(eq(events.id, eventId));
      } else if (!others.some((o) => o.role === 'organizer')) {
        await tx
          .update(eventParticipants)
          .set({ role: 'organizer' })
          .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, others[0]!.userId)));
      }
    }

    // Chapters: private journal entries go. Shared ones they ran get a new organizer.
    const journal = await tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.createdBy, userId), eq(chapters.audience, 'only_me')));
    const involved = await tx
      .select({ chapterId: chapterPeople.chapterId })
      .from(chapterPeople)
      .where(eq(chapterPeople.userId, userId));
    const created = await tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.createdBy, userId));
    const chapterIds = new Set([...involved.map((c) => c.chapterId), ...created.map((c) => c.id)]);
    const journalIds = new Set(journal.map((j) => j.id));
    for (const chapterId of chapterIds) {
      if (journalIds.has(chapterId)) continue;
      const others = await tx
        .select({ userId: chapterPeople.userId, role: chapterPeople.role })
        .from(chapterPeople)
        .where(and(eq(chapterPeople.chapterId, chapterId), ne(chapterPeople.userId, userId)))
        .orderBy(asc(chapterPeople.createdAt));
      const [foreign] = await tx
        .select({ id: contributions.id })
        .from(contributions)
        .where(and(eq(contributions.chapterId, chapterId), or(isNull(contributions.authorId), ne(contributions.authorId, userId))))
        .limit(1);
      if (others.length === 0 && !foreign) {
        journalIds.add(chapterId); // nobody else is in it or added to it: it was effectively theirs alone
      } else if (others.length && !others.some((o) => o.role === 'organizer')) {
        await tx
          .update(chapterPeople)
          .set({ role: 'organizer' })
          .where(and(eq(chapterPeople.chapterId, chapterId), eq(chapterPeople.userId, others[0]!.userId)));
      }
    }
    if (journalIds.size) {
      const ids = [...journalIds];
      const files = await tx.select({ key: media.storageKey }).from(media).where(inArray(media.chapterId, ids));
      filesToRemove.push(...files.map((f) => f.key));
      await tx.delete(chapters).where(inArray(chapters.id, ids));
    }

    // Ideas only they (or their friends, through them) could see go; crew ideas stay.
    await tx
      .delete(ideas)
      .where(and(eq(ideas.createdBy, userId), or(ne(ideas.audience, 'crew'), isNull(ideas.crewId))));

    // Their files that aren't part of shared history (profile pictures, unused uploads).
    const unused = await tx
      .select({ id: media.id, key: media.storageKey })
      .from(media)
      .where(
        and(
          eq(media.ownerId, userId),
          notExists(tx.select({ x: sql`1` }).from(contributions).where(eq(contributions.mediaId, media.id))),
          notExists(tx.select({ x: sql`1` }).from(chapters).where(eq(chapters.coverMediaId, media.id))),
        ),
      );
    if (unused.length) {
      await tx.update(users).set({ avatarMediaId: null }).where(eq(users.id, userId));
      await tx.delete(media).where(inArray(media.id, unused.map((u) => u.id)));
      filesToRemove.push(...unused.map((u) => u.key));
    }

    // The account itself. Sessions, friendships, blocks, memberships, RSVPs, chapter
    // listings, interest, personal calendar and notifications cascade; contributions,
    // comments and shared photos are kept with their author set to null.
    await tx.delete(users).where(eq(users.id, userId));
  });

  await Promise.all(filesToRemove.map((key) => storage.delete(key).catch(() => undefined)));
}

/** Everything a person has put into LORE, as plain JSON (brief part XXVIII, data export). */
export async function exportAccount(db: Db, userId: string) {
  const [user] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      bio: users.bio,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  const crewRows = await db
    .select({ name: crews.name, role: crewMembers.role, status: crewMembers.status, joinedAt: crewMembers.joinedAt })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(eq(crewMembers.userId, userId));

  const eventRows = await db
    .select({
      title: events.title,
      description: events.description,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      locationName: events.locationName,
      status: events.status,
      myRole: eventParticipants.role,
      myRsvp: eventParticipants.rsvp,
    })
    .from(eventParticipants)
    .innerJoin(events, eq(events.id, eventParticipants.eventId))
    .where(eq(eventParticipants.userId, userId))
    .orderBy(asc(events.startsAt));

  const ideaRows = await db
    .select({
      title: ideas.title,
      description: ideas.description,
      status: ideas.status,
      whereNote: ideas.whereNote,
      whenNote: ideas.whenNote,
      budgetNote: ideas.budgetNote,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .where(eq(ideas.createdBy, userId));
  const interested = await db
    .select({ title: ideas.title })
    .from(ideaInterest)
    .innerJoin(ideas, eq(ideas.id, ideaInterest.ideaId))
    .where(eq(ideaInterest.userId, userId));

  const chapterRows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      summary: chapters.summary,
      occurredOn: chapters.occurredOn,
      endedOn: chapters.endedOn,
      locationName: chapters.locationName,
    })
    .from(chapters)
    .where(
      or(
        eq(chapters.createdBy, userId),
        sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${userId})`,
      ),
    )
    .orderBy(asc(chapters.occurredOn));
  const mine = await db
    .select({
      chapterId: contributions.chapterId,
      type: contributions.type,
      title: contributions.title,
      body: contributions.body,
      caption: contributions.caption,
      context: contributions.context,
      speakerName: contributions.speakerName,
      mediaId: contributions.mediaId,
      createdAt: contributions.createdAt,
    })
    .from(contributions)
    .where(eq(contributions.authorId, userId))
    .orderBy(asc(contributions.createdAt));

  const personal = await db
    .select({
      title: personalEntries.title,
      startsAt: personalEntries.startsAt,
      endsAt: personalEntries.endsAt,
      allDay: personalEntries.allDay,
      notes: personalEntries.notes,
    })
    .from(personalEntries)
    .where(eq(personalEntries.userId, userId))
    .orderBy(asc(personalEntries.startsAt));

  const commentRows = await db
    .select({ body: comments.body, createdAt: comments.createdAt })
    .from(comments)
    .where(eq(comments.authorId, userId))
    .orderBy(asc(comments.createdAt));

  return {
    exportedAt: new Date().toISOString(),
    format: 'lore-export/1',
    profile: user,
    crews: crewRows,
    events: eventRows,
    ideas: { created: ideaRows, interestedIn: interested.map((i) => i.title) },
    chapters: chapterRows.map((c) => ({
      ...c,
      myContributions: mine
        .filter((m) => m.chapterId === c.id)
        .map(({ chapterId: _chapterId, mediaId, ...rest }) => ({
          ...rest,
          photo: mediaId ? signedMediaPath(mediaId) : null,
        })),
    })),
    personalCalendar: personal,
    comments: commentRows,
  };
}
