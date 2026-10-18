// Shapes the API returns. Timestamps are ISO-8601 strings; calendar dates are YYYY-MM-DD.
import type {
  Audience,
  ContributionType,
  CrewRole,
  EventCategory,
  EventStatus,
  IdeaStatus,
  MembershipStatus,
  NotificationType,
  ParticipantRole,
  RsvpStatus,
} from './vocabulary.ts';

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends UserSummary {
  email: string;
  bio: string | null;
  createdAt: string;
}

export type FriendshipState = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked';

export interface PublicProfile extends UserSummary {
  bio: string | null;
  createdAt: string;
  friendship: FriendshipState;
  friendshipId: string | null;
  /** Chapters this person is part of that the viewer is allowed to see. */
  chapters: ChapterSummary[];
  crewsInCommon: CrewRef[];
}

export interface UserSearchResult extends UserSummary {
  friendship: FriendshipState;
}

export interface FriendRequest {
  id: string;
  user: UserSummary;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface CrewRef {
  id: string;
  name: string;
  emoji: string;
}

export interface CrewSummary extends CrewRef {
  description: string | null;
  memberCount: number;
  myRole: CrewRole | null;
  myStatus: MembershipStatus | null;
}

export interface CrewMember {
  user: UserSummary;
  role: CrewRole;
  status: MembershipStatus;
  joinedAt: string | null;
}

export interface CrewDetail extends CrewSummary {
  membersCanInvite: boolean;
  createdAt: string;
  members: CrewMember[];
  canManage: boolean;
  canInvite: boolean;
}

export interface EventSummary {
  id: string;
  title: string;
  category: EventCategory;
  status: EventStatus;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  timeZone: string;
  locationName: string | null;
  crew: CrewRef | null;
  audience: Audience;
  myRsvp: RsvpStatus | null;
  myRole: ParticipantRole | null;
  goingCount: number;
  chapterId: string | null;
}

export interface EventParticipant {
  user: UserSummary;
  role: ParticipantRole;
  rsvp: RsvpStatus;
  respondedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  assignee: UserSummary | null;
  createdById: string;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  capacity: number | null;
  createdBy: UserSummary | null;
  ideaId: string | null;
  participants: EventParticipant[];
  checklist: ChecklistItem[];
  canEdit: boolean;
  canRsvp: boolean;
}

export interface IdeaSummary {
  id: string;
  title: string;
  category: EventCategory;
  status: IdeaStatus;
  crew: CrewRef | null;
  audience: Audience;
  interestedCount: number;
  iAmInterested: boolean;
  /** Null when the creator has since deleted their account. */
  createdBy: UserSummary | null;
  createdAt: string;
}

export interface IdeaDetail extends IdeaSummary {
  description: string | null;
  whereNote: string | null;
  whenNote: string | null;
  budgetNote: string | null;
  interested: UserSummary[];
  events: EventSummary[];
  canEdit: boolean;
}

export interface MediaRef {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface ChapterSummary {
  id: string;
  title: string;
  summary: string | null;
  occurredOn: string;
  endedOn: string | null;
  locationName: string | null;
  crew: CrewRef | null;
  audience: Audience;
  cover: MediaRef | null;
  peopleCount: number;
  contributionCount: number;
  eventId: string | null;
}

export interface Contribution {
  id: string;
  type: ContributionType;
  /** Null when the author has deleted their account ("a former member"). */
  author: UserSummary | null;
  title: string | null;
  body: string | null;
  caption: string | null;
  context: string | null;
  speaker: { user: UserSummary | null; name: string | null } | null;
  media: MediaRef | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ChapterPerson {
  user: UserSummary;
  role: 'organizer' | 'participant';
}

export interface ChapterDetail extends ChapterSummary {
  createdBy: UserSummary | null;
  people: ChapterPerson[];
  contributions: Contribution[];
  event: { id: string; title: string } | null;
  canEdit: boolean;
  canContribute: boolean;
  isPerson: boolean;
}

export interface Comment {
  id: string;
  /** Null when the author has deleted their account. */
  author: UserSummary | null;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: UserSummary | null;
  title: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

export interface PersonalEntry {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  notes: string | null;
}

/** Every Home section is a short, finite list. There is no feed. */
export interface HomeData {
  invitations: EventSummary[];
  comingUp: EventSummary[];
  continuePlanning: EventSummary[];
  toDocument: EventSummary[];
  crews: CrewSummary[];
  crewInvites: CrewSummary[];
  ideas: IdeaSummary[];
  onThisDay: ChapterSummary[];
  recentLore: ChapterSummary[];
  unreadNotifications: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
