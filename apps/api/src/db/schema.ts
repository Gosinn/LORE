// The LORE database. Every table is listed here; migrations in ../../drizzle are
// generated from this file with `npm run db:generate`.
//
// Deletion rules follow the brief (part XXVIII): when an account goes, its personal
// data goes with it (sessions, friendships, its own contributions and media), while
// shared records that other people rely on (crews, events, chapters, ideas) survive
// with their creator set to null.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
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
  RSVP_STATUSES,
} from '#shared';

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
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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

/** One person's piece of a chapter: their story, a quote they remember, a photo. */
export const contributions = pgTable(
  'contributions',
  {
    id: id(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
