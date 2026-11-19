// Account deletion and data export (brief part XXVIII).
//
// Policy (owner, 2026-10-18): personal data is deleted; what the person added to
// shared history stays, anonymised ("a former member"). Anything that only they
// could see goes. Shared things they ran are handed to someone else so nothing is
// left without an organizer.
import { and, asc, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  blocks,
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
  loracleSpend,
  media,
  notes,
  oracleReadings,
  oracleSettings,
  personalEntries,
  reports,
  supportMessages,
  users,
  wishes,
  wishRoads,
  wishWaypoints,
} from '../db/schema.ts';
import { approximatePoint, placeAccess, placeFor } from './access.ts';
import { wishJobsFor } from './loracle/jobs.ts';
import { signedMediaPath } from './mediaUrls.ts';
import type { MediaStorage } from './storage.ts';

export async function deleteAccount(db: Db, storage: MediaStorage, userId: string): Promise<void> {
  const filesToRemove: string[] = [];

  // The Loracle: stop any road still being drawn. The wishes, roads and waypoints cascade with the
  // account below; spend rows keep no text and lose their user (set null). A job that finishes late
  // finds its run gone and writes nothing.
  const jobs = wishJobsFor(db);
  if (jobs) {
    const drawing = await db
      .select({ id: wishes.id })
      .from(wishes)
      .where(and(eq(wishes.userId, userId), inArray(wishes.status, ['listening', 'moon'])));
    for (const { id } of drawing) jobs.abort(id);
  }

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

    // Their messages to support go with them (they hold their email address).
    await tx.delete(supportMessages).where(eq(supportMessages.userId, userId));

    // Places on what survives of theirs (shared plans, chapters, crew ideas): once they're gone nobody
    // is the author, so keep no point only they could have. "Only me" points go, approximate ones
    // are kept rounded (what everyone else already got), and with "Show my places on maps" off no
    // point stays at all. Nor with any block, either way: blocks go with the account, and a former
    // member's point reaches everyone who sees the item (lib/access.ts), the people on either side of
    // a block too, who never got it. Names stay, like the rest of the shared record.
    const [owner] = await tx.select({ showPlaces: users.showPlaces }).from(users).where(eq(users.id, userId));
    const [blocked] = await tx
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)))
      .limit(1);
    const placeTables = [
      { table: chapters, col: chapters },
      { table: events, col: events },
      { table: ideas, col: ideas },
    ] as const;
    for (const { table, col } of placeTables) {
      const theirs = and(eq(col.createdBy, userId), isNotNull(col.lat));
      if (!owner?.showPlaces || blocked) {
        await tx.update(table).set({ lat: null, lon: null }).where(theirs);
        continue;
      }
      await tx.update(table).set({ lat: null, lon: null }).where(and(theirs, eq(col.placePrecision, 'only_me')));
      const approximate = await tx
        .select({ id: col.id, lat: col.lat, lon: col.lon })
        .from(table)
        .where(and(theirs, eq(col.placePrecision, 'approximate')));
      for (const r of approximate) {
        if (r.lat == null || r.lon == null) continue;
        await tx.update(table).set(approximatePoint(r.lat, r.lon)).where(eq(col.id, r.id));
      }
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
      showPlacesOnMaps: users.showPlaces,
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
      lat: events.lat,
      lon: events.lon,
      placePrecision: events.placePrecision,
      placeAccess: placeAccess(events.createdBy, userId),
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
      locationName: ideas.locationName,
      lat: ideas.lat,
      lon: ideas.lon,
      placePrecision: ideas.placePrecision,
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
      lat: chapters.lat,
      lon: chapters.lon,
      placePrecision: chapters.placePrecision,
      placeAccess: placeAccess(chapters.createdBy, userId),
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

  const noteRows = await db
    .select({ body: notes.body, remindAt: notes.remindAt, doneAt: notes.doneAt, pinned: notes.pinned, createdAt: notes.createdAt })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(asc(notes.createdAt));

  const [oracle] = await db
    .select({
      homeLabel: oracleSettings.homeLabel,
      homeLat: oracleSettings.homeLat,
      homeLon: oracleSettings.homeLon,
      homeCountry: oracleSettings.homeCountry,
      radiusKm: oracleSettings.radiusKm,
      timeZone: oracleSettings.timeZone,
      interests: oracleSettings.interests,
    })
    .from(oracleSettings)
    .where(eq(oracleSettings.userId, userId));
  const [loracleSettings] = await db
    .select({ consentAt: oracleSettings.loracleConsentAt, context: oracleSettings.loracleContext })
    .from(oracleSettings)
    .where(eq(oracleSettings.userId, userId));
  const readings = await db
    .select({ day: oracleReadings.day, mode: oracleReadings.mode, futures: oracleReadings.futures, createdAt: oracleReadings.createdAt })
    .from(oracleReadings)
    .where(eq(oracleReadings.userId, userId))
    .orderBy(asc(oracleReadings.createdAt));

  const loracle = await exportLoracle(db, userId);

  const reportRows = await db
    .select({ targetType: reports.targetType, reason: reports.reason, details: reports.details, status: reports.status, createdAt: reports.createdAt })
    .from(reports)
    .where(eq(reports.reporterId, userId))
    .orderBy(asc(reports.createdAt));
  const supportRows = await db
    .select({ topic: supportMessages.topic, body: supportMessages.body, replyTo: supportMessages.replyTo, createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.userId, userId))
    .orderBy(asc(supportMessages.createdAt));

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
    // Places: yours exactly, with how you share them; other people's only as you may see them (lib/access.ts).
    events: eventRows.map(({ lat, lon, placePrecision, placeAccess: access, ...e }) => ({
      ...e,
      place: placeFor(access, { lat, lon, precision: placePrecision }),
    })),
    ideas: {
      created: ideaRows.map(({ lat, lon, placePrecision, ...i }) => ({
        ...i,
        place: placeFor('own', { lat, lon, precision: placePrecision }),
      })),
      interestedIn: interested.map((i) => i.title),
    },
    chapters: chapterRows.map(({ lat, lon, placePrecision, placeAccess: access, ...c }) => ({
      ...c,
      place: placeFor(access, { lat, lon, precision: placePrecision }),
      myContributions: mine
        .filter((m) => m.chapterId === c.id)
        .map(({ chapterId: _chapterId, mediaId, ...rest }) => ({
          ...rest,
          photo: mediaId ? signedMediaPath(mediaId) : null,
        })),
    })),
    personalCalendar: personal,
    notesAndReminders: noteRows,
    oracle: { settings: oracle ?? null, readings },
    loracle: {
      consentAt: loracleSettings?.consentAt ?? null,
      context: loracleSettings?.context ?? null,
      ...loracle,
    },
    reportsYouFiled: reportRows,
    messagesToSupport: supportRows,
    comments: commentRows,
  };
}

/**
 * The Loracle's part of the export: every wish with its road, waypoints, what the stone found (the
 * ledger's notes and gaps) and what the weighing read in the wish about the Lorer (its tags, the
 * wish beneath the wish, the binds, the companion and the clock). Left out, as internal working
 * notes deleted with the wish: the weighing's search plans and lists, the forge, raw dossiers and
 * the waypoints' note ids. Spend rows carry no text.
 */
async function exportLoracle(db: Db, userId: string) {
  const wishRows = await db
    .select({
      id: wishes.id,
      text: wishes.text,
      context: wishes.context,
      realm: wishes.realm,
      timeZone: wishes.timeZone,
      day: wishes.day,
      status: wishes.status,
      weighing: wishes.weighing,
      ledger: wishes.ledger,
      fulfilledAt: wishes.fulfilledAt,
      releasedAt: wishes.releasedAt,
      createdAt: wishes.createdAt,
    })
    .from(wishes)
    .where(eq(wishes.userId, userId))
    .orderBy(asc(wishes.createdAt));
  const ids = wishRows.map((w) => w.id);
  const roadRows = ids.length
    ? await db
        .select({
          id: wishRoads.id,
          wishId: wishRoads.wishId,
          n: wishRoads.n,
          status: wishRoads.status,
          signs: wishRoads.signs,
          quest: wishRoads.quest,
          readyAt: wishRoads.readyAt,
          createdAt: wishRoads.createdAt,
        })
        .from(wishRoads)
        .where(inArray(wishRoads.wishId, ids))
        .orderBy(asc(wishRoads.n))
    : [];
  const waypointRows = ids.length
    ? await db
        .select({
          roadId: wishWaypoints.roadId,
          position: wishWaypoints.position,
          kind: wishWaypoints.kind,
          emblem: wishWaypoints.emblem,
          name: wishWaypoints.name,
          when: wishWaypoints.when,
          at: wishWaypoints.at,
          place: wishWaypoints.place,
          town: wishWaypoints.town,
          country: wishWaypoints.country,
          lat: wishWaypoints.lat,
          lon: wishWaypoints.lon,
          clue: wishWaypoints.clue,
          lore: wishWaypoints.lore,
          trial: wishWaypoints.trial,
          person: wishWaypoints.person,
          earns: wishWaypoints.earns,
          mystery: wishWaypoints.mystery,
          steps: wishWaypoints.steps,
          sealBrokenAt: wishWaypoints.sealBrokenAt,
          inkedOn: wishWaypoints.inkedOn,
          note: wishWaypoints.note,
          eventId: wishWaypoints.eventId,
          ideaId: wishWaypoints.ideaId,
          chapterId: wishWaypoints.chapterId,
          reminderId: wishWaypoints.reminderId,
        })
        .from(wishWaypoints)
        .where(inArray(wishWaypoints.wishId, ids))
        .orderBy(asc(wishWaypoints.position))
    : [];
  const spend = await db
    .select({
      utcDay: loracleSpend.utcDay,
      stage: loracleSpend.stage,
      outcome: loracleSpend.outcome,
      costMicros: loracleSpend.costMicros,
    })
    .from(loracleSpend)
    .where(eq(loracleSpend.userId, userId))
    .orderBy(asc(loracleSpend.createdAt));

  return {
    wishes: wishRows.map(({ id, ledger, weighing, ...wish }) => ({
      ...wish,
      weighing: weighing
        ? {
            tags: weighing.tags ?? [],
            desire: weighing.desire ?? null,
            binds: weighing.binds ?? [],
            companion: weighing.companion ?? null,
            clock: weighing.clock ?? null,
          }
        : null,
      ledger: ledger ? { notes: ledger.notes ?? [], gaps: ledger.gaps ?? [] } : null,
      roads: roadRows
        .filter((r) => r.wishId === id)
        .map(({ id: roadId, wishId: _wishId, ...road }) => ({
          ...road,
          waypoints: waypointRows.filter((w) => w.roadId === roadId).map(({ roadId: _roadId, ...w }) => w),
        })),
    })),
    spend,
  };
}
