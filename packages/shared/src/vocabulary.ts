// The fixed vocabulary of LORE. The database enums, the API validation and the UI
// labels are all derived from these lists, so adding a value here is the one place
// to start (followed by a migration: `npm run db:generate`).

import { copy } from './copy.ts';

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
// The Oracle: possible futures drawn from the world around you.

/** What a lore maker is into. Each one is backed by data the Oracle can actually see. */
/** The Oracle's realm with no limit: anywhere on Earth (half the planet's circumference is ~20,000 km). */
export const NO_LIMIT_KM = 20000;

export const INTERESTS = [
  'nature',
  'water',
  'sky',
  'history',
  'culture',
  'photography',
  'road_trips',
  'active',
  'cozy',
  'social',
] as const;
export type Interest = (typeof INTERESTS)[number];

export const INTEREST_LABELS: Record<Interest, { label: string; emoji: string }> = {
  nature: { label: 'Wild nature', emoji: '🌋' },
  water: { label: 'Hot water & coasts', emoji: '♨️' },
  sky: { label: 'Sky: aurora, stars, sunrise', emoji: '🌌' },
  history: { label: 'History & ruins', emoji: '🏛️' },
  culture: { label: 'Museums & art', emoji: '🎨' },
  photography: { label: 'Photography', emoji: '📸' },
  road_trips: { label: 'Road trips', emoji: '🚐' },
  active: { label: 'Hikes & climbs', emoji: '🥾' },
  cozy: { label: 'Cozy & slow', emoji: '🕯️' },
  social: { label: 'Crew time', emoji: '🔥' },
};

/** How a reading is dealt: from your interests, ignoring them, or a mix. */
export const ORACLE_MODES = ['mixed', 'mine', 'wild'] as const;
export type OracleMode = (typeof ORACLE_MODES)[number];

export const ORACLE_MODE_LABELS: Record<OracleMode, { label: string; hint: string }> = {
  mixed: { label: 'Mixed', hint: 'Two futures from your interests, one wildcard.' },
  mine: { label: 'My path', hint: 'All three follow your interests.' },
  wild: { label: 'Wild', hint: 'All three ignore your interests on purpose.' },
};

/** Readings per day. The stones don't do endless scrolling. */
export const ORACLE_READINGS_PER_DAY = 3;

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

// Safety
export const REPORT_TARGETS = ['user', 'event', 'idea', 'chapter', 'contribution', 'comment'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or a scam',
  harassment: 'Bullying or harassment',
  hate: 'Hate or discrimination',
  sexual: 'Sexual content',
  violence: 'Violence or threats',
  self_harm: 'Someone may hurt themselves',
  illegal: 'Something illegal',
  other: 'Something else',
};

export const SUPPORT_TOPICS = ['help', 'bug', 'idea', 'privacy', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = {
  help: 'I need help',
  bug: 'Something is broken',
  idea: 'An idea for LORE',
  privacy: 'Privacy or my data',
  other: 'Something else',
};

// ---------------------------------------------------------------------------
// The Loracle: wishes. A Lorer speaks a wish; the stones answer with a road (a quest).
// The stone's mind is Claude (Anthropic), called only by the server. Phase A: one road
// per wish, no deeper asks, no dawn lane, no crews. Everything here is private to the
// Lorer. Copy must sound like docs/OWNER_VOICE.md: ancient, simple, true.

/** What /api/health and GET /loracle say about the stone's mind. `fake` = LORACLE_MIND=fake (dev only). */
export const LORACLE_MIND_STATES = ['awake', 'asleep', 'fake'] as const;
export type LoracleMindState = (typeof LORACLE_MIND_STATES)[number];

/**
 * A wish's life:
 * - listening: its road is being drawn, or waits its turn
 * - moon: cast past the owner's monthly spend ceiling; written down and drawn when the new month comes
 * - revealed: the road is drawn
 * - faded: the fog won twice; a free "Try again" is offered
 * - silent: the mind would not draw it (a refusal after the fallbacks)
 * - fulfilled: the Lorer says it came true; it becomes lore
 * - released: let go (archived; can be taken up again)
 */
export const WISH_STATUSES = ['listening', 'moon', 'revealed', 'faded', 'silent', 'fulfilled', 'released'] as const;
export type WishStatus = (typeof WISH_STATUSES)[number];

/**
 * A road's life: queued (waiting its turn, the auto-retry back-off, or the new moon) → searching →
 * drawing → sealing → ready (text written, pins still drawing) → drawn. Or faded / silent.
 */
export const ROAD_STATUSES = ['queued', 'searching', 'drawing', 'sealing', 'ready', 'drawn', 'faded', 'silent'] as const;
export type RoadStatus = (typeof ROAD_STATUSES)[number];
/**
 * Roads in these states have a job working on them (or waiting to). The client polls a wish while
 * its road is in one of these, or `ready` (text written, pins still drawing).
 */
export const ROAD_IN_PROGRESS = ['queued', 'searching', 'drawing', 'sealing'] as const satisfies readonly RoadStatus[];

/** Why a road attempt failed. Never shown as such: the Lorer sees the fog lines. */
export const WISH_FAILURES = ['interrupted', 'overloaded', 'timeout', 'error'] as const;
export type WishFailure = (typeof WISH_FAILURES)[number];

/** The four ink phases of the wait. Never a percentage. */
export const WAIT_PHASES = ['listening', 'searching', 'drawing', 'sealing'] as const;
export type WaitPhase = (typeof WAIT_PHASES)[number];
export const WAIT_PHASE_LABELS: Record<WaitPhase, string> = {
  listening: 'Listening',
  searching: 'Searching the world',
  drawing: 'Drawing the map',
  sealing: 'Sealing',
};

/** The ink phase of a road still in progress, or null once it has ended (ready, drawn, faded, silent). */
export function roadPhase(status: RoadStatus): WaitPhase | null {
  switch (status) {
    case 'queued':
      return 'listening';
    case 'searching':
    case 'drawing':
    case 'sealing':
      return status;
    default:
      return null;
  }
}

/**
 * A real event during the wait. The mind reports these through `onSign`; code (never the model)
 * retells them in-world with `signLine`. The job appends each line to the road's `signs` and
 * moves the road's status forward to `signPhase` (never backwards).
 */
export type LoracleSign =
  | { kind: 'listening' }
  | { kind: 'moon' }
  | { kind: 'search'; query: string }
  | { kind: 'fetch'; host: string }
  | { kind: 'name' }
  | { kind: 'cost' }
  | { kind: 'compose' }
  | { kind: 'repair' }
  | { kind: 'seal' }
  | { kind: 'retry' };

/** The phase a sign belongs to; null = it doesn't move the road. */
export function signPhase(sign: LoracleSign): WaitPhase | null {
  switch (sign.kind) {
    case 'listening':
    case 'moon':
      return 'listening';
    case 'search':
    case 'fetch':
    case 'name':
    case 'cost':
      return 'searching';
    case 'compose':
    case 'repair':
      return 'drawing';
    case 'seal':
      return 'sealing';
    case 'retry':
      return null;
  }
}

/** Short enough for a sign line, cut at a word, and ending the sentence (no period after "…"). */
const clip = (s: string, max: number) => {
  const t = s.replace(/[\s"“”«»]+/g, ' ').trim();
  if (t.length <= max) return `${t}.`;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/** A month with its year ("November 2026", "nov. 2026"): a date the scouts put into rule searches. */
const MONTH_YEAR =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(19|20)\d{2}\b/gi;

/**
 * A search as the stone would say it: no search operators, dates or years (the scouts put those into
 * rule searches), proper nouns kept as written. "" when nothing is left.
 */
export function searchWords(query: string): string {
  return query
    .replace(/\b(site|inurl|intitle|intext|filetype|allintitle|allinurl):\S*/gi, ' ')
    .replace(/(^|\s)[-+]\S+/g, ' ')
    .replace(/\b(OR|AND|NOT)\b/g, ' ')
    .replace(MONTH_YEAR, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/["“”«»()[\]|*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A sign retold in the stone's voice. Search words are cleaned of machine marks and kept short.
 * Written into the road when it happens (server side), so the owner's live words (copy(), `srv#` keys)
 * apply to new signs only.
 */
export function signLine(sign: LoracleSign): string {
  switch (sign.kind) {
    case 'listening':
      return copy('The stone listens…');
    case 'moon':
      return copy('The new moon rises. The stone reads your wish.');
    case 'search': {
      const words = searchWords(sign.query);
      return words ? copy('It asks the roads about {words}', { words: clip(words, 60) }) : copy('It asks the roads.');
    }
    case 'fetch':
      return copy('It reads the sign over {host}', { host: clip(sign.host.toLowerCase().replace(/^www\./, ''), 60) });
    case 'name':
      return copy('A name keeps coming up.');
    case 'cost':
      return copy('It weighs the cost in coin and sweat.');
    case 'compose':
      return copy('It draws your map.');
    case 'repair':
      return copy('It scratches out a line and draws again.');
    case 'seal':
      return copy('Sealing the scroll.');
    case 'retry':
      return copy('The fog won. The stone tries again.');
  }
}

/** What the weighing saw in a wish. Server-side only, except `beyond` (a line on the scroll). */
export const LORACLE_TAGS = ['open', 'dangerous', 'lethal', 'beyond', 'inward', 'tender', 'youth'] as const;
export type LoracleTag = (typeof LORACLE_TAGS)[number];

/** The kinds of waypoint on a quest map. The first is always a door (within two weeks), the last a summit. */
export const WAYPOINT_KINDS = ['door', 'bridge', 'crucible', 'test', 'gate', 'pilgrimage', 'summit', 'return'] as const;
export type WaypointKind = (typeof WAYPOINT_KINDS)[number];

/**
 * open: everything shown. sealed: under red wax; the server sends it without trial, keeper,
 * earns and steps. inked: the Lorer did it.
 * The first LORACLE_OPEN_WAYPOINTS are open; a later one stays sealed until the one before it is
 * inked or the Lorer breaks its seal.
 */
export const WAYPOINT_STATES = ['open', 'sealed', 'inked'] as const;
export type WaypointState = (typeof WAYPOINT_STATES)[number];
export const LORACLE_OPEN_WAYPOINTS = 2;

/** One step of "The real road" under a waypoint. */
export const STEP_KINDS = ['do', 'cost', 'gate', 'help'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_KIND_LABELS: Record<StepKind, string> = { do: 'DO', cost: 'COST', gate: 'GATE', help: 'HELP' };

/** Waypoint emblems (the UI maps each to an icon). */
export const EMBLEMS = [
  'fist',
  'blade',
  'ship',
  'anchor',
  'wave',
  'mountain',
  'snow',
  'sun',
  'moon',
  'star',
  'flame',
  'tree',
  'leaf',
  'road',
  'bridge',
  'door',
  'key',
  'bell',
  'book',
  'cup',
  'crown',
  'eye',
  'compass',
  'tower',
  'house',
  'music',
  'tent',
  'plane',
  'train',
  'bowl',
  'feather',
  'hand',
] as const;
export type Emblem = (typeof EMBLEMS)[number];

/**
 * Marks instead of hedges: every step, provision line and named person carries the weakest
 * status of the notes it rests on. verified: a whole wax dot · reported: cracked · stale: faded,
 * with its year · closed: struck · disputed: split.
 */
export const MARK_STATUSES = ['verified', 'reported', 'stale', 'closed', 'disputed'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];
/** Accessible labels for marks. Fill `{year}` for stale marks with `fillLine`. */
export const MARK_LABELS: Record<MarkStatus, string> = {
  verified: 'Seen in a sure source',
  reported: 'Heard, not yet seen for sure',
  stale: 'Last seen {year}',
  closed: 'Closed now',
  disputed: 'The sources disagree',
};

/** How sure a waypoint's pin is: from the stone's notes, the place itself, its town, its country, or open sea. */
export const PIN_PRECISIONS = ['ledger', 'place', 'town', 'country', 'sea'] as const;
export type PinPrecision = (typeof PIN_PRECISIONS)[number];

export const SPAN_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type SpanUnit = (typeof SPAN_UNITS)[number];

/** What to carry: the quest's provisions, in the order they are shown. Empty groups are hidden. */
export const PROVISION_GROUPS = ['coin', 'papers', 'body', 'skills', 'tongue'] as const;
export type ProvisionGroup = (typeof PROVISION_GROUPS)[number];
export const PROVISION_LABELS: Record<ProvisionGroup, string> = {
  coin: 'Coin',
  papers: 'Papers',
  body: 'Body',
  skills: 'Skills',
  tongue: 'Tongue',
};

// What the stone should know (all optional, remembered privately in oracle_settings.loracle_context).
export const AGE_BANDS = ['13-17', '18-24', '25-34', '35-49', '50-64', '65+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  '13-17': '13–17',
  '18-24': '18–24',
  '25-34': '25–34',
  '35-49': '35–49',
  '50-64': '50–64',
  '65+': '65 or more',
};

export const MONEY_BANDS = ['little', 'some', 'enough', 'no-object'] as const;
export type MoneyBand = (typeof MONEY_BANDS)[number];
export const MONEY_BAND_LABELS: Record<MoneyBand, string> = {
  little: 'Next to nothing',
  some: 'Some savings',
  enough: 'Enough',
  'no-object': 'Money is no object',
};

export const TIME_BANDS = ['evenings', 'weeks', 'months', 'years'] as const;
export type TimeBand = (typeof TIME_BANDS)[number];
export const TIME_BAND_LABELS: Record<TimeBand, string> = {
  evenings: 'Evenings and weekends',
  weeks: 'A few weeks a year',
  months: 'Months at a time',
  years: 'Years',
};

/**
 * "What calls to you?" for the Loracle. Quest-shaped on purpose (the Futures' INTERESTS were
 * day-trip shaped). Optional context for the mind: the wish always speaks loudest.
 */
export const CALLINGS = [
  'fighting',
  'sea',
  'mountains',
  'wild',
  'sky',
  'road',
  'old',
  'craft',
  'music',
  'tongues',
  'edge',
  'pilgrim',
  'beasts',
  'kin',
] as const;
export type Calling = (typeof CALLINGS)[number];
export const CALLING_LABELS: Record<Calling, { label: string; emblem: Emblem }> = {
  fighting: { label: 'The fighting arts', emblem: 'fist' },
  sea: { label: 'The sea', emblem: 'ship' },
  mountains: { label: 'Mountains and ice', emblem: 'mountain' },
  wild: { label: 'The wild places', emblem: 'tree' },
  sky: { label: 'The sky and the stars', emblem: 'star' },
  road: { label: 'The long road', emblem: 'road' },
  old: { label: 'Old ruins, old stories', emblem: 'tower' },
  craft: { label: 'A craft in the hands', emblem: 'hand' },
  music: { label: 'Music and the stage', emblem: 'music' },
  tongues: { label: 'Far tongues, far people', emblem: 'book' },
  edge: { label: 'The body at its edge', emblem: 'flame' },
  pilgrim: { label: 'Pilgrim roads', emblem: 'bell' },
  beasts: { label: 'Beasts and their keepers', emblem: 'feather' },
  kin: { label: 'Roots and kin', emblem: 'house' },
};

/** Fill `{name}` holes in a LORACLE_LINES entry. Unknown holes are left as they are. */
export function fillLine(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (hole, name: string) => (name in vars ? String(vars[name]) : hole));
}

/** Every word the Loracle's screens say (the mind writes only the scroll itself). */
export const LORACLE_LINES = {
  // The stone's face (/oracle)
  title: 'The Loracle',
  header: 'These stones see what you do not',
  headerSub: 'They show the road. Only you can choose to walk it.',
  asleep: 'The stone sleeps. Its keeper has not woken it yet.',
  asleepWish: 'Your wish is written down. It will be read when the stone wakes.',
  dreaming: 'The stone is dreaming: a test mind is at work. Its roads are not real.',

  // Elsewhere in the app (Home teaser, Create menu)
  teaser: 'What do you long for?',
  teaserSub: 'Tell the stones. They will show you a road.',
  createTitle: 'Consult The Loracle',
  createText: 'Tell the stones what you wish for, and they will show you a quest.',

  // Speak
  headline: 'Speak a wish. The bigger, the better.',
  sub: 'The stones answer with a road, not advice.',
  wishStart: 'I wish ',
  wishLabel: 'Your wish',
  wishEmpty: 'Tell the stones what you wish for.',
  examples: 'Or take up one of these',
  cast: 'Cast it',
  privacy: "Only you will see this. The stone's mind is Claude, by Anthropic. It reads your wish, never your name.",

  // The stone's questions
  realmAsk: 'Where do you stand?',
  realmHint: 'Name your town. Only the town and its country are told to the stone.',
  realmChange: 'Change',
  reachAsk: 'How far will you go?',
  reachAnywhere: 'ANYWHERE',
  reachHint: 'The stones will look for a road within this reach.',
  reachHintAnywhere: 'The whole Earth. The stones will send you wherever your wish is truest.',
  callingsAsk: 'What calls to you?',
  callingsHint: 'The stones listen for these, but your wish speaks loudest.',
  knowAsk: 'What the stone should know',
  knowHint: 'Tell only what you wish to. It is kept for you alone.',
  ageAsk: 'Your age',
  ageNone: 'Rather not say',
  moneyAsk: 'Money to spend',
  timeAsk: 'Time you can give',
  bodyAsk: 'Your body',
  bodyPlaceholder: 'fit, a bad left knee, get seasick',
  languagesAsk: 'Tongues you speak',
  languagesPlaceholder: 'Icelandic, English, a little Spanish',
  passportAsk: 'Your passport',
  save: 'Keep it',

  // Consent (before the first cast). Owner: check these against Anthropic's current terms before release.
  consentTitle: 'Before the stone reads your wish',
  consentGoes:
    "What goes to Anthropic, the makers of Claude, the stone's mind: your wish, what you tell the stone about yourself, your town, its country and time zone, how far you will go, what calls to you, and today's date. The stone's searches go out to the web and carry words from your wish and your town.",
  consentNever: 'What never goes: your name, username, email, crews, plans, chapters, calendar, photos or exact location.',
  consentUse: 'Anthropic uses it to answer you and does not train its models on it.',
  consentKeeps: 'What LORE keeps: your wishes and quests, private to you, in your export, deleted with your account.',
  consentYes: 'Let the stone read',
  consentNo: 'Not now',
  consentWithdraw: 'Stop sending wishes',

  // The wait
  listening: 'The stone listens…',
  walkAway: 'Walk away if you like. The stone keeps working.',
  notifyToggle: "Tell me when it's sealed",
  notifyBody: 'The ink should be dry. Come and see your scroll.',
  slow: 'The fog is thick. The stone goes on.',
  fogOnce: 'The fog won. The stone will try again on its own.',
  fogTwice: 'The fog won twice. Try again when you like.',
  fogWeigh: 'The fog won. Say it again in a moment.',
  tryAgain: 'Try again',
  silent: 'The stone is silent on this one. Say it another way.',
  duplicate: 'The stone already drew this road.',
  duplicateDrawing: 'The stone is already drawing this road.',
  moon: 'The stone sleeps until the new moon. Your wish is written and will be read then.',
  moonFull: 'The stone sleeps until the new moon. Speak your wish again when it rises.',
  retried: 'The stone tried this road again today. Let it rest until the sun comes round again.',
  rest: 'The stone has heard many wishes from you this day. Let it rest until the sun comes round again.',

  // Riddle, reroute, care
  riddleOwn: 'Say it yourself',
  reroute: "The stone won't draw that road.",
  rerouteOffer: "There's a wish under that one: {offer} Cast it?",
  rerouteCast: 'Cast it',
  rerouteLet: 'Let it be',
  care1: 'That sounded heavy. Are you safe right now?',
  care2: 'Talk to someone you trust tonight.',
  careDanger: 'If you are in danger now, call {number}.',
  careCall: 'Call {number}',
  careMore: 'More lines',
  careBack: 'I meant something else',

  // The scroll
  beyond: 'No one has walked this road. Here is the nearest.',
  span: 'A road of about {amount} {unit}.',
  calling: 'The Calling',
  map: 'The Map',
  sealed: 'Sealed until you reach the one before.',
  breakSeal: 'Break the seal',
  when: 'When',
  where: 'Where',
  openInMaps: 'Open in maps',
  trial: 'The trial',
  keeper: 'Whom to find',
  earns: 'What it earns',
  mystery: 'What only the road can tell',
  realRoad: 'The real road',
  provisions: 'Provisions',
  rule: 'The one rule',
  thisWeek: 'This week',
  putInWeek: 'Put it in my week',
  fog: 'Left in the fog',
  looked: 'Where the stone looked',
  opened: 'opened',
  seenInSearch: 'seen in search',
  checkBefore: 'Check before you go. The world changes.',
  onlyYou: 'Only you can see this scroll.',

  // Deeds
  plan: 'Make it a plan',
  vault: 'Keep in the vault',
  ink: 'I did this',
  inkNote: 'A word about it (only you will see it)',
  unink: 'Wipe the ink',
  writeChapter: 'Write the chapter',
  fulfilled: 'The wish came true',
  release: 'Let it go',
  takeUp: 'Take it up again',
  burn: 'Burn this scroll',
  burnConfirm: "Burn this scroll? It can't be undone.",

  // The quest log
  quests: 'Your quests',
  noQuests: 'No quest yet. The stones wait for your wish.',
  letGo: 'Let go',
  inked: '{inked} of {total} inked',
  lore: 'Lore',
} as const;
export type LoracleLine = keyof typeof LORACLE_LINES;

/**
 * Example wishes, five shown at a time, chosen by ISO week (`loracleExamples`). Proper quests
 * only: the Loracle is never for day trips. Tapping one fills the field; it never casts.
 */
export const LORACLE_EXAMPLES: readonly string[] = [
  'I wish to become the Lethwei champion of the world.',
  'I wish to sail across an ocean.',
  'I wish to find the village my grandmother left.',
  'I wish to play my own song on a real stage.',
  'I wish to walk the Silk Road from end to end.',
  'I wish to cook in a real kitchen in Japan.',
  'I wish to cross Greenland on skis.',
  'I wish to forge my own sword.',
  'I wish to ride a horse across Mongolia.',
  'I wish to dance flamenco in Seville.',
  'I wish to build a boat with my own hands and sail it.',
  'I wish to learn to fight from a true master.',
  'I wish to dive down to a wreck on the sea floor.',
  'I wish to run a hundred miles in one go.',
  'I wish to dig up something no one has seen for a thousand years.',
  'I wish to sail around Cape Horn with a crew.',
  'I wish to become a blacksmith.',
  'I wish to herd reindeer with the Sámi through a winter.',
  'I wish to learn to fly a plane.',
  'I wish to paddle the length of a great river.',
  'I wish to train with the monks of Shaolin.',
  'I wish to swim the English Channel.',
  'I wish to bring my father to the place he was born.',
  'I wish to become a mountain guide.',
  'I wish to make a film that strangers will weep at.',
  'I wish to walk the Camino to the end of the world.',
  'I wish to sing in a choir in Georgia.',
  'I wish to become a falconer.',
  'I wish to work a season on a fishing boat in the far north.',
  'I wish to paint a wall that a whole town will see.',
  'I wish to stand on the roof of Africa.',
  'I wish to wrestle at a Naadam in Mongolia.',
  'I wish to sleep in a snow cave I dug with my own hands.',
  'I wish to write a book in a lighthouse.',
  'I wish to find the wreck my great-grandfather sailed on.',
  'I wish to speak the tongue my grandparents were made to forget.',
  'I wish to cross a desert with a caravan.',
  'I wish to carve a figurehead for a real ship.',
  'I wish to race a dog sled across Alaska.',
  'I wish to become a stonemason and leave my mark on a cathedral.',
];

/** ISO-8601 week number (1–53) of a date, read in UTC; for picking the week's examples. */
export function isoWeek(at: Date): number {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** The five example wishes for an ISO week. Week 1 shows the first five. */
export function loracleExamples(week: number): string[] {
  const n = LORACLE_EXAMPLES.length;
  const start = ((((week - 1) * 5) % n) + n) % n;
  return Array.from({ length: 5 }, (_, i) => LORACLE_EXAMPLES[(start + i) % n]!);
}

/**
 * Crisis lines for the care screen, by ISO 3166-1 alpha-2 country code. Static: the care screen
 * never depends on search or on the model. TO BE CHECKED BY A PERSON BEFORE RELEASE, each against
 * the line's own site (numbers, names and hours change). `hours`/`text` are null where unchecked.
 */
export const CRISIS_LINES: Record<string, { name: string; number: string; hours: string | null; text: string | null }> = {
  IS: { name: 'Hjálparsíminn 1717 (Red Cross)', number: '1717', hours: '24/7', text: 'web chat' },
  US: { name: '988 Suicide & Crisis Lifeline', number: '988', hours: null, text: 'call or text' },
  CA: { name: '9-8-8 Suicide Crisis Helpline', number: '988', hours: null, text: null },
  GB: { name: 'Samaritans', number: '116 123', hours: '24/7', text: null },
  IE: { name: 'Samaritans', number: '116 123', hours: '24/7', text: null },
  AU: { name: 'Lifeline', number: '13 11 14', hours: '24/7', text: null },
  NZ: { name: 'Need to talk?', number: '1737', hours: null, text: 'call or text' },
  DE: { name: 'TelefonSeelsorge', number: '0800 111 0 111', hours: '24/7', text: null },
  FR: { name: '3114', number: '3114', hours: null, text: null },
  NL: { name: '113 Zelfmoordpreventie', number: '0800 0113', hours: null, text: null },
  SE: { name: 'Mind Självmordslinjen', number: '90101', hours: null, text: null },
  NO: { name: 'Mental Helse Hjelpetelefonen', number: '116 123', hours: null, text: null },
  DK: { name: 'Livslinien', number: '70 201 201', hours: null, text: null },
};

const EU_EEA_112 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'NO', 'LI', 'CH',
] as const;

/**
 * Emergency numbers by ISO country code, for "If you are in danger now, call …". Where a country
 * is missing the line is left out rather than guessed. TO BE CHECKED BY A PERSON BEFORE RELEASE.
 */
export const EMERGENCY_NUMBERS: Record<string, string> = {
  ...Object.fromEntries(EU_EEA_112.map((c) => [c, '112'])),
  US: '911',
  CA: '911',
  GB: '999',
  AU: '000',
  NZ: '111',
};

/** Where "More lines" leads: a directory of helplines in every country. */
export const FIND_A_HELPLINE = 'https://findahelpline.com';
