// The fixed vocabulary of LORE. The database enums, the API validation and the UI
// labels are all derived from these lists, so adding a value here is the one place
// to start (followed by a migration: `npm run db:generate`).

export const CREW_ROLES = ['owner', 'admin', 'member'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const EVENT_STATUSES = [
  'proposed',
  'planning',
  'confirmed',
  'in_progress',
  'completed',
  'canceled',
  'postponed',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_CATEGORIES = [
  'gathering',
  'party',
  'road_trip',
  'expedition',
  'sports',
  'outdoor',
  'creative',
  'celebration',
  'competition',
  'tradition',
  'custom',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const PARTICIPANT_ROLES = ['organizer', 'participant'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const RSVP_STATUSES = ['invited', 'going', 'maybe', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const IDEA_STATUSES = [
  'dreaming',
  'gathering_interest',
  'planning',
  'scheduled',
  'completed',
  'archived',
] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/**
 * Who can see a piece of content. Each kind of content allows a subset:
 * - events:   participants | friends | crew
 * - ideas:    only_me | friends | crew
 * - chapters: only_me | participants | crew
 * "friends" always means the creator's accepted friends; "crew" means the active
 * members of the content's crew.
 */
export const AUDIENCES = ['only_me', 'participants', 'friends', 'crew'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const EVENT_AUDIENCES = ['participants', 'friends', 'crew'] as const satisfies readonly Audience[];
export const IDEA_AUDIENCES = ['only_me', 'friends', 'crew'] as const satisfies readonly Audience[];
export const CHAPTER_AUDIENCES = ['only_me', 'participants', 'crew'] as const satisfies readonly Audience[];

export const CONTRIBUTION_TYPES = ['story', 'quote', 'photo'] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'crew_invite',
  'event_invite',
  'event_changed',
  'event_canceled',
  'idea_scheduled',
  'chapter_added',
  'chapter_contribution',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Human-readable labels. Kept here so web and native clients share wording.

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  proposed: 'Proposed',
  planning: 'Planning',
  confirmed: 'Confirmed',
  in_progress: 'Happening now',
  completed: 'Completed',
  canceled: 'Canceled',
  postponed: 'Postponed',
};

export const EVENT_CATEGORY_LABELS: Record<EventCategory, { label: string; emoji: string }> = {
  gathering: { label: 'Gathering', emoji: '🔥' },
  party: { label: 'Party', emoji: '🎉' },
  road_trip: { label: 'Road trip', emoji: '🚐' },
  expedition: { label: 'Expedition', emoji: '🧭' },
  sports: { label: 'Sports', emoji: '⚽' },
  outdoor: { label: 'Outdoor adventure', emoji: '🏔️' },
  creative: { label: 'Creative project', emoji: '🎨' },
  celebration: { label: 'Celebration', emoji: '🥂' },
  competition: { label: 'Competition', emoji: '🏆' },
  tradition: { label: 'Tradition', emoji: '🕯️' },
  custom: { label: 'Something else', emoji: '✨' },
};

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  invited: 'Invited',
  going: 'Going',
  maybe: 'Maybe',
  declined: "Can't make it",
};

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  dreaming: 'Dreaming',
  gathering_interest: 'Gathering interest',
  planning: 'Planning',
  scheduled: 'Scheduled',
  completed: 'Done',
  archived: 'Archived',
};

export const AUDIENCE_LABELS: Record<Audience, { label: string; hint: string }> = {
  only_me: { label: 'Only me', hint: 'Nobody else can see this.' },
  participants: { label: 'People on it', hint: 'Only the people invited or added.' },
  friends: { label: 'My friends', hint: 'Your accepted friends can see it.' },
  crew: { label: 'The crew', hint: 'Every member of the chosen crew.' },
};

export const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
