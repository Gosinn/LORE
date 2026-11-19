// Shapes the API returns. Timestamps are ISO-8601 strings; calendar dates are YYYY-MM-DD.
import type {
  AgeBand,
  Audience,
  Calling,
  ContributionType,
  CrewRole,
  DeeperStatus,
  Emblem,
  EventCategory,
  EventStatus,
  IdeaStatus,
  Interest,
  LoracleMindState,
  MarkStatus,
  MapFeatureKind,
  MembershipStatus,
  MoneyBand,
  OracleMode,
  NotificationType,
  ParticipantRole,
  PinPrecision,
  PlacePrecision,
  ProvisionGroup,
  ReportReason,
  ReportTarget,
  RoadLane,
  RoadStatus,
  RsvpStatus,
  SpanUnit,
  StepKind,
  SupportTopic,
  TimeBand,
  WaitPhase,
  WaypointKind,
  WishAudience,
  WishStatus,
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
  /** Moderators see reports and support messages (the owner: ADMIN_USERNAMES, or the default owner). */
  isAdmin: boolean;
  /** May change LORE's words live and publish them (the owner; the same people as isAdmin for now). */
  canEditCopy: boolean;
  /**
   * "Show my places on maps" (default on; PATCH /me `{ showPlaces }`). Off: no one else gets the
   * coordinates of anything you created, on any map or in any answer; your own map still works.
   */
  showPlaces: boolean;
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

/**
 * An item's point as this viewer may have it (precision applied on the server, lib/access.ts).
 * Null: the item has no point, or this viewer may not have it (only_me, the author's "Show my places
 * on maps" is off, or one of you blocked the other). The place's name is the item's `locationName`.
 */
export interface PlacePoint {
  lat: number;
  lon: number;
  /**
   * The author (whoever created the item): the exact point and their setting (exact | approximate |
   * only_me). Anyone else: how the point they got is drawn: `exact`, or `approximate` (the point is
   * already rounded to about 5 km; draw a circle, not a pin).
   */
  precision: PlacePrecision;
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
  /** Where it happens on a map, as this viewer may have it. Set with `place` on create/update. */
  place: PlacePoint | null;
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
  /** The place's name, when the idea has a place (set with `place`); `whereNote` stays free text. */
  locationName: string | null;
  /** Where it would happen on a map, as this viewer may have it. */
  place: PlacePoint | null;
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
  /** Where it happened on a map, as this viewer may have it. Set with `place` on create/update. */
  place: PlacePoint | null;
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

/** A note to self; with `remindAt` it's a reminder. Only ever visible to its owner. */
export interface Note {
  id: string;
  body: string;
  remindAt: string | null;
  doneAt: string | null;
  pinned: boolean;
  event: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotesData {
  /** Open reminders, soonest first (overdue ones included). */
  reminders: Note[];
  /** Open notes without a time, pinned first, then newest. */
  notes: Note[];
  /** The most recently finished, for a quick undo. */
  done: Note[];
}

// ---------------------------------------------------------------------------
// The Oracle

export interface OracleSettings {
  home: { label: string; lat: number; lon: number } | null;
  radiusKm: number;
  interests: Interest[];
  timeZone: string;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2, upper case ("IS"), when the geocoder knows it. The Loracle needs it. */
  country?: string | null;
}

export interface FuturePlace {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Wikidata item, for "learn more" links. */
  wikidataId: string | null;
}

export type FutureKind = 'interest' | 'wildcard' | 'idea' | 'memory';
export type FutureStatus = 'open' | 'chosen' | 'saved' | 'dismissed';

/** One possible future the stones reveal. */
export interface Future {
  index: number;
  kind: FutureKind;
  title: string;
  story: string;
  /** Why the stones show this: the conditions they saw. */
  signs: string[];
  emoji: string;
  category: EventCategory;
  startsAt: string;
  endsAt: string | null;
  timeZone: string;
  place: FuturePlace | null;
  crew: CrewRef | null;
  ideaId: string | null;
  chapterId: string | null;
  status: FutureStatus;
  eventId: string | null;
  savedIdeaId: string | null;
}

export interface OracleReading {
  id: string;
  mode: OracleMode;
  createdAt: string;
  futures: Future[];
  readingsLeftToday: number;
}

/** What /oracle returns: settings, and today's latest reading once set up. */
export interface OracleState {
  settings: OracleSettings;
  reading: OracleReading | null;
}

/**
 * GET /oracle/sign: the stones' one small sign for today (Home), near where the Lorer stands.
 * Dealt once a day from the Futures engine; it never counts as one of the day's readings.
 * - `home` null: the Lorer hasn't said where they stand yet (nothing else is set).
 * - `future`: the best one still open, or the one chosen today (status 'chosen', with its eventId).
 *   Null when the stones see nothing near, every sign today was waved away, or the world didn't answer.
 * Choose or dismiss it with POST /oracle/readings/:readingId/futures/:index/choose | dismiss.
 */
export interface OracleSign {
  home: { label: string } | null;
  readingId: string | null;
  future: Future | null;
}

// ---------------------------------------------------------------------------
// The Loracle (wishes). Every shape here is sent to the Lorer who cast the wish, and (phase C) a
// quest they showed to a crew to that crew's members, without the Lorer's private parts (their
// realm, notes, links, reminders and deeper asks). What never leaves the server: the weighing, the
// ledger, the forge, note ids, dossiers.

/** What the stone should know, and what calls to the Lorer. Kept privately; prefills the fold. */
export interface LoracleContext {
  age: AgeBand | null;
  money: MoneyBand | null;
  time: TimeBand | null;
  /** Free text, 80 chars ("fit, a bad left knee, get seasick"). */
  body: string | null;
  /** Free text, 80 chars. */
  languages: string | null;
  /** ISO country code; null = the realm's country is assumed. */
  passport: string | null;
  callings: Calling[];
}

/** "Where do you stand?" The point stays on the server's side of the stone; only label + country reach the mind. */
export interface LoracleRealm {
  label: string;
  /** ISO country code; null for realms set before the Loracle (the server looks it up once). */
  country: string | null;
  lat: number;
  lon: number;
}

/** The stone's questions and the Lorer's answers so far. */
export interface LoracleSettings {
  realm: LoracleRealm | null;
  /** "How far will you go?" NO_LIMIT_KM means ANYWHERE. */
  radiusKm: number;
  timeZone: string;
  context: LoracleContext;
}

/** Marks instead of hedges (MARK_LABELS). `sources` are the `n` of the scroll's sources it rests on. */
export interface Mark {
  status: MarkStatus;
  /** Set for stale marks: the year it was last seen. */
  year: string | null;
  sources: number[];
}

/** One step of "The real road". */
export interface RoadStep {
  kind: StepKind;
  text: string;
  mark: Mark | null;
}

/** One line of the quest's provisions. `counsel` lines are plain wisdom that rests on no source (no mark). */
export interface ProvisionLine {
  text: string;
  mark: Mark | null;
  counsel: boolean;
}

/** Coin, Papers, Body, Skills, Tongue. Empty groups are hidden. */
export type Provisions = Record<ProvisionGroup, ProvisionLine[]>;

/** The person to find at a waypoint, and what to ask of them. `name` is null when the role is known but no name is. */
export interface Keeper {
  name: string | null;
  role: string;
  /** What to ask of them, as a verb phrase ("train you", "take you on as crew"). */
  verb: string;
  mark: Mark | null;
}

export interface WaypointWhere {
  place: string;
  town: string | null;
  country: string;
  /** Null until the pin is drawn (road `ready`), or when it could not be placed. */
  lat: number | null;
  lon: number | null;
  precision: PinPrecision | null;
}

/** What came of a waypoint elsewhere in LORE. */
export interface WaypointLinks {
  eventId: string | null;
  ideaId: string | null;
  chapterId: string | null;
  reminderId: string | null;
}

/** What every waypoint shows, sealed or not. */
export interface WaypointBase {
  id: string;
  /** 0-based order on the road. */
  position: number;
  kind: WaypointKind;
  emblem: Emblem;
  name: string;
  /** In words ("this week", "next spring", "when your trainer says you're ready"). */
  when: string;
  /** 'YYYY-MM' | 'YYYY-MM-DD' | null (a trigger, not a date). */
  at: string | null;
  where: WaypointWhere;
  clue: string;
  /** True for the one clue that is legend rather than checked fact. */
  lore: boolean;
  /** What only the road can tell (1–3 on a map, never on the first waypoint). */
  mystery: string | null;
}

/** An open or inked waypoint: everything is shown. */
export interface OpenWaypoint extends WaypointBase {
  state: 'open' | 'inked';
  trial: string;
  person: Keeper | null;
  earns: string | null;
  steps: RoadStep[];
  /** The day the Lorer did it (YYYY-MM-DD), when inked. */
  inkedOn: string | null;
  /** The Lorer's own note. Null for anyone else. */
  note: string | null;
  /** What came of it in the Lorer's LORE. All null for anyone else. */
  links: WaypointLinks;
  /** "Ask the stone about this" (phase B), oldest first, at most 10. Empty for anyone but the Lorer. */
  asks: DeeperView[];
  /** Crew members who walk this waypoint with the Lorer (phase C), first to join first. */
  walkers: UserSummary[];
  /** The viewer is one of the walkers. */
  walking: boolean;
}

/** A deeper ask's answer: a small scroll pinned to its waypoint. Marks refer to the ask's own sources. */
export interface DeeperAnswer {
  /** The answer to the Lorer's question, when one was asked (40 words or fewer). */
  answer: string | null;
  /** A new sign of the place. */
  clue: string;
  /** Three real steps ("The real road" rules). */
  steps: RoadStep[];
  /** Whom to find there, and what to ask of them. */
  keeper: Keeper | null;
  /** One sentence to say on arrival. */
  words: string | null;
  /** One new unknown the place will answer. */
  unknown: string;
}

/**
 * "Ask the stone about this" (phase B): POST /loracle/waypoints/:id/ask answers this (202). While
 * `listening` the wish is polled like a road in progress; `dawn` waits for the Lorer's next dawn
 * (LORACLE_LINES.askDawn). Only ever sent to the Lorer who cast the wish.
 */
export interface DeeperView {
  id: string;
  question: string | null;
  status: DeeperStatus;
  lane: RoadLane;
  /** Dawn lane: when it will have been answered at the latest (the Lorer's next 06:00). */
  dueBy: string | null;
  /** The real signs so far, oldest first. */
  signs: string[];
  answer: DeeperAnswer | null;
  /** Numbered from 1; the answer's marks refer to these. */
  sources: QuestSource[];
  createdAt: string;
}

/** A sealed waypoint: the server sends no trial, keeper, earns, steps, ink or links. */
export interface SealedWaypoint extends WaypointBase {
  state: 'sealed';
}

export type Waypoint = OpenWaypoint | SealedWaypoint;

export interface QuestSpan {
  amount: number;
  unit: SpanUnit;
}

/** One deed under an hour, this week. */
export interface ThisWeek {
  text: string;
  mark: Mark | null;
  /** Suggested day (YYYY-MM-DD) or null. */
  day: string | null;
  minutes: number;
  /** The reminder made by "Put it in my week", if any. */
  reminderId: string | null;
}

/** A public page the stone looked at. Numbered from 1; marks refer to `n`. */
export interface QuestSource {
  n: number;
  title: string;
  url: string;
  host: string;
  /** The page's date when known (YYYY or YYYY-MM-DD). */
  date: string | null;
  /** True when the stone opened the page; false when it was only seen in search. */
  opened: boolean;
}

/** A mystery from the map, collected under "Left in the fog". */
export interface FogLine {
  /** The waypoint it belongs to. */
  position: number;
  text: string;
}

/**
 * One drawn road: the scroll. While the road is in progress only the wait fields are filled
 * (status, phase, signs); the quest fields are null / empty until the road is `ready`.
 */
export interface WishScroll {
  id: string;
  /** 1 for the first road; "Ask again" adds 2, 3, … (tabs: "Two roads", "Three roads"). */
  n: number;
  status: RoadStatus;
  /** `dawn`: written down past the stone's soft budget, read before `dueBy` (LORACLE_LINES.dawn). */
  lane: RoadLane;
  /** Dawn lane only: the Lorer's next 06:00, by which the road will have been drawn. */
  dueBy: string | null;
  /** The ink phase while in progress (`roadPhase(status)`), else null. */
  phase: WaitPhase | null;
  /** The real signs so far, oldest first (show the newest three). */
  signs: string[];
  /** Attempts so far: 1 + automatic retries. A faded road offers a free "Try again". */
  attempts: number;
  readyAt: string | null;
  title: string | null;
  calling: string | null;
  /** For feeling-wishes: one true line under the calling. */
  truth: string | null;
  span: QuestSpan | null;
  map: Waypoint[];
  thisWeek: ThisWeek | null;
  provisions: Provisions | null;
  /** The quest's one survival rule, if any (shown first under Body, in wax). */
  rule: string | null;
  fog: FogLine[];
  sources: QuestSource[];
}

/**
 * A wish and its roads, as GET /loracle/wishes/:id returns it. Poll every 2.5 s while any road is in
 * progress or `ready` (in the now lane), or any of its waypoints' asks is `listening`.
 */
export interface Wish {
  id: string;
  text: string;
  status: WishStatus;
  createdAt: string;
  /** The realm label it was cast from. Empty for anyone but the Lorer (their home stays theirs). */
  realm: string;
  /** The weighing found no one has walked this road as written ("Here is the nearest"). */
  beyond: boolean;
  /** The first road (n = 1). Same as roads[0]. */
  road: WishScroll;
  /** Every road, in order (phase B: "Ask again" adds one; tabs "Two roads", "Three roads"). */
  roads: WishScroll[];
  /** Waypoints inked, out of all of them, on the road walked furthest (ties: the first). */
  inked: number;
  total: number;
  /** The viewer cast this wish. False: a crew member it was shown to (phase C). */
  mine: boolean;
  /** Who cast it. */
  owner: UserSummary;
  /** only_me, or crew: shown to `crew` ("{crew} can see this scroll", LORACLE_LINES.sharedWith). */
  audience: WishAudience;
  crew: CrewRef | null;
}

/** A rolled scroll in "Your quests". */
export interface WishSummary {
  id: string;
  /** The quest's name once drawn, else null (show the wish text). */
  title: string | null;
  text: string;
  status: WishStatus;
  /** The first waypoint's emblem (the wax seal), once drawn. */
  seal: Emblem | null;
  inked: number;
  total: number;
  /** The first road's lane: a `listening` wish whose lane is `dawn` waits for the Lorer's next dawn (LORACLE_LINES.logDawn). */
  lane: RoadLane;
  createdAt: string;
}

/** A quest another Lorer showed to one of the viewer's crews (phase C). Open it with GET /loracle/wishes/:id. */
export interface CrewQuestSummary extends WishSummary {
  owner: UserSummary;
  crew: CrewRef;
  /** When it was shown to the crew. */
  sharedAt: string;
}

/** One waypoint on the Epic page: where the road went, and the chapter written for it. */
export interface EpicWaypoint {
  id: string;
  position: number;
  kind: WaypointKind;
  emblem: Emblem;
  name: string;
  where: WaypointWhere;
  /** The day the Lorer did it, when inked. */
  inkedOn: string | null;
  /** The chapter linked to it, only when the viewer may see that chapter. */
  chapter: { id: string; title: string } | null;
  /** Crew members who walked it with the Lorer. */
  walkers: UserSummary[];
}

/**
 * GET /loracle/wishes/:id/epic: a fulfilled quest as lore (409 `not_fulfilled` before). The road
 * shown is the one walked furthest. For the Lorer and, when it was shown to a crew, its members.
 */
export interface EpicView {
  id: string;
  text: string;
  title: string | null;
  calling: string | null;
  truth: string | null;
  span: QuestSpan | null;
  fulfilledAt: string | null;
  /** Which road was walked (its n). */
  roadN: number;
  map: EpicWaypoint[];
  mine: boolean;
  owner: UserSummary;
  crew: CrewRef | null;
}

/** POST /loracle/tick (the hourly dawn tick; a server secret, never a Lorer): what it did. */
export interface LoracleTickResult {
  /** Batches that had ended and were read. */
  collected: number;
  /** Batches sent this tick. */
  submitted: number;
  /** Items handed to the live lane (a promise kept before dawn, or a batch that could not run them). */
  live: number;
  /** Dawn items still waiting. */
  waiting: number;
}

/** The care screen: plain, still, nothing stored. Lines come from LORACLE_LINES (care1, care2, …). */
export interface CareView {
  /** The checked line for the realm's country (CRISIS_LINES), or null: then "More lines" is the main button. */
  crisis: { name: string; number: string; hours: string | null; text: string | null } | null;
  /** The emergency number (EMERGENCY_NUMBERS), or null to leave that line out. */
  emergency: string | null;
  /** FIND_A_HELPLINE. */
  more: string;
}

/**
 * What a cast answers (POST /loracle/wishes). Only `quest` stores anything.
 * - quest: 202, the wish is written. `existing` = the same wish was already cast today (LORACLE_LINES.duplicate).
 *   `wish.status` is `listening`, or `moon` past the owner's monthly ceiling (LORACLE_LINES.moon).
 *   A listening wish whose `road.lane` is `dawn` waits for the Lorer's next dawn (LORACLE_LINES.dawn).
 * - riddle: the wish was too vague; re-cast with `riddleAnswer`.
 * - reroute: the stone won't draw that road; `offer` is the wish under it (re-cast with `rerouted: true`
 *   and the `offerToken`).
 * - care: signs of self-harm (§ care screen).
 * - silent: the mind declined; the field keeps the text.
 * - rest: the hidden per-Lorer limit; answered in-world (LORACLE_LINES.rest), never with a number.
 * - moon: far past the owner's monthly ceiling; nothing is weighed or stored (LORACLE_LINES.moonFull).
 * Errors carry a code instead: `asleep` (503), `consent` (403), `realm` (400), `fog` (503), `validation` (400).
 */
export type CastResult =
  | { route: 'quest'; wish: Wish; existing: boolean }
  | { route: 'riddle'; riddle: { question: string; options: string[] } }
  /** offerToken: send it back with the offer as CastWishInput.offerToken when the Lorer casts it. */
  | { route: 'reroute'; offer: string; offerToken: string }
  | { route: 'care'; care: CareView }
  | { route: 'silent' }
  /** The hidden per-Lorer limit: the stone rests (LORACLE_LINES.rest). */
  | { route: 'rest' }
  /** Far past the owner's monthly ceiling: nothing is weighed or written (LORACLE_LINES.moonFull). */
  | { route: 'moon' };

/**
 * What "Ask the stone about this" (POST /loracle/waypoints/:id/ask) returns: the ask (202), or, when the
 * question meets the care floor, the care screen (200; nothing is stored or sent), as for a cast.
 */
export type AskResult = DeeperView | { route: 'care'; care: CareView };

/** What GET /loracle returns. */
export interface LoracleState {
  /** asleep: no API key; the page shows LORACLE_LINES.asleep and casting is disabled. */
  mind: LoracleMindState;
  /** The Lorer agreed to send wishes to Anthropic (the consent sheet). */
  consented: boolean;
  settings: LoracleSettings;
  /** Five example wishes for this ISO week. */
  examples: string[];
  /** Newest first, at most 30: everything but the let-go. */
  wishes: WishSummary[];
  /** Newest first, at most 10. */
  letGo: WishSummary[];
  /** Quests other Lorers showed to the viewer's crews (phase C), newest shown first, at most 30. */
  crewQuests: CrewQuestSummary[];
}

// ---------------------------------------------------------------------------
// Safety (moderators only)

export interface ModerationReport {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  /** What it said when it was reported. */
  snapshot: string | null;
  /** Where to look, if it still exists. */
  href: string | null;
  reporter: UserSummary | null;
  subject: (UserSummary & { suspended: boolean }) | null;
  status: 'open' | 'actioned' | 'dismissed';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** Other open reports about the same thing. */
  sameTarget: number;
}

export interface SupportMessage {
  id: string;
  topic: SupportTopic;
  body: string;
  replyTo: string | null;
  user: UserSummary | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ModerationSummary {
  openReports: number;
  /** The oldest open report, to keep the 24-hour promise. */
  oldestOpenAt: string | null;
  openMessages: number;
}

// ---------------------------------------------------------------------------
// The Lore Map (GET /map). Everything here is already filtered and rounded for the viewer.

/**
 * One thing on the map. `kind`: chapter (book), event (a plan: the calendar diamond), idea (star),
 * waypoint (a Loracle waypoint: only ever the wish's owner's), home (where you stand: only yours,
 * always included, first, and not counted in the cap).
 */
export interface MapFeature {
  kind: MapFeatureKind;
  /** The item's id (a waypoint's own id; `home` for home). */
  id: string;
  title: string;
  /** Plans and ideas: their category's emoji. */
  emoji?: string;
  /** Chapters: YYYY-MM-DD · plans: an ISO instant (see allDay, timeZone) · waypoints: 'YYYY-MM' | 'YYYY-MM-DD'. */
  date?: string;
  endDate?: string;
  /** Plans: shown as a day, not a time. */
  allDay?: boolean;
  /** Plans: the zone they were planned in. */
  timeZone?: string;
  placeName?: string;
  lat: number;
  lon: number;
  /** How to draw it: `exact` a pin; `approximate` a circle about 8 km across (the point is already rounded). */
  precision: 'exact' | 'approximate';
  crewId?: string;
  /** Who put it there, for someone else's chapter, plan or idea (omitted for yours and former members'). */
  who?: string;
  /** Your own chapter, plan or idea: how others get this place (you always see the exact spot). */
  sharing?: PlacePrecision;
  /** Where Open goes: /chapters/:id, /events/:id, /ideas/:id, /oracle/quest/:wishId, /oracle. */
  href: string;
}

/** GET /map?mode=mine|crew|memories|adventures&crew=<id>. */
export interface MapResponse {
  /** Home first (when set), then nearest in time to now first, at most MAP_CAP besides home. */
  features: MapFeature[];
  /** How many more matched beyond the cap (no infinite lists). */
  hidden: number;
}

/** Every Home section is a short, finite list. There is no feed. */
export interface HomeData {
  /** Your reminders that are due or come up within a day. */
  reminders: Note[];
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

// ---------------------------------------------------------------------------
// Live text: the words the owner changed in the app (packages/shared/src/copy.ts)

/** GET /api/copy (public, no sign-in): every published text, by key. */
export interface CopyState {
  /** The published revision; null before the first publish (and when live text is switched off). */
  version: string | null;
  texts: Record<string, string>;
}

/** GET /api/copy?v=<version> when the caller already has that version. */
export interface CopyUnchanged {
  version: string | null;
  unchanged: true;
}

export type CopyFetch = CopyState | CopyUnchanged;

/** One text's change inside a revision. `null` means "the default from the code". */
export interface CopyChange {
  key: string;
  before: string | null;
  after: string | null;
  /** The default the text was written against. */
  original: string;
  context: string | null;
}

/** publish: the owner's publish · undo: a publish taken back · follow: words re-attached after a deploy. */
export type CopyRevisionKind = 'publish' | 'undo' | 'follow';

export interface CopyRevisionSummary {
  id: string;
  kind: CopyRevisionKind;
  /** Null for automatic follows (and after the publisher's account was deleted). */
  publishedBy: UserSummary | null;
  /** undo: the revision it took back. */
  undoOf: string | null;
  changes: CopyChange[];
  createdAt: string;
}

/** A published text (owner view). */
export interface CopyOverride {
  key: string;
  text: string;
  original: string;
  context: string | null;
  /** Set when the server re-attached these words after a deploy moved them (the old key). */
  followedFrom: string | null;
  updatedAt: string;
  updatedBy: UserSummary | null;
}

/** GET /api/admin/copy (owner only). */
export interface CopyAdminState {
  version: string | null;
  /** False when the server has live text switched off (COPY_OVERRIDES=off): nothing shows, nothing publishes. */
  enabled: boolean;
  overrides: CopyOverride[];
  /** The last 20 revisions, newest first. */
  revisions: CopyRevisionSummary[];
  /** The build whose copy-catalog.json the server checks keys against; null without one. */
  catalogBuild: string | null;
  /** Whether keys are checked against that catalog (production only). */
  catalogChecked: boolean;
}

/** PUT /api/admin/copy: the new public state. */
export interface CopyPublishResult extends CopyState {
  /** The revision written; null when nothing actually changed. */
  revisionId: string | null;
}

/** POST /api/admin/copy/undo. */
export interface CopyUndoResult extends CopyPublishResult {
  /** Keys left alone because their words changed again after that revision. */
  skipped: string[];
}

/** One earlier text of a key (GET /api/admin/copy/history?key=). */
export interface CopyHistoryEntry {
  revisionId: string;
  kind: CopyRevisionKind;
  /** The words before and after; null = the default from the code. */
  before: string | null;
  after: string | null;
  publishedBy: UserSummary | null;
  createdAt: string;
}

export interface CopyHistory {
  key: string;
  /** Newest first, at most 20. */
  entries: CopyHistoryEntry[];
}

/**
 * One text in `copy-catalog.json` (emitted by the build plugin into the web build, read by the API at
 * start and by the owner's editor). File paths and snippets are code, already public in the bundle.
 */
export interface CopyCatalogEntry {
  /** The default from the code (core: NFC, edge whitespace off; canonical message syntax). */
  text: string;
  /** `n`: page content (may gain <em>/<strong>/<br/> in an override) · `s`: shown as a string. */
  kind: 's' | 'n';
  /** Placeholder name → the source snippet it stands for. */
  ph?: Record<string, string>;
  /** Where it is used: `pages/Home.tsx:42`. */
  at?: string[];
  /** Human context: `Home › h2`, `LORACLE_LINES.cast`. */
  ctx?: string;
  /** Legal or consent text: what it promises must stay true. */
  legal?: 1;
  /** Never marked in edit mode (used as data). */
  plain?: 1;
}

export interface CopyCatalog {
  /** The web build it came from (build.json's id), or null. */
  build: string | null;
  keys: Record<string, CopyCatalogEntry>;
}
