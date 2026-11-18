// The dev fake mind (LORACLE_MIND=fake): no network, no key, no cost. It walks the same phases as
// the real mind with real-looking signs over about 8 seconds and returns a canned quest, so the
// stone and the scroll can be built and checked locally. Never active unless that env is set
// (config.loracle.mode === 'fake'); the page says the stone is dreaming.
//
// The canned roads are for the UI only. Their people, places and dates are not checked.
import { fakeSpend } from './cost.ts';
import { careFloor } from './care.ts';
import { countryName, townOf } from './prompts.ts';
import {
  MindError,
  type CastDraft,
  type DraftRoad,
  type DraftWaypoint,
  type LedgerRecord,
  type LoracleMind,
  type MindContext,
  type MindWish,
  type SignSink,
  type WeighResult,
  type WeighedWish,
  type Weighing,
} from './types.ts';
import type { LoracleSign, Mark, QuestSource } from '#shared';

export interface FakeMindOptions {
  /** Pause between signs. The default walks a cast in about 8 seconds; tests pass 0. */
  stepMs?: number;
}

const VAGUE = /^\s*i\s+(wish|want|wanna)\s+(to\s+be\s+|be\s+|i\s+(was|were|could\s+be)\s+|to\s+feel\s+|feel\s+|for\s+)?(happy|happier|free|loved|better|more|something\s+new|at\s+peace|content|okay|ok|good)\s*[.!]*\s*$/i;
const DARK = /\b(revenge|get back at|hurt (him|her|them|someone|my \w+)|kill (him|her|them|someone|my \w+)|steal|stalk|poison|make (him|her|them) pay|ruin (his|her|their))\b/i;
const LETHWEI = /\blethwei\b|\bburmese boxing\b|\bnine limbs\b/i;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(abortError(signal)) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): MindError {
  const reason = signal.reason as { name?: unknown } | undefined;
  return new MindError(reason?.name === 'TimeoutError' ? 'timeout' : 'interrupted');
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso.slice(0, 7)}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
};
const yearOf = (iso: string) => Number(iso.slice(0, 4));

const v = (...sources: number[]): Mark => ({ status: 'verified', year: null, sources });
const r = (...sources: number[]): Mark => ({ status: 'reported', year: null, sources });
const stale = (year: string, ...sources: number[]): Mark => ({ status: 'stale', year, sources });

function weighingFor(wish: MindWish, ctx: MindContext): Weighing {
  const lethwei = LETHWEI.test(wish.text);
  const tags: Weighing['tags'] = lethwei ? ['open', 'dangerous'] : ['open'];
  if (ctx.lorer.age === '13-17') tags.push('youth');
  return {
    tags,
    desire: lethwei ? 'to be feared and true in the ring' : 'to become someone the road remembers',
    binds: [],
    companion: null,
    clock: null,
    obvious: lethwei
      ? ['join a local muay thai class', 'watch fights online', 'buy gloves and a bag', 'travel to Thailand', 'hire a personal trainer']
      : ['join a club', 'take a class', 'read a book about it', 'travel somewhere', 'make a vision board'],
    terms: lethwei ? ['Lethwei', 'Lethwei Golden Belt', 'Thut Ti', 'Lone Chaw', 'ရိုးရာလက်ဝှေ့'] : [],
    hostLanguage: lethwei ? 'Burmese' : null,
    roadPlan: lethwei
      ? ['Myanmar eVisa Iceland passport November 2026', 'Lethwei gyms Yangon foreigners', 'Lethwei Golden Belt rules', 'boxing club Reykjavík fight team']
      : [`${townOf(ctx.realm.label)} club`, 'the oldest school of this craft'],
    keeperPlan: lethwei ? ['Lone Chaw trainer camp', 'Thut Ti Lethwei head trainer 2026', 'Iceland Lethwei fighter'] : ['master of this craft who takes students'],
  };
}

/** The canned Lethwei road: shaped on the spec's voice ("find Lone Chaw and do not leave…"). */
function lethweiRoad(ctx: MindContext): { road: DraftRoad; ledger: LedgerRecord } {
  const town = townOf(ctx.realm.label);
  const today = ctx.todayIso;
  const y = yearOf(today);
  const sources: QuestSource[] = [
    { n: 1, title: 'Lethwei', url: 'https://en.wikipedia.org/wiki/Lethwei', host: 'en.wikipedia.org', date: `${y}-09-30`, opened: true },
    { n: 2, title: 'Lone Chaw', url: 'https://en.wikipedia.org/wiki/Lone_Chaw', host: 'en.wikipedia.org', date: '2013', opened: true },
    { n: 3, title: 'Myanmar eVisa', url: 'https://evisa.moip.gov.mm/', host: 'evisa.moip.gov.mm', date: `${y}-10-02`, opened: true },
    { n: 4, title: 'Yangon', url: 'https://en.wikipedia.org/wiki/Yangon', host: 'en.wikipedia.org', date: null, opened: false },
  ];
  const wp: DraftWaypoint[] = [
    {
      kind: 'door',
      emblem: 'door',
      name: 'The Wrapped Hands',
      when: 'this week',
      at: addDays(today, 3),
      where: { place: `The fight room, ${town}`, town, country: countryName(ctx.realm.country), geoQuery: town, lat: null, lon: null, precision: null },
      clue: 'No gloves on the bags. Only gauze, tape and knuckles.',
      lore: false,
      trial: 'Train with the fight team, not the class, until the coach lets you spar under his eye.',
      person: { name: null, role: 'the head coach', verb: 'put you with the fight team', mark: null },
      earns: 'A place on the fight team',
      mystery: null,
      steps: [
        { kind: 'do', text: 'Walk in on a weekday evening. Ask for the fight team, not the class.', mark: r(1) },
        { kind: 'cost', text: 'Pay for one month and your own wraps.', mark: r(1) },
      ],
      noteIds: ['N1'],
    },
    {
      kind: 'bridge',
      emblem: 'plane',
      name: 'The Golden Land',
      when: `${monthName(addMonths(today, 4))} ${yearOf(addMonths(today, 4) + '-01')}`,
      at: addMonths(today, 4),
      where: { place: 'Thut Ti Lethwei Gym', town: 'Yangon', country: 'Myanmar', geoQuery: 'Yangon, Myanmar', lat: 16.8409, lon: 96.1735, precision: 'ledger' },
      clue: 'Drums and a reed horn play while the fighters circle.',
      lore: false,
      trial: 'Train twice a day at Thut Ti until a trainer there wraps your hands for a bout.',
      person: { name: 'Lone Chaw', role: 'Golden Belt champion, once head trainer at Thut Ti', verb: 'tell you where he trains now', mark: stale('2013', 2) },
      earns: 'Your first Lethwei wraps',
      mystery: null,
      steps: [
        { kind: 'gate', text: 'Apply for the Myanmar tourist eVisa on your passport before you fly.', mark: v(3) },
        { kind: 'do', text: 'Fly to Yangon. Sleep near the gym the first nights.', mark: r(4) },
        { kind: 'do', text: 'Ask at Thut Ti for Lone Chaw by name.', mark: stale('2013', 2) },
      ],
      noteIds: ['N2', 'N3', 'N4'],
    },
    {
      kind: 'crucible',
      emblem: 'flame',
      name: 'The Camp of Lone Chaw',
      when: 'when Thut Ti points the way',
      at: null,
      where: { place: 'Lone Chaw’s camp', town: 'Yangon', country: 'Myanmar', geoQuery: 'Yangon, Myanmar', lat: 16.8409, lon: 96.1735, precision: 'ledger' },
      clue: 'At dawn the fighters run before the heat comes.',
      lore: true,
      trial: 'Refuse to leave his camp until Lone Chaw wraps your hands himself for your first bout.',
      person: { name: 'Lone Chaw', role: 'Golden Belt champion and trainer', verb: 'train you for the ring', mark: stale('2013', 2) },
      earns: 'His word that you are ready',
      mystery: 'Where Lone Chaw’s own camp stands. Thut Ti knows.',
      steps: [
        { kind: 'do', text: 'Bring Thut Ti’s word with you. Ask him once, at the camp.', mark: stale('2013', 2) },
        { kind: 'cost', text: 'Pay the camp’s monthly fee in kyat.', mark: r(1) },
      ],
      noteIds: ['N4'],
    },
    {
      kind: 'test',
      emblem: 'fist',
      name: 'The Bare Knuckle Rite',
      when: 'when your trainer says',
      at: null,
      where: { place: 'Theinbyu Stadium', town: 'Yangon', country: 'Myanmar', geoQuery: 'Theinbyu Stadium, Yangon, Myanmar', lat: 16.787, lon: 96.165, precision: 'ledger' },
      clue: 'The crowd roars when a fighter takes a knee and bows.',
      lore: false,
      trial: 'Fight a sanctioned bout under the referee and the doctor. Win or lose, it goes on your record.',
      person: null,
      earns: 'A sanctioned fight record',
      mystery: 'Which fighter they will match you with. The promoter decides the night before.',
      steps: [
        { kind: 'gate', text: 'Pass the fight medical before you sign the bout.', mark: v(1) },
        { kind: 'do', text: 'Let your trainer speak to the promoter. Never sign alone.', mark: r(1) },
      ],
      noteIds: ['N1', 'N5'],
    },
    {
      kind: 'summit',
      emblem: 'crown',
      name: 'The Golden Belt',
      when: `when you are ready, about ${y + 6}`,
      at: null,
      where: { place: 'Theinbyu Stadium', town: 'Yangon', country: 'Myanmar', geoQuery: 'Theinbyu Stadium, Yangon, Myanmar', lat: 16.787, lon: 96.165, precision: 'ledger' },
      clue: 'No judges, no points. Only a knockout takes the belt.',
      lore: false,
      trial: 'Fight in Yangon until the belt’s keepers call your name. Then take the belt from the one who holds it, before the crowd.',
      person: null,
      earns: 'The Lethwei Golden Belt',
      mystery: 'Who will hold the belt when your night comes.',
      steps: [
        { kind: 'do', text: 'Fight every bout your trainer gives you. Keep your record clean.', mark: r(1) },
        { kind: 'gate', text: 'The Golden Belt is fought for by invitation, not entry.', mark: v(1) },
      ],
      noteIds: ['N1'],
    },
  ];
  const road: DraftRoad = {
    title: 'The Ninth Limb',
    calling: 'Lethwei is fought with nine limbs. The ninth is your head. Make your way to Yangon, find Lone Chaw, and do not leave until he wraps your hands himself.',
    truth: null,
    span: { amount: 7, unit: 'years' },
    thisWeek: { text: `Walk into the fight room in ${town} and ask for the fight team, not the class.`, mark: r(1), day: addDays(today, 2), minutes: 45 },
    provisions: {
      coin: [{ text: 'Flights to Yangon: no fare found yet.', mark: r(4), counsel: false }],
      papers: [{ text: 'A passport with six months left, and the tourist eVisa.', mark: v(3), counsel: false }],
      body: [
        { text: 'Head strikes are allowed. Every bout needs the fight medical first.', mark: v(1), counsel: false },
        { text: 'Learn to fall before you learn to hit.', mark: null, counsel: true },
      ],
      skills: [{ text: 'Clinch, elbows and knees before you leave home.', mark: r(1), counsel: false }],
      tongue: [{ text: 'Learn to count to ten and to say thank you in Burmese.', mark: r(4), counsel: false }],
    },
    rule: 'Never fight without the fight medical and your own trainer in your corner.',
    sources,
    waypoints: wp,
  };
  const ledger: LedgerRecord = {
    notes: [
      { id: 'N1', kind: 'detail', name: 'Lethwei', place: 'Myanmar', text: 'Burmese bare-knuckle boxing; head strikes allowed; nine limbs.', status: 'verified', year: null, sources: [1] },
      { id: 'N2', kind: 'place', name: 'Thut Ti Lethwei Gym', place: 'Yangon, Myanmar', text: 'A Lethwei gym in Yangon that trains foreigners.', status: 'reported', year: null, sources: [2] },
      { id: 'N3', kind: 'gate', name: 'Myanmar eVisa', place: 'Myanmar', text: 'Tourist eVisa for many passports, applied for online.', status: 'verified', year: null, sources: [3] },
      { id: 'N4', kind: 'person', name: 'Lone Chaw', place: 'Thut Ti Lethwei Gym, Yangon, Myanmar', text: 'Golden Belt champion; head trainer at Thut Ti, later left to form his own camp.', status: 'stale', year: '2013', sources: [2] },
      { id: 'N5', kind: 'place', name: 'Theinbyu Stadium', place: 'Yangon, Myanmar', text: 'A stadium in Yangon where Lethwei bouts are held.', status: 'reported', year: null, sources: [4] },
    ],
    gaps: ['Where is Lone Chaw’s own camp, and does he still coach?'],
  };
  return { road, ledger };
}

/** The canned road for any other wish: the same shape, in the stone's voice. */
function genericRoad(wish: MindWish, ctx: MindContext): { road: DraftRoad; ledger: LedgerRecord } {
  const town = townOf(ctx.realm.label);
  const today = ctx.todayIso;
  const y = yearOf(today);
  const sources: QuestSource[] = [
    { n: 1, title: town, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(town.replace(/ /g, '_'))}`, host: 'en.wikipedia.org', date: null, opened: true },
  ];
  const m = r(1);
  const wp: DraftWaypoint[] = [
    {
      kind: 'door',
      emblem: 'door',
      name: 'The First Door',
      when: 'this week',
      at: addDays(today, 4),
      where: { place: `The old guild hall, ${town}`, town, country: countryName(ctx.realm.country), geoQuery: town, lat: null, lon: null, precision: null },
      clue: 'Voices drop when a stranger walks in.',
      lore: false,
      trial: 'Walk in among those who already do what you wish to do. Ask who of them has gone farthest. Do not leave without one name.',
      person: { name: null, role: 'the eldest among them', verb: 'give you one name', mark: null },
      earns: 'One name',
      mystery: null,
      steps: [
        { kind: 'do', text: 'Go on a weeknight, when they gather. Say plainly what you wish.', mark: m },
        { kind: 'do', text: 'Write the name down before you leave.', mark: m },
      ],
      noteIds: ['N1'],
    },
    {
      kind: 'bridge',
      emblem: 'road',
      name: 'The Keeper’s Hall',
      when: monthName(addMonths(today, 1)),
      at: addMonths(today, 1),
      where: { place: `The keeper’s hall, ${town}`, town, country: countryName(ctx.realm.country), geoQuery: town, lat: null, lon: null, precision: null },
      clue: 'A door with old boots outside it, worn to the shape of the road.',
      lore: false,
      trial: 'Find the one whose name you were given. Ask once to learn from them, and earn a second meeting.',
      person: { name: null, role: 'one who walked this road before you', verb: 'teach you the first of it', mark: null },
      earns: 'A second meeting',
      mystery: 'What they will ask of you in return.',
      steps: [
        { kind: 'do', text: 'Write first. Say plainly what you wish and what you can give.', mark: m },
        { kind: 'do', text: 'Bring something your hands have made.', mark: m },
      ],
      noteIds: ['N1'],
    },
    {
      kind: 'crucible',
      emblem: 'flame',
      name: 'The Hard Season',
      when: `winter ${y + 1}`,
      at: addMonths(today, 6),
      where: { place: 'The far camp', town: null, country: countryName(ctx.realm.country), geoQuery: countryName(ctx.realm.country), lat: null, lon: null, precision: null },
      clue: 'The work begins before the light does.',
      lore: false,
      trial: 'Stay one full season where the work is hardest. Do not leave until they give you work of your own.',
      person: null,
      earns: 'Work of your own',
      mystery: 'Who else came that season, and why.',
      steps: [
        { kind: 'cost', text: 'Save for a season’s board before you go.', mark: m },
        { kind: 'do', text: 'Keep a log of every day. The road remembers.', mark: m },
      ],
      noteIds: ['N1'],
    },
    {
      kind: 'summit',
      emblem: 'star',
      name: 'The Wish Kept',
      when: `about ${y + 3}`,
      at: null,
      where: { place: 'Where the road ends', town: null, country: countryName(ctx.realm.country), geoQuery: countryName(ctx.realm.country), lat: null, lon: null, precision: null },
      clue: 'Someone you trained calls you by a new name.',
      lore: false,
      trial: 'Do the thing you wished for, before a witness who knows the road.',
      person: null,
      earns: 'The wish, kept',
      mystery: null,
      steps: [
        { kind: 'do', text: 'Ask your teacher to stand witness.', mark: m },
        { kind: 'do', text: 'Write the chapter the same night.', mark: m },
      ],
      noteIds: ['N1'],
    },
  ];
  const road: DraftRoad = {
    title: 'The Unwalked Road',
    calling: `The world is not in your books and maps. It is out there. Leave ${town} with one name in your pocket, and do not come home until the road calls you its own.`,
    truth: null,
    span: { amount: 3, unit: 'years' },
    thisWeek: { text: `Walk into the old guild hall in ${town} and ask who among them has gone farthest.`, mark: m, day: addDays(today, 1), minutes: 40 },
    provisions: {
      coin: [{ text: 'A season’s board, saved before you go.', mark: m, counsel: false }],
      papers: [],
      body: [{ text: 'Walk an hour a day from now on.', mark: null, counsel: true }],
      skills: [{ text: 'Learn the first craft of the road before winter.', mark: m, counsel: false }],
      tongue: [],
    },
    rule: null,
    sources,
    waypoints: wp,
  };
  const ledger: LedgerRecord = {
    notes: [{ id: 'N1', kind: 'place', name: town, place: town, text: 'Where the Lorer stands.', status: 'reported', year: null, sources: [1] }],
    gaps: [wish.riddleAnswer ? 'What the riddle’s answer asks of the road?' : 'Who in this town has walked this road?'],
  };
  return { road, ledger };
}

function monthName(yyyyMm: string): string {
  const d = new Date(`${yyyyMm}-15T12:00:00Z`);
  return d.toLocaleString('en', { month: 'long', timeZone: 'UTC' });
}

/** The fake weighing's verdict for a wish (also used by the eval to sanity-check routing). */
export function fakeVerdict(wish: MindWish, ctx: MindContext): WeighResult['verdict'] {
  if (careFloor(wish.text) || (wish.riddleAnswer && careFloor(wish.riddleAnswer))) return { route: 'care' };
  if (!wish.rerouted && DARK.test(wish.text))
    return { route: 'reroute', offer: 'I wish to become so strong that the past cannot touch me.' };
  if (!wish.riddleAnswer && VAGUE.test(wish.text)) {
    const word = /(happy|happier|free|loved|better|more|new|peace|content|okay|ok|good)/i.exec(wish.text)?.[1] ?? 'More';
    const head = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    return { route: 'riddle', riddle: { question: `${head} like…`, options: ['a roaring crowd', 'a quiet morning', 'someone beside you'] } };
  }
  return { route: 'quest', weighing: weighingFor(wish, ctx) };
}

export function fakeMind(opts: FakeMindOptions = {}): LoracleMind {
  const stepMs = opts.stepMs ?? 700;
  return {
    kind: 'fake',

    async weigh(wish, ctx, signal): Promise<WeighResult> {
      await sleep(Math.min(stepMs, 400), signal);
      const verdict = fakeVerdict(wish, ctx);
      const outcome = verdict.route === 'quest' ? 'ok' : verdict.route;
      return { verdict, spend: [fakeSpend('weigh', outcome)] };
    },

    async cast(wish: WeighedWish, ctx: MindContext, onSign: SignSink, signal: AbortSignal): Promise<CastDraft> {
      const lethwei = LETHWEI.test(wish.text);
      const town = townOf(ctx.realm.label);
      const signs: LoracleSign[] = lethwei
        ? [
            { kind: 'search', query: 'Myanmar eVisa for your passport' },
            { kind: 'search', query: 'Lethwei gyms in Yangon that take foreigners' },
            { kind: 'fetch', host: 'evisa.moip.gov.mm' },
            { kind: 'search', query: 'Lone Chaw trainer camp' },
            { kind: 'fetch', host: 'en.wikipedia.org' },
            { kind: 'search', query: `fight team ${town}` },
            { kind: 'name' },
            { kind: 'cost' },
            { kind: 'compose' },
            { kind: 'seal' },
          ]
        : [
            { kind: 'search', query: `who has left ${town} on a road like this` },
            { kind: 'search', query: 'the ones who walked this road before' },
            { kind: 'fetch', host: 'en.wikipedia.org' },
            { kind: 'search', query: 'a master who takes students' },
            { kind: 'name' },
            { kind: 'cost' },
            { kind: 'compose' },
            { kind: 'seal' },
          ];
      // Spread the signs over ~8 s at the default pace.
      const pause = signs.length > 0 ? Math.round((stepMs * 11) / signs.length) : stepMs;
      for (const s of signs) {
        await sleep(pause, signal);
        onSign(s);
      }
      await sleep(Math.round(stepMs / 2), signal);
      const { road, ledger } = lethwei ? lethweiRoad(ctx) : genericRoad(wish, ctx);
      return {
        kind: 'road',
        road,
        rough: false,
        faults: [],
        forge: { fake: true },
        ledger,
        spend: [fakeSpend('road', 'ok'), fakeSpend('keepers', 'ok'), fakeSpend('compose', 'ok')],
      };
    },
  };
}
