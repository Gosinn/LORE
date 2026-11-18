// The wire schemas the mind asks Claude to fill (structured outputs, output_config.format).
//
// Wire schemas carry no min/max: structured outputs don't support numerical or array-size
// constraints (the SDK would move them into descriptions). Every count and length rule lives in
// checks.ts, so a miscount becomes a fault to repair, never a parse crash. Nullable instead of
// optional: every property is required. Numbers are plain `number` (rounded in code) so no
// integer bounds leak into the schema.
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { EMBLEMS, LORACLE_TAGS, SPAN_UNITS, STEP_KINDS, WAYPOINT_KINDS } from '#shared';

export const WeighingWire = z.object({
  route: z.enum(['quest', 'riddle', 'care', 'reroute']),
  riddle: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
  offer: z.string().nullable(),
  tags: z.array(z.enum(LORACLE_TAGS)),
  desire: z.string(),
  binds: z.array(z.string()),
  companion: z.string().nullable(),
  clock: z.string().nullable(),
  obvious: z.array(z.string()),
  terms: z.array(z.string()),
  hostLanguage: z.string().nullable(),
  roadPlan: z.array(z.string()),
  keeperPlan: z.array(z.string()),
});
export type WeighingWireT = z.infer<typeof WeighingWire>;

const Step = z.object({ kind: z.enum(STEP_KINDS), text: z.string(), noteIds: z.array(z.string()) });
const Line = z.object({ text: z.string(), noteIds: z.array(z.string()), counsel: z.boolean() });
const Person = z.object({
  name: z.string().nullable(),
  role: z.string(),
  verb: z.string(),
  noteId: z.string().nullable(),
});

const WaypointWire = z.object({
  kind: z.enum(WAYPOINT_KINDS),
  emblem: z.enum(EMBLEMS),
  name: z.string(),
  when: z.string(),
  /** YYYY-MM-DD | YYYY-MM | null (a trigger). */
  at: z.string().nullable(),
  where: z.object({
    place: z.string(),
    town: z.string().nullable(),
    country: z.string(),
    geoQuery: z.string(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
  }),
  clue: z.string(),
  lore: z.boolean(),
  trial: z.string(),
  person: Person.nullable(),
  earns: z.string().nullable(),
  mystery: z.string().nullable(),
  road: z.array(Step),
  noteIds: z.array(z.string()),
});

export const DROP_REASONS = [
  'stale',
  'undated',
  'duplicate',
  'no-action',
  'unsafe',
  'off-path',
  'closed',
  'private',
  'disputed',
] as const;

export const QuestDraftWire = z.object({
  // First, so it is written first; never shown.
  forge: z.object({
    candidates: z.array(z.string()),
    chosen: z.string(),
    versusObvious: z.array(
      z.object({ position: z.number(), matches: z.string().nullable(), edge: z.string().nullable() }),
    ),
    dropped: z.array(z.object({ noteId: z.string(), why: z.enum(DROP_REASONS) })),
  }),
  title: z.string(),
  calling: z.string(),
  truth: z.string().nullable(),
  span: z.object({ amount: z.number(), unit: z.enum(SPAN_UNITS) }),
  map: z.array(WaypointWire),
  thisWeek: z.object({
    text: z.string(),
    noteIds: z.array(z.string()),
    day: z.string().nullable(),
    minutes: z.number(),
  }),
  provisions: z.object({
    coin: z.array(Line),
    papers: z.array(Line),
    body: z.array(Line),
    skills: z.array(Line),
    tongue: z.array(Line),
  }),
  rule: z.string().nullable(),
});

export type QuestDraftT = z.infer<typeof QuestDraftWire>;
export type WaypointDraftT = QuestDraftT['map'][number];
export type StepDraftT = WaypointDraftT['road'][number];
export type LineDraftT = QuestDraftT['provisions']['coin'][number];
export type PersonDraftT = NonNullable<WaypointDraftT['person']>;

/** The JSON Schemas sent as output_config.format (built once; byte-stable for the schema cache). */
export const WEIGH_FORMAT = { type: 'json_schema' as const, schema: zodOutputFormat(WeighingWire).schema };
export const QUEST_FORMAT = { type: 'json_schema' as const, schema: zodOutputFormat(QuestDraftWire).schema };
