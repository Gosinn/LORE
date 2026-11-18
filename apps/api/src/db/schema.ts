// The LORE database. Every table is listed here; migrations in ../../drizzle are
// generated from this file with `npm run db:generate`.
//
// Deletion rules follow the brief (part XXVIII) and the owner's decision: when an
// account goes, its personal data goes with it (sessions, friendships, private
// calendar), while shared history survives anonymised: contributions, comments and
// the photos in them keep existing with their author set to null, and shared
// records (crews, events, chapters, ideas) keep existing with their creator set to
// null. The account deletion service (lib/accounts.ts) handles the rest.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AUDIENCES,
  CONTRIBUTION_TYPES,
  CREW_ROLES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  IDEA_STATUSES,
  MEMBERSHIP_STATUSES,
  NOTIFICATION_TYPES,
  PARTICIPANT_ROLES,
  ROAD_STATUSES,
  RSVP_STATUSES,
  WISH_FAILURES,
  WISH_STATUSES,
  type Emblem,
  type Keeper,
  type LoracleContext,
  type PinPrecision,
  type RoadStatus,
  type RoadStep,
  type WaypointKind,
  type WishFailure,
  type WishStatus,
} from '#shared';
import type { LedgerRecord, StoredQuest, Weighing, WishRealm } from '../lib/loracle/types.ts';

export const crewRole = pgEnum('crew_role', CREW_ROLES);
export const membershipStatus = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const eventStatus = pgEnum('event_status', EVENT_STATUSES);
export const eventCategory = pgEnum('event_category', EVENT_CATEGORIES);
export const participantRole = pgEnum('participant_role', PARTICIPANT_ROLES);
export const rsvpStatus = pgEnum('rsvp_status', RSVP_STATUSES);
export const ideaStatus = pgEnum('idea_status', IDEA_STATUSES);
export const audience = pgEnum('audience', AUDIENCES);
export const contributionType = pgEnum('contribution_type', CONTRIBUTION_TYPES);
export const notificationType = pgEnum('notification_type', NOTIFICATION_TYPES);
export const friendshipStatus = pgEnum('friendship_status', ['pending', 'accepted']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
/** A quoted SQL list for `in (…)` checks, from one of the shared vocabularies. */
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

// ---------------------------------------------------------------------------
// People

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio'),
  avatarMediaId: uuid('avatar_media_id').references((): AnyPgColumn => media.id, { onDelete: 'set null' }),
  /** When they agreed to the Terms (at sign-up). Null for accounts from before the Terms existed. */
  termsAcceptedAt: ts('terms_accepted_at'),
  /** Set by a moderator: a suspended account can't sign in. */
  suspendedAt: ts('suspended_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token. The token itself is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const friendships = pgTable(
  'friendships',
  {
    id: id(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: friendshipStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    // One row per pair, whichever direction the request went.
    uniqueIndex('friendships_pair_idx').on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    index('friendships_addressee_idx').on(t.addresseeId),
    check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
);

// ---------------------------------------------------------------------------
// Crews

export const crews = pgTable('crews', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  emoji: text('emoji').notNull().default('🔥'),
  membersCanInvite: boolean('members_can_invite').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const crewMembers = pgTable(
  'crew_members',
  {
    crewId: uuid('crew_id')
      .notNull()
      .references(() => crews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: crewRole('role').notNull().default('member'),
    status: membershipStatus('status').notNull().default('invited'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    joinedAt: ts('joined_at'),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.userId] }), index('crew_members_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Idea Vault

export const ideas = pgTable(
  'ideas',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    category: eventCategory('category').notNull().default('custom'),
    status: ideaStatus('status').notNull().default('dreaming'),
    crewId: uuid('crew_id').references(() => crews.id, { onDelete: 'set null' }),
    audience: audience('audience').notNull().default('only_me'),
    whereNote: text('where_note'),
    whenNote: text('when_note'),
    budgetNote: text('budget_note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ideas_crew_idx').on(t.crewId),
    index('ideas_created_by_idx').on(t.createdBy),
    check('ideas_audience', sql`${t.audience} in ('only_me', 'friends', 'crew')`),
  ],
);

export const ideaInterest = pgTable(
  'idea_interest',
  {
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.userId] }), index('idea_interest_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Events (the LORE calendar)

export const events = pgTable(
  'events',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    category: eventCategory('category').notNull().default('gathering'),
    status: eventStatus('status').notNull().default('planning'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    allDay: boolean('all_day').notNull().default(false),
    /** IANA zone the event was planned in, for display. Instants are stored in UTC. */
    timeZone: text('time_zone').notNull(),
    locationName: text('location_name'),
    crewId: uuid('crew_id').references(() => crews.id, { onDelete: 'set null' }),
    audience: audience('audience').notNull().default('participants'),
    capacity: integer('capacity'),
    /** Where it happens, when known (e.g. chosen from the Oracle); for the Lore Map. */
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('events_crew_idx').on(t.crewId),
    index('events_starts_idx').on(t.startsAt),
    index('events_idea_idx').on(t.ideaId),
    check('events_audience', sql`${t.audience} in ('participants', 'friends', 'crew')`),
    check('events_ends_after_start', sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
  ],
);

export const eventParticipants = pgTable(
  'event_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: participantRole('role').notNull().default('participant'),
    rsvp: rsvpStatus('rsvp').notNull().default('invited'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    respondedAt: ts('responded_at'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index('event_participants_user_idx').on(t.userId)],
);

export const eventChecklistItems = pgTable(
  'event_checklist_items',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('event_checklist_event_idx').on(t.eventId)],
);

// ---------------------------------------------------------------------------
// Personal calendar. Always private to its owner; never joined into shared queries.

export const personalEntries = pgTable(
  'personal_entries',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    allDay: boolean('all_day').notNull().default(false),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('personal_entries_user_starts_idx').on(t.userId, t.startsAt)],
);

/**
 * Notes to self. With a `remind_at` a note is a reminder. Private to its owner,
 * like the personal calendar: never joined into anything shared.
 */
export const notes = pgTable(
  'notes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    remindAt: ts('remind_at'),
    doneAt: ts('done_at'),
    pinned: boolean('pinned').notNull().default(false),
    /** Optional link, e.g. "remind me about this plan". */
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notes_user_remind_idx').on(t.userId, t.remindAt), index('notes_user_created_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Safety: reports, and messages to the people running LORE

/** Someone reported a person or something they can see. Reviewed by moderators (ADMIN_USERNAMES). */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** The person reported, or whose content it is. */
    subjectId: uuid('subject_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    details: text('details'),
    /** What it said when reported, so it can be judged even after edits. */
    snapshot: text('snapshot'),
    href: text('href'),
    status: text('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
    check('reports_status', sql`${t.status} in ('open', 'actioned', 'dismissed')`),
  ],
);

/** The contact form: help, bugs, privacy requests. Anyone can write, signed in or not. */
export const supportMessages = pgTable(
  'support_messages',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    replyTo: text('reply_to'),
    topic: text('topic').notNull(),
    body: text('body').notNull(),
    handledAt: ts('handled_at'),
    createdAt: createdAt(),
  },
  (t) => [index('support_messages_created_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// The Oracle

/** Private: where someone's realm is and what they're into. Never shown to others. */
export const oracleSettings = pgTable('oracle_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  homeLabel: text('home_label'),
  homeLat: doublePrecision('home_lat'),
  homeLon: doublePrecision('home_lon'),
  radiusKm: integer('radius_km').notNull().default(80),
  /** The lore maker's own IANA zone, so "today" means their day. */
  timeZone: text('time_zone').notNull().default('UTC'),
  interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
  /** The Loracle: when the Lorer agreed to send wishes to Anthropic. Null = not agreed, or withdrawn. */
  loracleConsentAt: ts('loracle_consent_at'),
  /** ISO 3166-1 alpha-2 of the realm, from the geocoder. Goes to the mind with the realm's label. */
  homeCountry: text('home_country'),
  /** The Loracle: what the stone should know and what calls to the Lorer. Prefill and context only. */
  loracleContext: jsonb('loracle_context').$type<LoracleContext>(),
  /**
   * The Loracle: "How far will you go?" in km. Null means ANYWHERE (the default: no limit on
   * adventure, D30). Its own column, so the old Futures' day-trip radius never becomes a quest's reach.
   */
  loracleReachKm: integer('loracle_reach_km'),
  /**
   * When the Lorer last said where they stand (the home), by the app's clock. Home's daily sign is dealt
   * again when this is newer than the sign; consent, reach and the rest don't touch it. Null = not since
   * this column came.
   */
  homeSetAt: ts('home_set_at'),
  updatedAt: updatedAt(),
});

/** A reading of the stones: three futures, kept so the day's answer stays the same. */
export const oracleReadings = pgTable(
  'oracle_readings',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The reader's local calendar day, for the daily limit. */
    day: date('day', { mode: 'string' }).notNull(),
    mode: text('mode').notNull(),
    futures: jsonb('futures').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('oracle_readings_user_day_idx').on(t.userId, t.day)],
);

/** Cached answers from the open-data services (places, weather, aurora). */
export const worldCache = pgTable('world_cache', {
  key: text('key').primaryKey(),
  data: jsonb('data').notNull(),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// The Loracle: wishes and the roads the stones draw for them. Private to the Lorer (no
// audience, no crew in phase A); deleted with the account. Status values come from the
// shared vocabulary (WISH_STATUSES, ROAD_STATUSES, WISH_FAILURES).

/** A wish the Lorer cast that the weighing sent on as a quest. Care, riddle and reroute answers store nothing. */
export const wishes = pgTable(
  'wishes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** As cast; a riddle answer is appended ("I wish to be happy — like a roaring crowd"). */
    text: text('text').notNull(),
    /** sha256 of the normalised wish, for "the stone already drew this road" (same Lorer, same local day). */
    textKey: text('text_key').notNull(),
    /** What the stone was told about the Lorer at the cast. */
    context: jsonb('context').$type<LoracleContext>().notNull(),
    /** Where it was cast from: label, country, reach. No coordinates. */
    realm: jsonb('realm').$type<WishRealm>().notNull(),
    timeZone: text('time_zone').notNull(),
    /** The Lorer's local day of the cast. */
    day: date('day', { mode: 'string' }).notNull(),
    status: text('status').$type<WishStatus>().notNull().default('listening'),
    /** The weighing (tags, plans). Never sent to the client. */
    weighing: jsonb('weighing').$type<Weighing>().notNull(),
    /** What the stone found (notes, gaps, raw dossiers). Never sent to the client; notes and gaps are exported. */
    ledger: jsonb('ledger').$type<LedgerRecord>(),
    ledgerAt: ts('ledger_at'),
    fulfilledAt: ts('fulfilled_at'),
    releasedAt: ts('released_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('wishes_user_created_idx').on(t.userId, t.createdAt),
    index('wishes_user_day_key_idx').on(t.userId, t.day, t.textKey),
    index('wishes_status_idx').on(t.status),
    check('wishes_status', sql`${t.status} in (${oneOf(WISH_STATUSES)})`),
  ],
);

/** A road drawn for a wish: the scroll. One per wish in phase A (`n` = 1). */
export const wishRoads = pgTable(
  'wish_roads',
  {
    id: id(),
    wishId: uuid('wish_id')
      .notNull()
      .references(() => wishes.id, { onDelete: 'cascade' }),
    n: integer('n').notNull().default(1),
    status: text('status').$type<RoadStatus>().notNull().default('queued'),
    /** Why the last attempt failed. */
    failure: text('failure').$type<WishFailure>(),
    attempts: integer('attempts').notNull().default(0),
    /** Set per job run; every write from a job is guarded by `where id = ? and run_id = ?`. */
    runId: uuid('run_id'),
    heartbeatAt: ts('heartbeat_at'),
    /** The real signs of the wait, retold in-world (signLine). */
    signs: text('signs').array().notNull().default(sql`'{}'::text[]`),
    /** The checked quest minus its waypoints. Null until the road is ready. */
    quest: jsonb('quest').$type<StoredQuest>(),
    /** The mind's private working. Never sent to the client or exported. */
    forge: jsonb('forge'),
    faults: text('faults').array().notNull().default(sql`'{}'::text[]`),
    /** Hard faults remained after the repair (for the owner's eval; never shown). */
    rough: boolean('rough').notNull().default(false),
    /** "Put it in my week" for the road's This week deed. */
    thisWeekReminderId: uuid('this_week_reminder_id').references(() => notes.id, { onDelete: 'set null' }),
    /** The Lorer's local day of the last "Try again": one free retry per road per day. */
    retriedOn: date('retried_on', { mode: 'string' }),
    readyAt: ts('ready_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('wish_roads_wish_n_idx').on(t.wishId, t.n),
    index('wish_roads_status_idx').on(t.status),
    check('wish_roads_status', sql`${t.status} in (${oneOf(ROAD_STATUSES)})`),
    check('wish_roads_failure', sql`${t.failure} is null or ${t.failure} in (${oneOf(WISH_FAILURES)})`),
  ],
);

/** A waypoint on a road. Sealed ones are sent without trial, person, earns and steps (lib/loracle view). */
export const wishWaypoints = pgTable(
  'wish_waypoints',
  {
    id: id(),
    roadId: uuid('road_id')
      .notNull()
      .references(() => wishRoads.id, { onDelete: 'cascade' }),
    wishId: uuid('wish_id')
      .notNull()
      .references(() => wishes.id, { onDelete: 'cascade' }),
    /** 0-based order on the road. */
    position: integer('position').notNull(),
    kind: text('kind').$type<WaypointKind>().notNull(),
    emblem: text('emblem').$type<Emblem>().notNull(),
    name: text('name').notNull(),
    when: text('when').notNull(),
    /** 'YYYY-MM' | 'YYYY-MM-DD' | null (a trigger). */
    at: text('at'),
    place: text('place').notNull(),
    town: text('town'),
    country: text('country').notNull(),
    geoQuery: text('geo_query').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    precision: text('precision').$type<PinPrecision>(),
    clue: text('clue').notNull(),
    lore: boolean('lore').notNull().default(false),
    trial: text('trial').notNull(),
    person: jsonb('person').$type<Keeper>(),
    earns: text('earns'),
    mystery: text('mystery'),
    steps: jsonb('steps').$type<RoadStep[]>().notNull(),
    /** Ledger note ids it rests on. Never sent to the client. */
    noteIds: text('note_ids').array().notNull().default(sql`'{}'::text[]`),
    sealBrokenAt: ts('seal_broken_at'),
    inkedAt: ts('inked_at'),
    inkedOn: date('inked_on', { mode: 'string' }),
    /** The Lorer's own note. */
    note: text('note'),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    reminderId: uuid('reminder_id').references(() => notes.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wish_waypoints_road_position_idx').on(t.roadId, t.position),
    index('wish_waypoints_wish_idx').on(t.wishId),
  ],
);

/**
 * What each request to the stone's mind cost: the throttle and the owner's monthly ceiling read
 * this. Stores no text. Rows outlive their wish and their account (ids set to null), so burning a
 * scroll or deleting an account doesn't hide what was spent. Care rows never carry a user id.
 */
export const loracleSpend = pgTable(
  'loracle_spend',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    wishId: uuid('wish_id').references(() => wishes.id, { onDelete: 'set null' }),
    utcDay: date('utc_day', { mode: 'string' }).notNull(),
    /** The Lorer's local day (null for care rows). */
    day: date('day', { mode: 'string' }),
    /** weigh | road | keepers | compose | repair (LORACLE_STAGES). */
    stage: text('stage').notNull(),
    /** ok | refusal | max_tokens | error | care | riddle | reroute | silent (SPEND_OUTCOMES). */
    outcome: text('outcome').notNull(),
    /** The model that served (fallbacks included); 'fake' for the dev mind. */
    model: text('model').notNull(),
    ms: integer('ms').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    searches: integer('searches').notNull().default(0),
    fetches: integer('fetches').notNull().default(0),
    /** US$ × 1e6. */
    costMicros: integer('cost_micros').notNull(),
    requestId: text('request_id'),
    /**
     * The road a drawing request worked on (null for weighings). No foreign key on purpose: it
     * outlives a burned scroll, so burning never refunds a cast toward the hidden limit.
     */
    roadId: uuid('road_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('loracle_spend_utc_day_idx').on(t.utcDay),
    index('loracle_spend_user_created_idx').on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Lorebook

export const chapters = pgTable(
  'chapters',
  {
    id: id(),
    title: text('title').notNull(),
    summary: text('summary'),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    endedOn: date('ended_on', { mode: 'string' }),
    locationName: text('location_name'),
    crewId: uuid('crew_id').references(() => crews.id, { onDelete: 'set null' }),
    /** The event this chapter documents, if any. One chapter per event. */
    eventId: uuid('event_id')
      .unique()
      .references(() => events.id, { onDelete: 'set null' }),
    audience: audience('audience').notNull().default('participants'),
    coverMediaId: uuid('cover_media_id').references((): AnyPgColumn => media.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('chapters_crew_idx').on(t.crewId),
    index('chapters_occurred_idx').on(t.occurredOn),
    check('chapters_audience', sql`${t.audience} in ('only_me', 'participants', 'crew')`),
    check('chapters_ends_after_start', sql`${t.endedOn} is null or ${t.endedOn} >= ${t.occurredOn}`),
  ],
);

/** The people a chapter is about. Personal Lorebooks reference the same chapter. */
export const chapterPeople = pgTable(
  'chapter_people',
  {
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: participantRole('role').notNull().default('participant'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.chapterId, t.userId] }), index('chapter_people_user_idx').on(t.userId)],
);

export const media = pgTable(
  'media',
  {
    id: id(),
    /** Null once the uploader has deleted their account (shared photos stay). */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    // What the file belongs to decides who may see it. None set = profile picture.
    chapterId: uuid('chapter_id').references((): AnyPgColumn => chapters.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    crewId: uuid('crew_id').references(() => crews.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('media_chapter_idx').on(t.chapterId),
    check('media_single_scope', sql`num_nonnulls(${t.chapterId}, ${t.eventId}, ${t.crewId}) <= 1`),
  ],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });

/**
 * File contents, for hosts without lasting disk storage (MEDIA_STORAGE=database).
 * Keyed like files on disk; `media` rows point here through `storage_key`.
 */
export const mediaBlobs = pgTable('media_blobs', {
  key: text('key').primaryKey(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/** One person's piece of a chapter: their story, a quote they remember, a photo. */
export const contributions = pgTable(
  'contributions',
  {
    id: id(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    /** Null once the author has deleted their account: shown as "a former member". */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    type: contributionType('type').notNull(),
    title: text('title'),
    body: text('body'),
    caption: text('caption'),
    context: text('context'),
    speakerUserId: uuid('speaker_user_id').references(() => users.id, { onDelete: 'set null' }),
    speakerName: text('speaker_name'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('contributions_chapter_idx').on(t.chapterId),
    check(
      'contributions_shape',
      sql`(${t.type} = 'photo' and ${t.mediaId} is not null) or (${t.type} <> 'photo' and ${t.body} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Discussion: one thread per event, idea or chapter.

export const comments = pgTable(
  'comments',
  {
    id: id(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_event_idx').on(t.eventId),
    index('comments_idea_idx').on(t.ideaId),
    index('comments_chapter_idx').on(t.chapterId),
    check('comments_single_target', sql`num_nonnulls(${t.eventId}, ${t.ideaId}, ${t.chapterId}) = 1`),
  ],
);

// ---------------------------------------------------------------------------
// Notifications: meaningful updates only (brief part XXIV).

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Rendered at creation time so the history stays accurate if things are renamed. */
    title: text('title').notNull(),
    href: text('href').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);
