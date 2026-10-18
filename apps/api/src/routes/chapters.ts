import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import {
  ChapterListQuery,
  CreateChapterInput,
  CreateContributionInput,
  InviteUsersInput,
  UpdateChapterInput,
  UpdateContributionInput,
  type ChapterDetail,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { chapterPeople, chapters, contributions, eventParticipants, events, ideas, media, users } from '../db/schema.ts';
import {
  canReach,
  chapterPerson,
  eventParticipant,
  idParam,
  isActiveCrewMember,
  loadVisibleChapter,
  loadVisibleEvent,
} from '../lib/access.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { notify } from '../lib/notify.ts';
import { chapterSummaries, iso, toMediaRef, toUserSummary, userColumns, userSummary } from '../lib/queries.ts';
import type { MediaStorage } from '../lib/storage.ts';
import { parse } from '../lib/validate.ts';

const author = alias(users, 'author');
const speaker = alias(users, 'speaker');

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** The calendar date an instant falls on in a given zone, as YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

async function chapterRoles(db: Db, chapter: { id: string; createdBy: string | null }, userId: string) {
  const person = await chapterPerson(db, chapter.id, userId);
  const isCreator = chapter.createdBy === userId;
  return {
    isPerson: !!person,
    isOrganizer: isCreator || person?.role === 'organizer',
    canContribute: isCreator || !!person,
  };
}

export async function loadChapterDetail(db: Db, viewerId: string, chapterId: string): Promise<ChapterDetail> {
  const [summary] = await chapterSummaries(db, viewerId, eq(chapters.id, chapterId));
  if (!summary) throw notFound('That chapter');
  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
  const roles = await chapterRoles(db, chapter!, viewerId);

  const people = await db
    .select({ ...userColumns, role: chapterPeople.role })
    .from(chapterPeople)
    .innerJoin(users, eq(users.id, chapterPeople.userId))
    .where(eq(chapterPeople.chapterId, chapterId))
    .orderBy(sql`case ${chapterPeople.role} when 'organizer' then 0 else 1 end`, asc(users.displayName));

  const rows = await db
    .select({
      c: contributions,
      authorId: author.id,
      authorUsername: author.username,
      authorName: author.displayName,
      authorAvatar: author.avatarMediaId,
      speakerId: speaker.id,
      speakerUsername: speaker.username,
      speakerName: speaker.displayName,
      speakerAvatar: speaker.avatarMediaId,
      mediaId: media.id,
      mediaMime: media.mimeType,
      mediaWidth: media.width,
      mediaHeight: media.height,
    })
    .from(contributions)
    .leftJoin(author, eq(author.id, contributions.authorId))
    .leftJoin(speaker, eq(speaker.id, contributions.speakerUserId))
    .leftJoin(media, eq(media.id, contributions.mediaId))
    .where(eq(contributions.chapterId, chapterId))
    .orderBy(asc(contributions.createdAt));

  let event: ChapterDetail['event'] = null;
  if (chapter!.eventId) {
    const visible = await loadVisibleEvent(db, viewerId, chapter!.eventId).catch(() => null);
    if (visible) event = { id: visible.id, title: visible.title };
  }

  return {
    ...summary,
    createdBy: await userSummary(db, chapter!.createdBy),
    people: people.map((p) => ({ user: toUserSummary(p), role: p.role })),
    contributions: rows.map((r) => ({
      id: r.c.id,
      type: r.c.type,
      author:
        r.authorId && r.authorUsername && r.authorName
          ? toUserSummary({
              id: r.authorId,
              username: r.authorUsername,
              displayName: r.authorName,
              avatarMediaId: r.authorAvatar,
            })
          : null,
      title: r.c.title,
      body: r.c.body,
      caption: r.c.caption,
      context: r.c.context,
      speaker:
        r.c.type === 'quote'
          ? {
              user:
                r.speakerId && r.speakerUsername && r.speakerName
                  ? toUserSummary({
                      id: r.speakerId,
                      username: r.speakerUsername,
                      displayName: r.speakerName,
                      avatarMediaId: r.speakerAvatar,
                    })
                  : null,
              name: r.c.speakerName,
            }
          : null,
      media:
        r.mediaId && r.mediaMime
          ? toMediaRef({ id: r.mediaId, mimeType: r.mediaMime, width: r.mediaWidth, height: r.mediaHeight })
          : null,
      createdAt: iso(r.c.createdAt),
      updatedAt: iso(r.c.updatedAt),
      canEdit: r.c.authorId === viewerId,
      canDelete: r.c.authorId === viewerId || roles.isOrganizer,
    })),
    event,
    canEdit: roles.isOrganizer,
    canContribute: roles.canContribute,
    isPerson: roles.isPerson,
  };
}

/** Everyone a chapter belongs to (its people and its creator), for notifications. */
async function chapterAudience(db: Db, chapter: { id: string; createdBy: string | null }) {
  const rows = await db.select({ userId: chapterPeople.userId }).from(chapterPeople).where(eq(chapterPeople.chapterId, chapter.id));
  return [...rows.map((r) => r.userId), ...(chapter.createdBy ? [chapter.createdBy] : [])];
}

async function deleteMediaFiles(db: Db, storage: MediaStorage, where: ReturnType<typeof eq>) {
  const files = await db.select({ key: media.storageKey }).from(media).where(where);
  await Promise.all(files.map((f) => storage.delete(f.key)));
}

export async function chapterRoutes(app: FastifyInstance, { db, storage }: AppContext) {
  async function requireOrganizer(chapterId: string, userId: string) {
    const chapter = await loadVisibleChapter(db, userId, chapterId);
    const roles = await chapterRoles(db, chapter, userId);
    if (!roles.isOrganizer) throw forbidden('Only the chapter’s organizers can change that.');
    return chapter;
  }

  async function addPeople(chapterId: string, adderId: string, userIds: string[], role: 'organizer' | 'participant' = 'participant') {
    const existing = await db
      .select({ userId: chapterPeople.userId })
      .from(chapterPeople)
      .where(eq(chapterPeople.chapterId, chapterId));
    const skip = new Set(existing.map((e) => e.userId));
    const fresh: string[] = [];
    for (const id of new Set(userIds)) {
      if (skip.has(id)) continue;
      if (id !== adderId && !(await canReach(db, adderId, id))) {
        throw badRequest('You can only add your friends or people you share a crew with.');
      }
      fresh.push(id);
    }
    if (fresh.length) {
      await db
        .insert(chapterPeople)
        .values(fresh.map((userId) => ({ chapterId, userId, role, addedBy: adderId })))
        .onConflictDoNothing();
    }
    return fresh;
  }

  async function announceChapter(chapterId: string, title: string, actorId: string, recipients: string[]) {
    const actor = await userSummary(db, actorId);
    await notify(db, recipients, {
      type: 'chapter_added',
      actorId,
      title: `${actor?.displayName} added you to the chapter “${title}”`,
      href: `/chapters/${chapterId}`,
    });
  }

  /** The Lorebook: every chapter you can see, newest memories first. */
  app.get('/chapters', async (req) => {
    const me = requireUser(req);
    const q = parse(ChapterListQuery, req.query);
    const term = q.q ? `%${escapeLike(q.q)}%` : null;
    return chapterSummaries(
      db,
      me,
      and(
        q.crewId ? eq(chapters.crewId, q.crewId) : undefined,
        q.year
          ? sql`${chapters.occurredOn} >= ${`${q.year}-01-01`} and ${chapters.occurredOn} <= ${`${q.year}-12-31`}`
          : undefined,
        q.personId
          ? or(
              eq(chapters.createdBy, q.personId),
              sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${q.personId})`,
            )
          : undefined,
        term
          ? or(
              ilike(chapters.title, term),
              ilike(chapters.summary, term),
              ilike(chapters.locationName, term),
              sql`exists (select 1 from ${contributions} where ${contributions.chapterId} = ${chapters.id} and (${contributions.body} ilike ${term} or ${contributions.caption} ilike ${term} or ${contributions.title} ilike ${term}))`,
            )
          : undefined,
      ),
    );
  });

  /** Write a chapter from scratch, including memories from before LORE existed. */
  app.post('/chapters', async (req, reply) => {
    const me = requireUser(req);
    const input = parse(CreateChapterInput, req.body);
    if (input.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }
    const [chapter] = await db
      .insert(chapters)
      .values({
        title: input.title,
        summary: input.summary ?? null,
        occurredOn: input.occurredOn,
        endedOn: input.endedOn ?? null,
        locationName: input.locationName ?? null,
        crewId: input.crewId ?? null,
        audience: input.audience ?? (input.crewId ? 'crew' : 'participants'),
        createdBy: me,
      })
      .returning({ id: chapters.id });
    const chapterId = chapter!.id;
    await addPeople(chapterId, me, [me], 'organizer');
    const added = await addPeople(chapterId, me, input.peopleIds ?? []);
    await announceChapter(chapterId, input.title, me, added);
    reply.status(201);
    return loadChapterDetail(db, me, chapterId);
  });

  /**
   * EVENT → CHAPTER. Drafts a chapter from what the event already knows. The
   * chapter keeps its own copy of the facts, so editing the event later doesn't
   * rewrite history.
   */
  app.post('/events/:id/chapter', async (req, reply) => {
    const me = requireUser(req);
    const eventId = idParam(req.params);
    const event = await loadVisibleEvent(db, me, eventId);
    const mine = await eventParticipant(db, eventId, me);
    if (!mine || (mine.role !== 'organizer' && mine.rsvp !== 'going')) {
      throw forbidden('Only people who went can start this chapter.');
    }
    if (event.status === 'canceled') throw badRequest('This event was canceled.');
    if (event.startsAt.getTime() > Date.now()) throw badRequest("It hasn't happened yet. Make some memories first!");
    const [existing] = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.eventId, eventId)).limit(1);
    if (existing) throw conflict('This event already has a chapter.', { chapterId: existing.id });

    const occurredOn = localDate(event.startsAt, event.timeZone);
    const endDate = event.endsAt ? localDate(event.endsAt, event.timeZone) : null;
    const people = await db
      .select({ userId: eventParticipants.userId, role: eventParticipants.role })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.eventId, eventId),
          or(eq(eventParticipants.rsvp, 'going'), eq(eventParticipants.role, 'organizer')),
        ),
      );

    const chapterId = await db.transaction(async (tx) => {
      const [chapter] = await tx
        .insert(chapters)
        .values({
          title: event.title,
          occurredOn,
          endedOn: endDate && endDate !== occurredOn ? endDate : null,
          locationName: event.locationName,
          crewId: event.crewId,
          eventId,
          audience: event.audience === 'crew' && event.crewId ? 'crew' : 'participants',
          createdBy: me,
        })
        .returning({ id: chapters.id });
      const rows = new Map(people.map((p) => [p.userId, p.role]));
      rows.set(me, 'organizer');
      await tx
        .insert(chapterPeople)
        .values([...rows].map(([userId, role]) => ({ chapterId: chapter!.id, userId, role, addedBy: me })));
      if (event.status !== 'completed') {
        await tx.update(events).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(events.id, eventId));
        if (event.ideaId) {
          await tx
            .update(ideas)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(and(eq(ideas.id, event.ideaId), inArray(ideas.status, ['scheduled', 'planning'])));
        }
      }
      return chapter!.id;
    });

    await announceChapter(chapterId, event.title, me, people.map((p) => p.userId));
    reply.status(201);
    return loadChapterDetail(db, me, chapterId);
  });

  app.get('/chapters/:id', async (req) => loadChapterDetail(db, requireUser(req), idParam(req.params)));

  app.patch('/chapters/:id', async (req) => {
    const me = requireUser(req);
    const chapterId = idParam(req.params);
    const chapter = await requireOrganizer(chapterId, me);
    const input = parse(UpdateChapterInput, req.body);
    const crewId = input.crewId === undefined ? chapter.crewId : input.crewId;
    const occurredOn = input.occurredOn ?? chapter.occurredOn;
    const endedOn = input.endedOn === undefined ? chapter.endedOn : input.endedOn;
    if ((input.audience ?? chapter.audience) === 'crew' && !crewId) {
      throw badRequest('Pick a crew to share with the crew', { crewId: 'Required' });
    }
    if (endedOn && endedOn < occurredOn) throw badRequest('The end must be after the start', { endedOn: 'Too early' });
    if (input.crewId && input.crewId !== chapter.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }
    if (input.coverMediaId) {
      const [m] = await db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.id, input.coverMediaId), eq(media.chapterId, chapterId)))
        .limit(1);
      if (!m) throw badRequest('Pick a photo from this chapter as the cover.');
    }
    await db
      .update(chapters)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
    return loadChapterDetail(db, me, chapterId);
  });

  /**
   * Shared history isn't one person's to erase: a chapter can only be deleted by
   * its creator while nobody else has contributed to it.
   */
  app.delete('/chapters/:id', async (req) => {
    const me = requireUser(req);
    const chapterId = idParam(req.params);
    const chapter = await loadVisibleChapter(db, me, chapterId);
    if (chapter.createdBy !== me) throw forbidden('Only whoever started the chapter can delete it.');
    const [others] = await db
      .select({ id: contributions.id })
      .from(contributions)
      .where(
        and(
          eq(contributions.chapterId, chapterId),
          // Former members' contributions count as other people's too.
          or(isNull(contributions.authorId), ne(contributions.authorId, me)),
        ),
      )
      .limit(1);
    if (others) throw conflict('Other people have added to this chapter, so it belongs to them too.');
    await deleteMediaFiles(db, storage, eq(media.chapterId, chapterId));
    await db.delete(chapters).where(eq(chapters.id, chapterId));
    return { ok: true };
  });

  app.post('/chapters/:id/people', async (req) => {
    const me = requireUser(req);
    const chapterId = idParam(req.params);
    const chapter = await requireOrganizer(chapterId, me);
    const { userIds } = parse(InviteUsersInput, req.body);
    const added = await addPeople(chapterId, me, userIds);
    await announceChapter(chapterId, chapter.title, me, added);
    return loadChapterDetail(db, me, chapterId);
  });

  /** Take yourself out of a chapter, or (as an organizer) remove someone. */
  app.delete('/chapters/:id/people/:userId', async (req) => {
    const me = requireUser(req);
    const chapterId = idParam(req.params);
    const target = idParam(req.params, 'userId');
    const chapter = await loadVisibleChapter(db, me, chapterId);
    if (target !== me) {
      const roles = await chapterRoles(db, chapter, me);
      if (!roles.isOrganizer) throw forbidden('Only organizers can remove people.');
      if (target === chapter.createdBy) throw forbidden('The chapter’s creator stays on it.');
    }
    await db.delete(chapterPeople).where(and(eq(chapterPeople.chapterId, chapterId), eq(chapterPeople.userId, target)));
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Contributions: each person's own piece of the story.

  app.post('/chapters/:id/contributions', async (req, reply) => {
    const me = requireUser(req);
    const chapterId = idParam(req.params);
    const chapter = await loadVisibleChapter(db, me, chapterId);
    const roles = await chapterRoles(db, chapter, me);
    if (!roles.canContribute) throw forbidden('Only people in this chapter can add to it.');
    const input = parse(CreateContributionInput, req.body);

    const values: typeof contributions.$inferInsert = { chapterId, authorId: me, type: input.type };
    if (input.type === 'story') {
      values.title = input.title ?? null;
      values.body = input.body;
    } else if (input.type === 'quote') {
      if (input.speakerUserId && !(await chapterPerson(db, chapterId, input.speakerUserId))) {
        throw badRequest('The speaker has to be someone in this chapter.', { speakerUserId: 'Not in this chapter' });
      }
      values.body = input.body;
      values.speakerUserId = input.speakerUserId ?? null;
      values.speakerName = input.speakerUserId ? null : (input.speakerName ?? null);
      values.context = input.context ?? null;
    } else {
      const [m] = await db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.id, input.mediaId), eq(media.ownerId, me), eq(media.chapterId, chapterId)))
        .limit(1);
      if (!m) throw badRequest('Upload the photo to this chapter first.');
      const [used] = await db.select({ id: contributions.id }).from(contributions).where(eq(contributions.mediaId, m.id)).limit(1);
      if (used) throw conflict('That photo is already in the chapter.');
      values.mediaId = m.id;
      values.caption = input.caption ?? null;
    }
    await db.insert(contributions).values(values);

    // Use the first photo as the cover until someone picks one.
    if (input.type === 'photo' && !chapter.coverMediaId) {
      await db.update(chapters).set({ coverMediaId: values.mediaId }).where(eq(chapters.id, chapterId));
    }
    const actor = await userSummary(db, me);
    await notify(
      db,
      await chapterAudience(db, chapter),
      {
        type: 'chapter_contribution',
        actorId: me,
        title: `${actor?.displayName} added to “${chapter.title}”`,
        href: `/chapters/${chapterId}`,
      },
      { collapse: true },
    );
    reply.status(201);
    return loadChapterDetail(db, me, chapterId);
  });

  async function loadContribution(id: string, viewerId: string) {
    const [c] = await db.select().from(contributions).where(eq(contributions.id, id)).limit(1);
    if (!c) throw notFound('That contribution');
    const chapter = await loadVisibleChapter(db, viewerId, c.chapterId);
    return { c, chapter };
  }

  app.patch('/contributions/:id', async (req) => {
    const me = requireUser(req);
    const { c, chapter } = await loadContribution(idParam(req.params), me);
    if (c.authorId !== me) throw forbidden('You can only edit your own contributions.');
    const input = parse(UpdateContributionInput, req.body);
    if (input.speakerUserId && !(await chapterPerson(db, chapter.id, input.speakerUserId))) {
      throw badRequest('The speaker has to be someone in this chapter.');
    }
    await db
      .update(contributions)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(contributions.id, c.id));
    return loadChapterDetail(db, me, chapter.id);
  });

  app.delete('/contributions/:id', async (req) => {
    const me = requireUser(req);
    const { c, chapter } = await loadContribution(idParam(req.params), me);
    if (c.authorId !== me) {
      const roles = await chapterRoles(db, chapter, me);
      if (!roles.isOrganizer) throw forbidden('You can only remove your own contributions.');
    }
    if (c.mediaId) {
      await deleteMediaFiles(db, storage, eq(media.id, c.mediaId));
      await db.delete(media).where(eq(media.id, c.mediaId)); // cascades to the contribution
    } else {
      await db.delete(contributions).where(eq(contributions.id, c.id));
    }
    return loadChapterDetail(db, me, chapter.id);
  });
}
