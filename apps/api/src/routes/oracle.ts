import { and, desc, eq, gte, inArray, lt, ne, not, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  ChooseFutureInput,
  GeocodeQuery,
  INTERESTS,
  NewReadingInput,
  ORACLE_READINGS_PER_DAY,
  OracleSettingsInput,
  ReverseGeocodeQuery,
  type CrewRef,
  type Future,
  type GeocodeResult,
  type Interest,
  type OracleMode,
  type OracleReading,
  type OracleSettings,
  type OracleSign,
  type OracleState,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import {
  chapterPeople,
  chapters,
  crewMembers,
  crews,
  eventParticipants,
  events,
  ideaInterest,
  ideas,
  oracleReadings,
  oracleSettings,
  personalEntries,
} from '../db/schema.ts';
import { ideaVisible, idParam, isActiveCrewMember, loadVisibleIdea } from '../lib/access.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { generateFutures, signsWithoutDistance, withoutDistance, type FutureDraft } from '../lib/oracle.ts';
import { iso } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The daily sign (GET /oracle/sign) is kept as a reading with this `mode`. It is dealt as 'mixed',
 * never counts toward the day's readings, and never shows as the day's reading in GET /oracle.
 */
const SIGN = 'sign';
/** The sign stays near: within a day's reach (the engine's journey line), whatever the old Futures radius says. */
const SIGN_REACH_KM = 250;
/**
 * Signs dealt in one Lorer's day, at most: the first, plus a new one after a move or once every moment in
 * it has passed. Each deal is a full draw (the world's places and weather), so it is never unbounded.
 */
const SIGN_DEALS_PER_DAY = 3;

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const localDay = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/**
 * The Oracle: possible futures from the world around you, your free time, crews,
 * ideas and memories. Everything here is private to its owner: where your realm
 * is, what you're into, and what the stones showed you.
 */
export async function oracleRoutes(app: FastifyInstance, { db, world }: AppContext) {
  async function settingsRow(me: string) {
    const [row] = await db.select().from(oracleSettings).where(eq(oracleSettings.userId, me)).limit(1);
    return row;
  }

  async function loadSettings(me: string): Promise<OracleSettings> {
    return toSettings(await settingsRow(me));
  }

  function toSettings(row: typeof oracleSettings.$inferSelect | undefined): OracleSettings {
    if (!row) return { home: null, radiusKm: 80, interests: [], timeZone: 'UTC' };
    return {
      home:
        row.homeLabel && row.homeLat != null && row.homeLon != null
          ? { label: row.homeLabel, lat: row.homeLat, lon: row.homeLon }
          : null,
      radiusKm: row.radiusKm,
      interests: row.interests.filter((i): i is Interest => (INTERESTS as readonly string[]).includes(i)),
      timeZone: row.timeZone,
    };
  }

  /** Readings asked for today. The daily sign is a gift, not a reading: it never counts. */
  async function readingsToday(me: string, tz: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(oracleReadings)
      .where(and(eq(oracleReadings.userId, me), eq(oracleReadings.day, localDay(new Date(), tz)), ne(oracleReadings.mode, SIGN)));
    return row?.n ?? 0;
  }

  function toReading(row: typeof oracleReadings.$inferSelect, used: number): OracleReading {
    return {
      id: row.id,
      mode: (row.mode === SIGN ? 'mixed' : row.mode) as OracleMode,
      createdAt: iso(row.createdAt),
      futures: row.futures as Future[],
      readingsLeftToday: Math.max(0, ORACLE_READINGS_PER_DAY - used),
    };
  }

  async function loadOwnReading(me: string, id: string) {
    const [row] = await db
      .select()
      .from(oracleReadings)
      .where(and(eq(oracleReadings.id, id), eq(oracleReadings.userId, me)))
      .limit(1);
    if (!row) throw notFound('That reading');
    return row;
  }

  async function updateFuture(me: string, readingId: string, index: number, patch: Partial<Future>) {
    const row = await loadOwnReading(me, readingId);
    const futures = (row.futures as Future[]).map((f) => (f.index === index ? { ...f, ...patch } : f));
    await db.update(oracleReadings).set({ futures }).where(eq(oracleReadings.id, readingId));
    const settings = await loadSettings(me);
    return toReading({ ...row, futures }, await readingsToday(me, settings.timeZone));
  }

  async function futureFor(me: string, params: unknown) {
    const readingId = idParam(params);
    const index = Number((params as { index?: string }).index);
    const row = await loadOwnReading(me, readingId);
    const future = (row.futures as Future[]).find((f) => f.index === index);
    if (!future) throw notFound('That future');
    return { readingId, future };
  }

  /**
   * Asks the engine for futures around the Lorer's home: the world near it (sky, weather, places
   * within `radiusKm`), their free time, crews, ideas and memories, and the places shown lately.
   * `recentExcept` leaves some readings out of "shown lately" (the sign leaves out today's signs, so
   * dealing it again gives the same answer).
   */
  async function draw(
    me: string,
    home: { lat: number; lon: number },
    interests: Interest[],
    opts: { now: Date; mode: OracleMode; radiusKm: number; seed: string; recentExcept?: SQL },
  ): Promise<FutureDraft[]> {
    const { now, mode } = opts;
    const horizon = new Date(now.getTime() + 9 * DAY);
    const { lat, lon } = home;

    const [places, forecast, kp, personal, plans, myCrews, myIdeas, memories, recent] = await Promise.all([
      world.places(lat, lon, opts.radiusKm),
      world.forecast(lat, lon),
      world.kp(),
      db
        .select({ start: personalEntries.startsAt, end: personalEntries.endsAt, allDay: personalEntries.allDay })
        .from(personalEntries)
        .where(and(eq(personalEntries.userId, me), lt(personalEntries.startsAt, horizon), gte(personalEntries.startsAt, new Date(now.getTime() - 2 * DAY)))),
      db
        .select({ start: events.startsAt, end: events.endsAt, allDay: events.allDay })
        .from(events)
        .innerJoin(eventParticipants, and(eq(eventParticipants.eventId, events.id), eq(eventParticipants.userId, me)))
        .where(
          and(
            inArray(eventParticipants.rsvp, ['going', 'maybe']),
            ne(events.status, 'canceled'),
            lt(events.startsAt, horizon),
            gte(events.startsAt, new Date(now.getTime() - 2 * DAY)),
          ),
        ),
      db
        .select({ id: crews.id, name: crews.name, emoji: crews.emoji })
        .from(crews)
        .innerJoin(crewMembers, and(eq(crewMembers.crewId, crews.id), eq(crewMembers.userId, me), eq(crewMembers.status, 'active'))),
      db
        .select({ id: ideas.id, title: ideas.title, category: ideas.category, whereNote: ideas.whereNote, crewId: ideas.crewId })
        .from(ideas)
        .where(
          and(
            ideaVisible(me),
            inArray(ideas.status, ['dreaming', 'gathering_interest']),
            or(
              eq(ideas.createdBy, me),
              sql`exists (select 1 from ${ideaInterest} where ${ideaInterest.ideaId} = ${ideas.id} and ${ideaInterest.userId} = ${me})`,
            ),
          ),
        )
        .limit(30),
      db
        .select({ id: chapters.id, title: chapters.title, occurredOn: chapters.occurredOn, locationName: chapters.locationName })
        .from(chapters)
        .where(
          and(
            sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${me})`,
            sql`extract(year from ${chapters.occurredOn}) < extract(year from now())`,
            // Within ten days of today's date in an earlier year (wrapping at New Year).
            sql`least(abs(extract(doy from ${chapters.occurredOn}) - extract(doy from now())), 366 - abs(extract(doy from ${chapters.occurredOn}) - extract(doy from now()))) <= 10`,
          ),
        )
        .limit(10),
      db
        .select({ futures: oracleReadings.futures })
        .from(oracleReadings)
        .where(and(eq(oracleReadings.userId, me), opts.recentExcept ? not(opts.recentExcept) : undefined))
        .orderBy(desc(oracleReadings.createdAt))
        .limit(6),
    ]);

    const busy = [...personal, ...plans].map((b) => ({
      start: b.start,
      end: b.end ?? new Date(b.start.getTime() + (b.allDay ? DAY : 3 * 60 * 60 * 1000)),
    }));
    const recentPlaceIds = new Set(
      recent.flatMap((r) => (r.futures as Future[]).map((f) => f.place?.wikidataId).filter((x): x is string => !!x)),
    );
    return generateFutures({
      now,
      seed: opts.seed,
      mode,
      home: { lat, lon },
      radiusKm: opts.radiusKm,
      interests,
      forecast,
      kp,
      places,
      busy,
      crews: myCrews as CrewRef[],
      ideas: myIdeas,
      memories,
      recentPlaceIds,
    });
  }

  /**
   * Today's sign: one reading a day, dealt 'mixed' around where the Lorer stands, kept within a
   * day's reach. Only moments still ahead are offered. While they haven't answered any of it, it is
   * dealt again when they said where they stand since (homeSetAt; consent, reach and the rest don't
   * count), or when every moment in it has passed: at most SIGN_DEALS_PER_DAY deals in their day.
   * Null `sign` = the world didn't answer; try again later.
   */
  async function todaysSign(me: string, log: FastifyBaseLogger): Promise<OracleSign> {
    const row = await settingsRow(me);
    const settings = toSettings(row);
    if (!row || !settings.home) return { home: null, readingId: null, future: null };
    const home = { label: settings.home.label };
    const now = new Date();
    const today = localDay(now, settings.timeZone);
    const isTodaysSign = and(eq(oracleReadings.mode, SIGN), eq(oracleReadings.day, today))!;
    const ahead = (f: Future) => Date.parse(f.startsAt) > now.getTime();

    // Newest first. A full day's worth tells whether another may still be dealt.
    const dealt = await db
      .select()
      .from(oracleReadings)
      .where(and(eq(oracleReadings.userId, me), isTodaysSign))
      .orderBy(desc(oracleReadings.createdAt))
      .limit(SIGN_DEALS_PER_DAY);
    let sign = dealt[0];
    const shown = (sign?.futures ?? []) as Future[];
    const moved = !!sign && row.homeSetAt != null && row.homeSetAt.getTime() >= sign.createdAt.getTime();
    const passed = shown.length > 0 && !shown.some(ahead);
    const stale = !!sign && shown.every((f) => f.status === 'open') && (moved || passed);

    if (!sign || (stale && dealt.length < SIGN_DEALS_PER_DAY)) {
      let drafts: FutureDraft[];
      try {
        drafts = await draw(me, settings.home, settings.interests, {
          now,
          mode: 'mixed',
          radiusKm: Math.min(settings.radiusKm, SIGN_REACH_KM),
          seed: `${me}:${today}:${SIGN}`,
          recentExcept: isTodaysSign,
        });
      } catch (err) {
        log.warn({ err }, 'the daily sign could not be dealt');
        return { home, readingId: null, future: null };
      }
      const futures: Future[] = drafts.map((d, index) => ({ ...d, index, status: 'open', eventId: null, savedIdeaId: null }));
      // The sign it replaces is emptied, not deleted, so it still counts toward the day's deals.
      if (sign) await db.update(oracleReadings).set({ futures: [] }).where(eq(oracleReadings.id, sign.id));
      // Stamped with the app's clock, the one that stamps homeSetAt, so "since" compares like with like.
      [sign] = await db.insert(oracleReadings).values({ userId: me, day: today, mode: SIGN, futures, createdAt: new Date() }).returning();
    }
    const futures = sign!.futures as Future[];
    const future = futures.find((f) => f.status === 'chosen') ?? futures.find((f) => f.status === 'open' && ahead(f)) ?? null;
    return { home, readingId: sign!.id, future };
  }

  // Two Home screens asking at once share one dealing.
  const signing = new Map<string, Promise<OracleSign>>();

  app.get('/oracle', async (req): Promise<OracleState> => {
    const me = requireUser(req);
    const settings = await loadSettings(me);
    const today = localDay(new Date(), settings.timeZone);
    const [latest] = await db
      .select()
      .from(oracleReadings)
      .where(and(eq(oracleReadings.userId, me), eq(oracleReadings.day, today), ne(oracleReadings.mode, SIGN)))
      .orderBy(desc(oracleReadings.createdAt))
      .limit(1);
    const used = latest ? await readingsToday(me, settings.timeZone) : 0;
    return { settings, reading: latest ? toReading(latest, used) : null };
  });

  /**
   * The daily sign for Home: one small future near where the Lorer stands, dealt on the first ask
   * of their day. The best one still open, or the one they chose today. Choose or dismiss it with
   * the future endpoints below (crewId null keeps the plan to themselves).
   */
  app.get(
    '/oracle/sign',
    // Home asks once a visit; this only stops a client from driving the engine in a loop.
    { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req) => req.userId ?? req.ip } } },
    async (req): Promise<OracleSign> => {
      const me = requireUser(req);
      let pending = signing.get(me);
      if (!pending) {
        pending = todaysSign(me, req.log).finally(() => signing.delete(me));
        signing.set(me, pending);
      }
      return pending;
    },
  );

  app.put('/oracle/settings', async (req): Promise<OracleSettings> => {
    const me = requireUser(req);
    const input = parse(OracleSettingsInput, req.body);
    if (input.timeZone !== undefined && !validTimeZone(input.timeZone)) {
      throw badRequest('Unknown time zone', { timeZone: 'Unknown time zone' });
    }
    const values = {
      ...(input.home !== undefined && {
        homeLabel: input.home?.label ?? null,
        homeLat: input.home?.lat ?? null,
        homeLon: input.home?.lon ?? null,
        // A moved home's country is unknown here; the Loracle looks it up again when it needs it.
        homeCountry: null,
        homeSetAt: new Date(),
      }),
      ...(input.radiusKm !== undefined && { radiusKm: input.radiusKm }),
      ...(input.interests !== undefined && { interests: [...new Set(input.interests)] }),
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
    };
    await db
      .insert(oracleSettings)
      .values({ userId: me, ...values })
      .onConflictDoUpdate({ target: oracleSettings.userId, set: { ...values, updatedAt: new Date() } });
    return loadSettings(me);
  });

  app.get(
    '/oracle/geocode',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<GeocodeResult[]> => {
      requireUser(req);
      const { q } = parse(GeocodeQuery, req.query);
      return world.geocode(q);
    },
  );

  /**
   * "Where do you stand?" with the device's location: the town at that point (at most one; none
   * when nothing is named there). The point is rounded to two decimals before it goes anywhere.
   */
  app.get(
    '/oracle/reverse',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<GeocodeResult[]> => {
      requireUser(req);
      const { lat, lon } = parse(ReverseGeocodeQuery, req.query);
      const town = await world.reverse(lat, lon);
      return town ? [town] : [];
    },
  );

  app.post(
    '/oracle/readings',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<OracleReading> => {
      const me = requireUser(req);
      const input = parse(NewReadingInput, req.body ?? {});
      const settings = await loadSettings(me);
      if (!settings.home) throw badRequest('Set your realm first: where should the stones look?', { home: 'Required' });
      const used = await readingsToday(me, settings.timeZone);
      if (used >= ORACLE_READINGS_PER_DAY) {
        throw new HttpError(429, 'limit', 'The stones have spoken three times today. Come back tomorrow.');
      }

      const now = new Date();
      const mode = input.mode ?? 'mixed';
      const drafts = await draw(me, settings.home, settings.interests, {
        now,
        mode,
        radiusKm: settings.radiusKm,
        seed: `${me}:${localDay(now, settings.timeZone)}:${used}:${mode}`,
      });
      if (!drafts.length) {
        throw badRequest('The stones see nothing yet. Widen your realm or pick some interests, then ask again.');
      }

      const futures: Future[] = drafts.map((d, index) => ({ ...d, index, status: 'open', eventId: null, savedIdeaId: null }));
      const [row] = await db
        .insert(oracleReadings)
        .values({ userId: me, day: localDay(now, settings.timeZone), mode, futures })
        .returning();
      reply.status(201);
      return toReading(row!, used + 1);
    },
  );

  /** Choose this destiny: the future becomes a real plan, with you as organizer. */
  app.post('/oracle/readings/:id/futures/:index/choose', async (req, reply): Promise<OracleReading> => {
    const me = requireUser(req);
    const { readingId, future } = await futureFor(me, req.params);
    const input = parse(ChooseFutureInput, req.body ?? {});
    if (future.status === 'chosen' && future.eventId) return updateFuture(me, readingId, future.index, {});
    // A sign is kept all day, and its early moments pass: never a plan that starts in the past.
    if (Date.parse(future.startsAt) <= Date.now()) throw badRequest('That moment has passed.');

    let crewId: string | null = null;
    if (input.crewId) {
      if (!(await isActiveCrewMember(db, input.crewId, me))) throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
      crewId = input.crewId;
    } else if (input.crewId === undefined && future.crew && (await isActiveCrewMember(db, future.crew.id, me))) {
      crewId = future.crew.id;
    }
    const ideaId = future.ideaId ? await loadVisibleIdea(db, me, future.ideaId).then((i) => i.id, () => null) : null;
    // Everyone invited reads this, and the place's point is on the plan: its distance from home (km, or
    // hours each way) would draw a ring around where the Lorer lives. It stays on their own sign and reading.
    const story = future.place ? withoutDistance(future.story) : future.story;
    const signs = future.place ? signsWithoutDistance(future.signs) : future.signs;
    const description = [
      story,
      signs.length ? `The signs: ${signs.join(' · ')}` : null,
      future.place ? `Where: ${future.place.name}.` : null,
      future.place?.wikidataId ? `About the place: https://www.wikidata.org/wiki/${future.place.wikidataId}` : null,
      'Revealed by The Loracle.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const eventId = await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          title: future.title.slice(0, 120),
          description,
          category: future.category,
          status: 'planning',
          startsAt: new Date(future.startsAt),
          endsAt: future.endsAt ? new Date(future.endsAt) : null,
          timeZone: future.timeZone,
          locationName: future.place?.name ?? null,
          lat: future.place?.lat ?? null,
          lon: future.place?.lon ?? null,
          crewId,
          audience: crewId ? 'crew' : 'participants',
          ideaId,
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
    reply.status(201);
    return updateFuture(me, readingId, future.index, { status: 'chosen', eventId });
  });

  /** Not now, but maybe: into your Idea Vault, private to you. */
  app.post('/oracle/readings/:id/futures/:index/save', async (req): Promise<OracleReading> => {
    const me = requireUser(req);
    const { readingId, future } = await futureFor(me, req.params);
    if (future.savedIdeaId) return updateFuture(me, readingId, future.index, {});
    if (future.ideaId) return updateFuture(me, readingId, future.index, { status: 'saved', savedIdeaId: future.ideaId });

    const when = new Intl.DateTimeFormat('en', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: future.timeZone,
    }).format(new Date(future.startsAt));
    // The idea keeps the place's point, and its Lorer may share it later: no distance from home beside it
    // (see the choose path). The reading keeps the distance.
    const story = future.place ? withoutDistance(future.story) : future.story;
    const signs = future.place ? signsWithoutDistance(future.signs) : future.signs;
    const [idea] = await db
      .insert(ideas)
      .values({
        title: future.title.slice(0, 120),
        description: [story, signs.length ? `The signs: ${signs.join(' · ')}` : null].filter(Boolean).join('\n\n') || null,
        category: future.category,
        status: 'dreaming',
        audience: 'only_me',
        whereNote: future.place ? future.place.name.slice(0, 200) : null,
        whenNote: `The stones suggested ${when}`,
        // The place itself, for the Lore Map (shared approximately by default, like any idea's).
        locationName: future.place?.name.slice(0, 200) ?? null,
        lat: future.place?.lat ?? null,
        lon: future.place?.lon ?? null,
        createdBy: me,
      })
      .returning({ id: ideas.id });
    return updateFuture(me, readingId, future.index, { status: 'saved', savedIdeaId: idea!.id });
  });

  app.post('/oracle/readings/:id/futures/:index/dismiss', async (req): Promise<OracleReading> => {
    const me = requireUser(req);
    const { readingId, future } = await futureFor(me, req.params);
    if (future.status === 'chosen') throw badRequest('That destiny is already chosen.');
    return updateFuture(me, readingId, future.index, { status: 'dismissed' });
  });
}
