// Validation schemas for everything a client can send. The API parses every request
// body and query with these; clients can use them for form validation.
import { z } from 'zod';
import {
  CHAPTER_AUDIENCES,
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  IDEA_AUDIENCES,
  IDEA_STATUSES,
} from './vocabulary.ts';

const id = z.uuid();
const ids = (max: number) => z.array(id).min(1).max(max);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

// ---------------------------------------------------------------------------
// Accounts

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, 'Use 3–24 letters, numbers, dots or underscores');

export const RegisterInput = z.object({
  username,
  displayName: text(60),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  /** Username or email. */
  login: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const UpdateProfileInput = z.object({
  displayName: text(60).optional(),
  bio: optionalText(500).optional(),
  avatarMediaId: id.nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const FriendRequestInput = z.object({ username });
export type FriendRequestInput = z.infer<typeof FriendRequestInput>;

export const UserSearchQuery = z.object({ q: z.string().trim().toLowerCase().min(1).max(40) });

// ---------------------------------------------------------------------------
// Crews

export const CreateCrewInput = z.object({
  name: text(60),
  description: optionalText(500).optional(),
  emoji: z.string().trim().max(16).optional(),
  membersCanInvite: z.boolean().optional(),
});
export type CreateCrewInput = z.infer<typeof CreateCrewInput>;

export const UpdateCrewInput = CreateCrewInput.partial();
export type UpdateCrewInput = z.infer<typeof UpdateCrewInput>;

export const InviteUsersInput = z.object({ userIds: ids(100) });
export type InviteUsersInput = z.infer<typeof InviteUsersInput>;

export const UpdateCrewMemberInput = z.object({ role: z.enum(['admin', 'member']) });
export type UpdateCrewMemberInput = z.infer<typeof UpdateCrewMemberInput>;

// ---------------------------------------------------------------------------
// Events

const eventFields = {
  title: text(120),
  description: optionalText(4000).optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().optional(),
  allDay: z.boolean().optional(),
  timeZone,
  locationName: optionalText(200).optional(),
  crewId: id.nullable().optional(),
  audience: z.enum(EVENT_AUDIENCES).optional(),
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
};

export const CreateEventInput = z
  .object({
    ...eventFields,
    status: z.enum(['proposed', 'planning', 'confirmed']).optional(),
    inviteUserIds: z.array(id).max(200).optional(),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) >= Date.parse(v.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  })
  .refine((v) => v.audience !== 'crew' || !!v.crewId, {
    message: 'Pick a crew to share with the crew',
    path: ['crewId'],
  });
export type CreateEventInput = z.infer<typeof CreateEventInput>;

export const UpdateEventInput = z.object({
  title: eventFields.title.optional(),
  description: eventFields.description,
  category: eventFields.category,
  startsAt: isoDateTime.optional(),
  endsAt: eventFields.endsAt,
  allDay: eventFields.allDay,
  timeZone: timeZone.optional(),
  locationName: eventFields.locationName,
  crewId: eventFields.crewId,
  audience: eventFields.audience,
  capacity: eventFields.capacity,
});
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;

export const EventStatusInput = z.object({ status: z.enum(EVENT_STATUSES) });
export type EventStatusInput = z.infer<typeof EventStatusInput>;

export const RsvpInput = z.object({ status: z.enum(['going', 'maybe', 'declined']) });
export type RsvpInput = z.infer<typeof RsvpInput>;

export const EventRangeQuery = z.object({
  from: isoDateTime,
  to: isoDateTime,
  crewId: id.optional(),
});
export type EventRangeQuery = z.infer<typeof EventRangeQuery>;

export const ChecklistItemInput = z.object({ text: text(200) });
export const UpdateChecklistItemInput = z.object({
  text: text(200).optional(),
  done: z.boolean().optional(),
  assigneeId: id.nullable().optional(),
});
export type UpdateChecklistItemInput = z.infer<typeof UpdateChecklistItemInput>;

export const SetOrganizerInput = z.object({ organizer: z.boolean() });

// ---------------------------------------------------------------------------
// Personal calendar (always private to its owner)

export const PersonalEntryInput = z
  .object({
    title: text(120),
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullable().optional(),
    allDay: z.boolean().optional(),
    notes: optionalText(2000).optional(),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) >= Date.parse(v.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type PersonalEntryInput = z.infer<typeof PersonalEntryInput>;

export const PersonalRangeQuery = z.object({ from: isoDateTime, to: isoDateTime });

// ---------------------------------------------------------------------------
// Idea Vault

export const CreateIdeaInput = z
  .object({
    title: text(120),
    description: optionalText(4000).optional(),
    category: z.enum(EVENT_CATEGORIES).optional(),
    status: z.enum(['dreaming', 'gathering_interest', 'planning']).optional(),
    crewId: id.nullable().optional(),
    audience: z.enum(IDEA_AUDIENCES).optional(),
    whereNote: optionalText(200).optional(),
    whenNote: optionalText(200).optional(),
    budgetNote: optionalText(200).optional(),
  })
  .refine((v) => v.audience !== 'crew' || !!v.crewId, {
    message: 'Pick a crew to share with the crew',
    path: ['crewId'],
  });
export type CreateIdeaInput = z.infer<typeof CreateIdeaInput>;

export const UpdateIdeaInput = z.object({
  title: text(120).optional(),
  description: optionalText(4000).optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  status: z.enum(IDEA_STATUSES).optional(),
  crewId: id.nullable().optional(),
  audience: z.enum(IDEA_AUDIENCES).optional(),
  whereNote: optionalText(200).optional(),
  whenNote: optionalText(200).optional(),
  budgetNote: optionalText(200).optional(),
});
export type UpdateIdeaInput = z.infer<typeof UpdateIdeaInput>;

export const IdeaListQuery = z.object({
  crewId: id.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

/** Turning an idea into an event only asks for what the idea doesn't know yet: when. */
export const ConvertIdeaInput = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullable().optional(),
    allDay: z.boolean().optional(),
    timeZone,
    title: text(120).optional(),
    locationName: optionalText(200).optional(),
    audience: z.enum(EVENT_AUDIENCES).optional(),
    inviteInterested: z.boolean().optional(),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) >= Date.parse(v.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type ConvertIdeaInput = z.infer<typeof ConvertIdeaInput>;

// ---------------------------------------------------------------------------
// Lorebook

export const CreateChapterInput = z
  .object({
    title: text(120),
    summary: optionalText(4000).optional(),
    occurredOn: isoDate,
    endedOn: isoDate.nullable().optional(),
    locationName: optionalText(200).optional(),
    crewId: id.nullable().optional(),
    audience: z.enum(CHAPTER_AUDIENCES).optional(),
    peopleIds: z.array(id).max(200).optional(),
  })
  .refine((v) => !v.endedOn || v.endedOn >= v.occurredOn, {
    message: 'The end must be after the start',
    path: ['endedOn'],
  })
  .refine((v) => v.audience !== 'crew' || !!v.crewId, {
    message: 'Pick a crew to share with the crew',
    path: ['crewId'],
  });
export type CreateChapterInput = z.infer<typeof CreateChapterInput>;

export const UpdateChapterInput = z.object({
  title: text(120).optional(),
  summary: optionalText(4000).optional(),
  occurredOn: isoDate.optional(),
  endedOn: isoDate.nullable().optional(),
  locationName: optionalText(200).optional(),
  crewId: id.nullable().optional(),
  audience: z.enum(CHAPTER_AUDIENCES).optional(),
  coverMediaId: id.nullable().optional(),
});
export type UpdateChapterInput = z.infer<typeof UpdateChapterInput>;

export const ChapterListQuery = z.object({
  crewId: id.optional(),
  personId: id.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ChapterListQuery = z.infer<typeof ChapterListQuery>;

export const CreateContributionInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('story'),
    title: optionalText(120).optional(),
    body: text(20000),
  }),
  z.object({
    type: z.literal('quote'),
    body: text(1000),
    speakerUserId: id.nullable().optional(),
    speakerName: optionalText(80).optional(),
    context: optionalText(500).optional(),
  }),
  z.object({
    type: z.literal('photo'),
    mediaId: id,
    caption: optionalText(500).optional(),
  }),
]);
export type CreateContributionInput = z.infer<typeof CreateContributionInput>;

export const UpdateContributionInput = z.object({
  title: optionalText(120).optional(),
  body: text(20000).optional(),
  caption: optionalText(500).optional(),
  context: optionalText(500).optional(),
  speakerUserId: id.nullable().optional(),
  speakerName: optionalText(80).optional(),
});
export type UpdateContributionInput = z.infer<typeof UpdateContributionInput>;

// ---------------------------------------------------------------------------
// Discussion

export const CreateCommentInput = z.object({ body: text(4000) });
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;
