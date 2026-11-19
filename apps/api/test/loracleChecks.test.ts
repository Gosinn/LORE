// The Loracle's code-side mind: ledger, checks, marks, draw and seals. No network, no database.
import { describe, expect, it } from 'vitest';
import { checkDeeper, checkDraft, faultLines, findPhrase, type CheckContext, type DeeperCheckContext } from '../src/lib/loracle/checks.ts';
import { drawFeed, drawFlow, drawRequest } from '../src/lib/loracle/flow.ts';
import { drawPins, shapeWaypoint, toRoad, waypointState, weekDay, type FullWaypoint } from '../src/lib/loracle/draw.ts';
import { SeenUrls, buildLedger, canonicalUrl, foldName, markOf, parseDossier, samePlace, type Ledger } from '../src/lib/loracle/ledger.ts';
import { BANNED, HEDGES } from '../src/lib/loracle/prompts.ts';
import { DeeperWire, QuestDraftWire, type DeeperDraftT, type QuestDraftT } from '../src/lib/loracle/schema.ts';
import type { LedgerNote } from '../src/lib/loracle/types.ts';

const TODAY = '2026-11-18';

// Made-up keepers (Saya Min Thu, Ko Zaw Lin, Ari Jónsson) in real places, for the checks only.
const ROAD = `ROLE: ROAD
R1 | place | Thut Ti Lethwei Gym | Yangon, Myanmar | 16.8,96.15 | Lethwei gym in Yangon that trains foreigners, classes twice daily | VERIFIED | https://thuttilethwei.com/about | 2026-03-01
R2 | gate | Myanmar eVisa | Myanmar | - | Tourist eVisa US$50, 28 days stay, apply online for Icelandic passports | VERIFIED | https://evisa.moip.gov.mm/ | 2026-10-02
R3 | place | Theinbyu Stadium | Yangon, Myanmar | - | Stadium hosting Lethwei bouts | REPORTED | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30
R4 | place | Theinphyu Stadium | Yangon, Myanmar | 16.79,96.17 | Lethwei bouts every month | VERIFIED | https://www.wikiwand.com/en/articles/Thein_Phyu_Stadium | 2025-12-01
R5 | near | Mjölnir | Reykjavík, Iceland | - | Fight gym with a striking team, Monday 18:00 sessions, mjolnir@mjolnir.is | VERIFIED | https://mjolnir.is/stundaskra | 2026-10-20
R6 | advice | Kayin State | Kayin State, Myanmar | - | FCDO advises against all travel to Kayin State | VERIFIED | https://www.gov.uk/foreign-travel-advice/myanmar | 2026-11-01
R7 | cost | Thut Ti training fee | Thut Ti Lethwei Gym, Yangon, Myanmar | - | Monthly training 300 USD | REPORTED | https://thuttilethwei.com/prices?utm_source=newsletter | 2026-05-01
R8 | gate | Fight medical | Myanmar | - | Every bout needs a medical check by the federation doctor | VERIFIED | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30
R9 | event | Old champion's gym | Mandalay, Myanmar | - | Open sparring on Fridays | VERIFIED | https://oldgym.example.org/news | 2019-02-01
R10 | detail | Ghost | Yangon, Myanmar | - | A line whose page no tool returned | VERIFIED | https://never-seen.example.com/page | 2026-01-01
this line is prose and is dropped
GAPS: Where is the old champion's own camp? Does the gym take foreigners in winter?`;

const KEEPERS = `ROLE: KEEPERS
K1 | person | Saya Min Thu | Thut Ti Lethwei Gym, Yangon, Myanmar | - | Golden Belt champion; head trainer at Thut Ti from 2012 | STALE | https://en.wikipedia.org/wiki/Saya_Min_Thu | 2013
K2 | person | Saya Min Thu | Thut Ti Lethwei Gym, Yangon, Myanmar | - | Still coaches fighters at Thut Ti | REPORTED | https://thuttilethwei.com/about | 2026-03-01
K3 | person | Ko Zaw Lin | Theinbyu Stadium, Yangon, Myanmar | - | Lethwei fighter who trains visiting fighters | VERIFIED | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30
K4 | person | Ari Jónsson | Mjölnir, Reykjavík, Iceland | - | Striking coach at Mjölnir | VERIFIED | https://mjolnir.is/thjalfarar | 2026-09-01
K5 | person | - | Thein Pyu Stadium, Yangon, Myanmar | - | checked, no names | - | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30
K6 | detail | Drums | Thut Ti Lethwei Gym, Yangon, Myanmar | - | Drums and a reed horn play during bouts | VERIFIED | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30`;

/** What the web tools returned: search results, a fetch, and a citation. */
function seenUrls(): SeenUrls {
  const seen = new SeenUrls();
  seen.collect({
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [
      { type: 'web_search_result', url: 'https://thuttilethwei.com/about', title: 'About Thut Ti', page_age: 'March 1, 2026', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://evisa.moip.gov.mm/', title: 'Myanmar eVisa', page_age: null, encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://en.m.wikipedia.org/wiki/Lethwei', title: 'Lethwei', page_age: null, encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Thein_Phyu_Stadium', title: 'Thein Phyu Stadium', page_age: null, encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://www.gov.uk/foreign-travel-advice/myanmar', title: 'Myanmar travel advice', page_age: '1 Nov 2026', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://thuttilethwei.com/prices', title: 'Prices', page_age: null, encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://oldgym.example.org/news', title: 'News', page_age: '2019', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Saya_Min_Thu', title: 'Saya Min Thu', page_age: null, encrypted_content: 'x' },
    ],
  });
  seen.collect({
    type: 'web_fetch_tool_result',
    tool_use_id: 'srv_2',
    content: {
      type: 'web_fetch_result',
      url: 'https://mjolnir.is/stundaskra',
      retrieved_at: '2026-11-18T10:00:00Z',
      content: {
        type: 'document',
        title: 'Stundaskrá',
        source: { type: 'text', media_type: 'text/plain', data: 'Links on the page are not sources: https://never-seen.example.com/page' },
        citations: null,
      },
    },
  });
  seen.collect({
    type: 'text',
    text: 'K4 …',
    citations: [{ type: 'web_search_result_location', url: 'https://mjolnir.is/thjalfarar', title: 'Þjálfarar', cited_text: 'x', encrypted_index: 'x' }],
  });
  // The model's own words are never a source.
  seen.collect({ type: 'server_tool_use', id: 'srv_3', name: 'web_fetch', input: { url: 'https://made-up.example.net/' } });
  return seen;
}

function ledgerFixture(): Ledger {
  return buildLedger([ROAD, KEEPERS], seenUrls(), TODAY);
}

// Advice lines in the shapes the scouts write them: regions with their country, a direction and a
// country, a whole country with no place, and a country line that names only some of its provinces.
const ADVICE = `ROLE: ROAD
R11 | advice | Sagaing Region | Sagaing Region, Myanmar | - | FCDO advises against all travel to Sagaing Region | VERIFIED | https://www.gov.uk/foreign-travel-advice/myanmar | 2026-11-01
R12 | advice | Shan State | Shan State, Myanmar | - | FCDO advises against all travel to Shan State | VERIFIED | https://www.gov.uk/foreign-travel-advice/myanmar | 2026-11-01
R13 | advice | Southern Thailand | Thailand | - | FCDO advises against all but essential travel to Southern Thailand | VERIFIED | https://www.gov.uk/foreign-travel-advice/thailand | 2026-11-01
R14 | advice | North Korea | - | - | FCDO advises against all travel to North Korea | VERIFIED | https://www.gov.uk/foreign-travel-advice/north-korea | 2026-11-01
R16 | advice | Thailand | Thailand | - | FCDO advises against all but essential travel to Pattani, Yala and Narathiwat | VERIFIED | https://www.gov.uk/foreign-travel-advice/thailand | 2026-11-01`;
/** The whole of Myanmar under such advice. */
const ADVICE_MYANMAR = `ROLE: ROAD
R15 | advice | Myanmar | - | - | FCDO advises against all but essential travel to Myanmar | VERIFIED | https://www.gov.uk/foreign-travel-advice/myanmar | 2026-11-01`;

function adviceLedger(...more: string[]): Ledger {
  const seen = seenUrls();
  seen.collect({
    type: 'web_search_tool_result',
    tool_use_id: 'srv_4',
    content: [
      { type: 'web_search_result', url: 'https://www.gov.uk/foreign-travel-advice/thailand', title: 'Thailand travel advice', page_age: '1 Nov 2026', encrypted_content: 'x' },
      { type: 'web_search_result', url: 'https://www.gov.uk/foreign-travel-advice/north-korea', title: 'North Korea travel advice', page_age: '1 Nov 2026', encrypted_content: 'x' },
    ],
  });
  return buildLedger([ROAD, KEEPERS, ADVICE, ...more], seen, TODAY);
}

const idOf = (ledger: Ledger, name: string) => {
  const n = ledger.notes.find((x) => x.name === name);
  if (!n) throw new Error(`no note for ${name}`);
  return n.id;
};

/** A draft that passes every check against the ledger above (dangerous, abroad). */
function draftFixture(ledger: Ledger): QuestDraftT {
  const N = (name: string) => idOf(ledger, name);
  const gym = N('Thut Ti Lethwei Gym');
  const visa = N('Myanmar eVisa');
  const stadium = N('Theinbyu Stadium');
  const near = N('Mjölnir');
  const fee = N('Thut Ti training fee');
  const medical = N('Fight medical');
  const saya = N('Saya Min Thu');
  const ko = N('Ko Zaw Lin');
  const ari = N('Ari Jónsson');
  const drums = N('Drums');
  const draft: QuestDraftT = {
    forge: {
      candidates: ['A journey to Saya Min Thu', 'The stadium with a secret', 'A deed in the ring'],
      chosen: 'The journey to a trainer moves most.',
      versusObvious: [
        { position: 0, matches: 'join a local muay thai class', edge: 'Ari Jónsson must let you spar' },
        { position: 1, matches: null, edge: null },
        { position: 2, matches: null, edge: null },
        { position: 3, matches: null, edge: null },
      ],
      dropped: [],
    },
    title: 'The Ninth Limb',
    calling:
      'Lethwei is fought with nine limbs. Go to Yangon, find Saya Min Thu at Thut Ti Lethwei Gym, and do not leave until he wraps your hands himself.',
    truth: null,
    span: { amount: 7, unit: 'years' },
    map: [
      {
        kind: 'door',
        emblem: 'door',
        name: 'The Wrapped Hands',
        when: 'this Monday',
        at: '2026-11-23',
        where: { place: 'Mjölnir', town: 'Reykjavík', country: 'Iceland', geoQuery: 'Mjölnir, Reykjavík, Iceland', lat: null, lon: null },
        clue: 'Gauze and tape on every fist, no gloves on the bags.',
        lore: false,
        trial: 'Train with the striking team until Ari Jónsson lets you spar under his eye.',
        person: { name: 'Ari Jónsson', role: 'striking coach at Mjölnir', verb: 'put you on the striking team', noteId: ari },
        earns: 'A place on the striking team',
        mystery: null,
        road: [
          { kind: 'do', text: 'Monday sessions start at 18:00. Come ten minutes early.', noteIds: [near] },
          { kind: 'do', text: 'Write to mjolnir@mjolnir.is first, before you go.', noteIds: [near] },
        ],
        noteIds: [near, ari],
      },
      {
        kind: 'bridge',
        emblem: 'plane',
        name: 'The Golden Land',
        when: 'March 2027',
        at: '2027-03',
        where: { place: 'Thut Ti Lethwei Gym', town: 'Yangon', country: 'Myanmar', geoQuery: 'Thut Ti Lethwei Gym, Yangon, Myanmar', lat: 16.8, lon: 96.15 },
        clue: 'Drums and a reed horn play during the bouts.',
        lore: false,
        trial: 'Train twice a day until Saya Min Thu wraps your hands for a bout.',
        person: { name: 'Saya Min Thu', role: 'Golden Belt champion and trainer', verb: 'train you for the ring', noteId: saya },
        earns: 'Your first wraps',
        mystery: 'Where the old champion keeps his own camp. Thut Ti knows.',
        road: [
          { kind: 'gate', text: 'Apply for the tourist eVisa on your Icelandic passport. US$50. 28 days.', noteIds: [visa] },
          { kind: 'cost', text: 'Training costs 300 USD a month.', noteIds: [fee] },
          { kind: 'do', text: 'Fly to Yangon and sleep near the gym.', noteIds: [gym] },
        ],
        noteIds: [gym, visa, fee, saya, drums],
      },
      {
        kind: 'test',
        emblem: 'fist',
        name: 'The Bare Knuckle Rite',
        when: 'when your trainer says',
        at: null,
        where: { place: 'Theinbyu Stadium', town: 'Yangon', country: 'Myanmar', geoQuery: 'Theinbyu Stadium, Yangon, Myanmar', lat: null, lon: null },
        clue: 'The crowd roars when a fighter kneels and bows.',
        lore: false,
        trial: 'Fight a sanctioned bout before the federation doctor and a referee.',
        person: { name: 'Ko Zaw Lin', role: 'fighter who trains visitors', verb: 'match you for your first bout', noteId: ko },
        earns: 'A fight record',
        mystery: 'Who they will match you with on the night.',
        road: [
          { kind: 'gate', text: 'Pass the federation medical check before every bout.', noteIds: [medical] },
          { kind: 'do', text: 'Ask Ko Zaw Lin at the stadium for a first bout.', noteIds: [ko] },
        ],
        noteIds: [stadium, medical, ko],
      },
      {
        kind: 'summit',
        emblem: 'crown',
        name: 'The Golden Belt',
        when: 'when you are ready, about 2033',
        at: null,
        where: { place: 'Mandalay Lethwei Ring', town: 'Mandalay', country: 'Myanmar', geoQuery: 'Mandalay, Myanmar', lat: null, lon: null },
        clue: 'The belt is gold and the champion wears it home.',
        lore: false,
        trial: 'Climb the ranks until the federation calls you to fight for the Golden Belt.',
        person: null,
        earns: 'The Golden Belt',
        mystery: 'Who will hold the belt when your night comes.',
        road: [
          { kind: 'do', text: 'Fight every bout your trainer gives you before a doctor.', noteIds: [medical] },
          { kind: 'gate', text: 'Every title bout needs the medical check by the federation doctor.', noteIds: [medical] },
        ],
        noteIds: [medical],
      },
    ],
    thisWeek: { text: 'Walk into Mjölnir on Monday and ask Ari Jónsson for the striking team.', noteIds: [near, ari], day: '2026-11-23', minutes: 45 },
    provisions: {
      coin: [{ text: 'Budget 300 USD for each month of training in Yangon.', noteIds: [fee], counsel: false }],
      papers: [{ text: 'An Icelandic passport and the tourist eVisa, applied for online.', noteIds: [visa], counsel: false }],
      body: [{ text: 'Learn to fall before you learn to strike.', noteIds: [], counsel: true }],
      skills: [],
      tongue: [],
    },
    rule: 'Never step into a ring without your own trainer in your corner.',
  };
  return QuestDraftWire.parse(draft);
}

function context(ledger: Ledger, over: Partial<CheckContext> = {}): CheckContext {
  return {
    ledger,
    weighing: { tags: ['open', 'dangerous'], binds: [] },
    wishText: 'I wish to become the Lethwei champion of the world.',
    homeCountry: 'IS',
    todayIso: TODAY,
    seen: seenUrls(),
    ...over,
  };
}

const codes = (faults: { code: string }[]) => faults.map((f) => f.code);

describe('the ledger', () => {
  it('canonicalises URLs: tracking, www, AMP and Wikipedia mirrors fold together', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&b=2#top')).toBe('example.com/a?b=2');
    expect(canonicalUrl('https://example.com/story/amp')).toBe('example.com/story');
    expect(canonicalUrl('https://www.wikiwand.com/en/articles/Thein_Phyu_Stadium')).toBe('en.wikipedia.org/wiki/Thein_Phyu_Stadium');
    expect(canonicalUrl('https://en.m.wikipedia.org/wiki/Lethwei')).toBe('en.wikipedia.org/wiki/Lethwei');
    expect(canonicalUrl('https://wikiless.org/wiki/Lethwei?lang=en')).toBe('en.wikipedia.org/wiki/Lethwei');
    expect(canonicalUrl('ftp://example.com')).toBeNull();
  });

  it('parses dossier lines and gaps, dropping malformed lines', () => {
    const { lines, gaps } = parseDossier(ROAD);
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatchObject({ id: 'R1', kind: 'place', name: 'Thut Ti Lethwei Gym', coords: { lat: 16.8, lon: 96.15 }, status: 'verified' });
    expect(gaps).toEqual(["Where is the old champion's own camp?", 'Does the gym take foreigners in winter?']);
    // Markup on the id and a stray pipe inside the finding don't lose the line.
    const odd = parseDossier('**K7** | detail | Bell | Yangon, Myanmar | - | Rung at dawn | and at dusk | VERIFIED | https://example.org/bell | 2026-01-02');
    expect(odd.lines[0]).toMatchObject({ id: 'K7', text: 'Rung at dawn / and at dusk', status: 'verified', url: 'https://example.org/bell', date: '2026-01-02' });
  });

  it('keeps only pages the tools returned, never links inside a page or the model’s own URLs', () => {
    const seen = seenUrls();
    expect(seen.has('https://never-seen.example.com/page')).toBe(false);
    expect(seen.has('https://made-up.example.net/')).toBe(false);
    expect(seen.get('https://mjolnir.is/stundaskra')).toMatchObject({ opened: true, title: 'Stundaskrá' });
    expect(seen.get('https://mjolnir.is/thjalfarar')).toMatchObject({ opened: false });
    const ledger = ledgerFixture();
    expect(ledger.notes.some((n) => n.name === 'Ghost')).toBe(false);
    expect(ledger.sources.some((s) => s.url.includes('never-seen'))).toBe(false);
  });

  it('merges Theinbyu, Theinphyu and Thein Pyu into one place, and folds the mirror to Wikipedia', () => {
    expect(samePlace('Theinbyu Stadium', 'Theinphyu Stadium')).toBe(true);
    expect(samePlace('Thein Pyu Stadium', 'Theinphyu Stadium')).toBe(true);
    expect(samePlace('Hall 1', 'Hall 2')).toBe(false);
    const ledger = ledgerFixture();
    const stadiums = ledger.notes.filter((n) => n.kind === 'place' && /stadium/i.test(n.name ?? ''));
    expect(stadiums).toHaveLength(1);
    expect(stadiums[0]).toMatchObject({ name: 'Theinbyu Stadium', status: 'verified' });
    expect(stadiums[0]!.sources).toHaveLength(2);
    expect(ledger.aka['Theinbyu Stadium']).toEqual(expect.arrayContaining(['Theinphyu Stadium', 'Thein Pyu Stadium']));
    expect(ledger.sources.find((s) => s.url.includes('Thein_Phyu'))?.url).toBe('https://en.wikipedia.org/wiki/Thein_Phyu_Stadium');
    // The "checked, no names" line is remembered for the merged place.
    expect(ledger.noNames).toContain(foldName('Theinbyu Stadium'));
  });

  it('merges duplicate notes, strips tracking from cited pages, and downgrades VERIFIED notes older than two years', () => {
    const ledger = ledgerFixture();
    const saya = ledger.notes.filter((n) => n.name === 'Saya Min Thu');
    expect(saya).toHaveLength(1);
    expect(saya[0]!.sources).toHaveLength(2);
    const fee = ledger.notes.find((n) => n.name === 'Thut Ti training fee')!;
    expect(ledger.sources.find((s) => s.n === fee.sources[0])?.url).toBe('https://thuttilethwei.com/prices');
    const old = ledger.notes.find((n) => n.name === "Old champion's gym")!;
    expect(old).toMatchObject({ status: 'stale', year: '2019' });
    expect(ledger.notes.map((n) => n.id)).toEqual(ledger.notes.map((_, i) => `N${i + 1}`));
    expect(ledger.coords[idOf(ledger, 'Thut Ti Lethwei Gym')]).toEqual({ lat: 16.8, lon: 96.15 });
    expect(ledger.text).toMatch(/^S1 \| /);
    expect(ledger.text).toContain('GAPS:');
  });
});

describe('marks', () => {
  const note = (id: string, status: LedgerNote['status'], sources: number[], year: string | null = null): LedgerNote => ({
    id,
    kind: 'detail',
    name: null,
    place: null,
    text: 'x',
    status,
    year,
    sources,
  });
  const notes = [note('N1', 'verified', [1]), note('N2', 'reported', [2, 3]), note('N3', 'stale', [4], '2021'), note('N4', 'closed', [5])];

  it('takes the weakest status of the notes a line rests on, with the stale year and every source', () => {
    expect(markOf(['N1'], notes)).toEqual({ status: 'verified', year: null, sources: [1] });
    expect(markOf(['N1', 'N2'], notes)).toEqual({ status: 'reported', year: null, sources: [1, 2, 3] });
    expect(markOf(['N1', 'N3'], notes)).toEqual({ status: 'stale', year: '2021', sources: [1, 4] });
    expect(markOf(['N3', 'N4'], notes)?.status).toBe('closed');
    expect(markOf(['N9'], notes)).toBeNull();
    expect(markOf([], notes)).toBeNull();
  });

  it('marks every step, keeper and line of a drawn road, and renumbers the sources it cites', () => {
    const ledger = ledgerFixture();
    const road = toRoad(draftFixture(ledger), ledger, TODAY);
    const door = road.waypoints[0]!;
    expect(door.steps[0]!.mark?.status).toBe('verified');
    expect(road.waypoints[1]!.person?.mark?.status).toBe('reported'); // stale + reported notes merged: the surest reading
    expect(road.waypoints[1]!.steps.find((s) => s.kind === 'cost')!.mark?.status).toBe('reported');
    expect(road.provisions.body[0]).toEqual({ text: 'Learn to fall before you learn to strike.', mark: null, counsel: true });
    // Sources: only the cited ones, numbered 1…n, and every mark points inside them.
    expect(road.sources.map((s) => s.n)).toEqual(road.sources.map((_, i) => i + 1));
    const all = [road.thisWeek.mark, ...road.waypoints.flatMap((w) => [w.person?.mark ?? null, ...w.steps.map((s) => s.mark)])];
    for (const m of all) for (const n of m?.sources ?? []) expect(n).toBeLessThanOrEqual(road.sources.length);
    expect(road.sources.some((s) => s.url.includes('gov.uk'))).toBe(false); // advice note cited by nothing shown
  });

  it('keeps coordinates only where a verified note gave them', () => {
    const ledger = ledgerFixture();
    const road = toRoad(draftFixture(ledger), ledger, TODAY);
    expect(road.waypoints[1]!.where).toMatchObject({ lat: 16.8, lon: 96.15, precision: 'ledger' });
    expect(road.waypoints[0]!.where).toMatchObject({ lat: null, lon: null, precision: null });
    const draft = draftFixture(ledger);
    draft.map[3]!.where.lat = 21.97; // invented, no note gave it
    draft.map[3]!.where.lon = 96.08;
    expect(toRoad(draft, ledger, TODAY).waypoints[3]!.where.precision).toBeNull();
    draft.map[3]!.where = { place: 'The open Atlantic', town: null, country: 'Atlantic Ocean', geoQuery: 'Atlantic Ocean', lat: 38, lon: -30 };
    expect(toRoad(draft, ledger, TODAY).waypoints[3]!.where).toMatchObject({ lat: 38, lon: -30, precision: 'sea' });
  });
});

describe('the checks', () => {
  it('pass a sound draft without a hard or safety fault', () => {
    const ledger = ledgerFixture();
    const r = checkDraft(draftFixture(ledger), context(ledger));
    expect(r.hard).toEqual([]);
    expect(r.safety).toEqual([]);
    expect(r.draft.map.every((w) => w.road.length >= 2)).toBe(true);
  });

  it('never change the draft they are given', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[0]!.road.push({ kind: 'do', text: 'You should probably go.', noteIds: [] });
    const before = JSON.stringify(draft);
    checkDraft(draft, context(ledger));
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('catch banned generic phrases in shown fields (H1)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.calling = 'Embark on a journey to Yangon, find Saya Min Thu, and do not leave until he wraps your hands himself.';
    draft.map[2]!.clue = 'A breathtaking crowd in a bustling stadium.';
    draft.title = 'Unlock Your Potential';
    const r = checkDraft(draft, context(ledger));
    const h1 = r.hard.filter((f) => f.code === 'H1').map((f) => f.at);
    expect(h1).toEqual(expect.arrayContaining(['calling', 'waypoint 3 clue', 'title']));
    // The log carries only where, never the words.
    for (const f of r.hard) expect(f.at).not.toMatch(/journey|breathtaking/i);
  });

  it('drop steps and lines that hedge, placehold or talk like an advert (S4)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    const visa = idOf(ledger, 'Myanmar eVisa');
    draft.map[1]!.road.push({ kind: 'gate', text: 'You may probably need a visa, so confirm it.', noteIds: [visa] });
    draft.map[1]!.road.push({ kind: 'do', text: 'Find a gym near you.', noteIds: [visa] });
    draft.provisions.papers.push({ text: 'Reportedly the eVisa is easy.', noteIds: [visa], counsel: false });
    draft.provisions.coin.push({ text: 'A vibrant market for your gloves.', noteIds: [visa], counsel: false });
    const r = checkDraft(draft, context(ledger));
    const texts = [...r.draft.map[1]!.road.map((s) => s.text), ...r.draft.provisions.papers.map((l) => l.text), ...r.draft.provisions.coin.map((l) => l.text)];
    expect(texts.join(' ')).not.toMatch(/probably|near you|reportedly|vibrant/i);
    expect(r.soft.filter((s) => s.startsWith('S4'))).toHaveLength(4);
  });

  it('read the same word lists the prompt names', () => {
    for (const h of HEDGES) expect(BANNED).toContain(h);
    expect(findPhrase('It might rain.', BANNED)).toBe('might');
    expect(findPhrase('The mighty river.', BANNED)).toBeNull();
    expect(findPhrase('Your journey begins.', BANNED)).toBe('journey');
    // A ledger name that holds a banned word is not the stone speaking.
    expect(findPhrase('Winter at Rothera Research Station.', BANNED, ['Rothera Research Station'])).toBeNull();
  });

  it('drop steps whose numbers no cited note holds, and lines citing nothing (S5, S2)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    const fee = idOf(ledger, 'Thut Ti training fee');
    draft.map[1]!.road.push({ kind: 'cost', text: 'Training costs 450 USD a month.', noteIds: [fee] });
    draft.map[1]!.road.push({ kind: 'cost', text: 'Three months cost 900 USD.', noteIds: [fee] }); // 3 × 300
    draft.map[0]!.road.push({ kind: 'do', text: 'Pack your gloves.', noteIds: [] });
    const r = checkDraft(draft, context(ledger));
    const texts = r.draft.map.flatMap((w) => w.road.map((s) => s.text));
    expect(texts).not.toContain('Training costs 450 USD a month.');
    expect(texts).toContain('Three months cost 900 USD.');
    expect(texts).not.toContain('Pack your gloves.');
    expect(r.soft.some((s) => s.startsWith('S5'))).toBe(true);
    expect(r.soft.some((s) => s.startsWith('S2'))).toBe(true);
  });

  it('cut a site the tools never returned (S6) and remove unknown note ids (S1)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[0]!.road[1]!.text = 'Write to the gym first. Book at fakegym.example.com today.';
    draft.map[0]!.road[1]!.noteIds.push('N99');
    const r = checkDraft(draft, context(ledger));
    expect(r.draft.map[0]!.road[1]!.text).toBe('Write to the gym first.');
    expect(r.draft.map[0]!.road[1]!.noteIds).not.toContain('N99');
    expect(r.soft).toEqual(expect.arrayContaining([expect.stringMatching(/^S6/), expect.stringMatching(/^S1/)]));
  });

  it('hold the calling to its shape: a ledger name, a map place and a stubborn condition (H3)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.calling = 'Train hard every day and the belt will come to you.';
    const r = checkDraft(draft, context(ledger));
    expect(r.hard.filter((f) => f.code === 'H3')).toHaveLength(3);
  });

  it('name people: no role where the ledger holds a name, no invented or doubled names (H4, H5, H6)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[0]!.person = { name: null, role: 'the striking coach', verb: 'put you on the team', noteId: null };
    draft.map[1]!.person!.name = 'Saya Min Thu or Ko Zaw Lin';
    draft.map[2]!.person!.name = 'Jón Made-Up';
    const r = checkDraft(draft, context(ledger));
    expect(codes(r.hard)).toEqual(expect.arrayContaining(['H4', 'H5', 'H6']));
    expect(r.hard.filter((f) => f.code === 'H5')).toHaveLength(2);
  });

  it('keep mysteries off the first waypoint and away from templates (H7)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[0]!.mystery = 'What lies ahead is yours to discover.';
    const r = checkDraft(draft, context(ledger));
    expect(r.hard.filter((f) => f.code === 'H7').map((f) => f.at)).toEqual(expect.arrayContaining(['waypoint 1 mystery']));
  });

  it('flag two waypoints at one venue spelled two ways (H11), a summit that earns nothing (H12) and a clue about tickets (H14)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[3]!.where = { place: 'Theinphyu Stadium', town: 'Yangon', country: 'Myanmar', geoQuery: 'Theinphyu Stadium', lat: null, lon: null };
    draft.map[3]!.earns = null;
    draft.map[2]!.clue = 'Buy a ticket at the gate.';
    const r = checkDraft(draft, context(ledger));
    expect(codes(r.hard)).toEqual(expect.arrayContaining(['H11', 'H12', 'H14']));
  });

  it('ask a road abroad for coin and papers (H15) and a first door within two weeks (H12)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.provisions.coin = [];
    draft.map[0]!.at = '2027-01-20';
    draft.map[0]!.when = 'in January';
    const r = checkDraft(draft, context(ledger));
    expect(r.hard.map((f) => `${f.code} ${f.at}`)).toEqual(expect.arrayContaining(['H15 coin', 'H12 waypoint 1']));
  });

  it('count waypoints and steps (H17) and hold lengths (H9)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[3]!.road = [draft.map[3]!.road[0]!];
    draft.map[1]!.trial = Array.from({ length: 50 }, () => 'walk').join(' ');
    const r = checkDraft(draft, context(ledger));
    expect(r.hard.map((f) => `${f.code} ${f.at}`)).toEqual(expect.arrayContaining(['H17 waypoint 4 steps', 'H9 waypoint 2 trial']));
  });

  it('allow one obvious answer only with a hard edge (H16)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.forge.versusObvious[1] = { position: 1, matches: 'travel to Thailand', edge: null };
    const r = checkDraft(draft, context(ledger));
    expect(codes(r.hard).filter((c) => c === 'H16')).toHaveLength(2);
  });

  it('fix small things in place: one legend clue, exclamation marks, emoji (S10, S14)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[1]!.lore = true;
    draft.map[2]!.lore = true;
    draft.calling = `${draft.calling.replace(/\.$/, '')}! 🥊`;
    const r = checkDraft(draft, context(ledger));
    expect(r.draft.map.filter((w) => w.lore)).toHaveLength(1);
    expect(r.draft.calling).not.toMatch(/[!🥊]/u);
    expect(r.soft).toEqual(expect.arrayContaining(['S14 tidy', 'S10 waypoint 3']));
  });
});

describe('the safety checks', () => {
  it('a dangerous road needs a test before the summit and a survival rule (X2)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[2]!.kind = 'crucible';
    draft.rule = null;
    const r = checkDraft(draft, context(ledger));
    expect(r.safety.map((f) => `${f.code} ${f.at}`)).toEqual(['X2 map', 'X2 rule']);
  });

  it('a lethal feat climbs a ladder of years (X1)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.span = { amount: 8, unit: 'months' };
    draft.map[1]!.at = '2026-12';
    const r = checkDraft(draft, context(ledger, { weighing: { tags: ['dangerous', 'lethal'], binds: [] } }));
    expect(r.safety.map((f) => `${f.code} ${f.at}`)).toEqual(['X1 span']);
  });

  it('no waypoint inside a region the home government advises against (X3)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[3]!.where = { place: 'Hpa-an fight ring', town: 'Hpa-an', country: 'Myanmar', geoQuery: 'Hpa-an, Kayin State, Myanmar', lat: null, lon: null };
    const r = checkDraft(draft, context(ledger));
    expect(codes(r.safety)).toEqual(['X3']);
  });

  it('a Lorer of 13 to 17 meets no adult bout and no solo road abroad (X4)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[1]!.road[2]!.text = 'Fly to Yangon alone and sleep near the gym.';
    const r = checkDraft(draft, context(ledger, { weighing: { tags: ['open', 'dangerous', 'youth'], binds: [] } }));
    expect(r.safety.map((f) => `${f.code} ${f.at}`)).toEqual(expect.arrayContaining(['X4 waypoint 3', 'X4 waypoint 2 step 3']));
    // A licensed youth bout is a fair test.
    const ok = draftFixture(ledger);
    ok.map[2]!.trial = 'Fight one licensed youth bout before the federation doctor, with your parent in the corner.';
    const r2 = checkDraft(ok, context(ledger, { weighing: { tags: ['open', 'dangerous', 'youth'], binds: [] } }));
    expect(codes(r2.safety)).toEqual([]);
  });

  it('an inward wish never reaches for the other person (X5)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[0]!.trial = 'Train until Ari Jónsson lets you spar, then show Sunna what you became.';
    const r = checkDraft(draft, context(ledger, { weighing: { tags: ['inward'], binds: [] }, wishText: 'I wish Sunna would love me again.' }));
    expect(codes(r.safety)).toContain('X5');
  });

  it('a person is asked once, never pestered or camped beside (X6)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    draft.map[2]!.road[1]!.text = 'Ask Ko Zaw Lin every week until he says yes.';
    const r = checkDraft(draft, context(ledger));
    expect(codes(r.safety)).toContain('X6');
  });

  it('reads a zone by its whole name in its own country, and leaves a whole country to the gate (X3)', () => {
    let ledger = adviceLedger();
    const quiet = (edit: (d: QuestDraftT) => void) => {
      const draft = draftFixture(ledger);
      edit(draft);
      return codes(checkDraft(draft, context(ledger)).safety);
    };
    // "Sagaing Region" is not "Yangon Region"; "Shan State" is not "Kayin State" or "Mandalay Region".
    expect(
      quiet((d) => {
        d.map[1]!.where.geoQuery = 'Thut Ti Lethwei Gym, Yangon, Yangon Region, Myanmar';
        d.map[3]!.where = { place: 'Mandalay Lethwei Ring', town: 'Mandalay', country: 'Myanmar', geoQuery: 'Mandalay Lethwei Ring, Mandalay, Mandalay Region, Myanmar', lat: null, lon: null };
      }),
    ).toEqual([]);
    // "Southern Thailand" is not all of Thailand, nor is a Thailand line that names three provinces.
    expect(
      quiet((d) => {
        d.map[2]!.where = { place: 'Lumpinee Stadium', town: 'Bangkok', country: 'Thailand', geoQuery: 'Lumpinee Stadium, Bangkok, Thailand', lat: null, lon: null };
      }),
    ).toEqual([]);
    // "North Korea" is not "South Korea".
    expect(
      quiet((d) => {
        d.map[3]!.where = { place: 'Jangchung Arena', town: 'Seoul', country: 'South Korea', geoQuery: 'Jangchung Arena, Seoul, South Korea', lat: null, lon: null };
      }),
    ).toEqual([]);
    // Inside a zone, by its whole name or the name without "State", it still fires.
    expect(
      quiet((d) => {
        d.map[3]!.where = { place: 'Taunggyi fight ring', town: 'Taunggyi', country: 'Myanmar', geoQuery: 'Taunggyi, Shan State, Myanmar', lat: null, lon: null };
      }),
    ).toEqual(['X3']);
    expect(
      quiet((d) => {
        d.map[3]!.where = { place: 'Hpa-an fight ring', town: 'Hpa-an', country: 'Myanmar', geoQuery: 'Hpa-an, Kayin, Myanmar', lat: null, lon: null };
      }),
    ).toEqual(['X3']);
    // A whole country under the advice holds only the map's one gate and what comes after it.
    const pyongyang = { place: 'Taekwondo Hall', town: 'Pyongyang', country: 'North Korea', geoQuery: 'Taekwondo Hall, Pyongyang, North Korea', lat: null, lon: null };
    expect(quiet((d) => void (d.map[3]!.where = pyongyang))).toEqual(['X3']);
    expect(
      quiet((d) => {
        d.map[1]!.kind = 'gate';
        d.map[3]!.where = pyongyang;
      }),
    ).toEqual([]);
    ledger = adviceLedger(ADVICE_MYANMAR);
    expect(quiet(() => {})).toEqual(['X3', 'X3', 'X3']);
    expect(quiet((d) => void (d.map[1]!.kind = 'gate'))).toEqual([]);
    // With the gate last, the gym and the stadium stand in Myanmar before it.
    expect(quiet((d) => void (d.map[3]!.kind = 'gate'))).toEqual(['X3', 'X3']);
  });

  it('an inward wish reaches for its person, never for the first word of a sentence, a holiday, or a place or country on the road (X5)', () => {
    const ledger = ledgerFixture();
    const inward = (wishText: string) => context(ledger, { weighing: { tags: ['inward'], binds: [] }, wishText });
    const wish = 'I lost Sunna on Christmas Eve. The ring in Yangon is all I have now, and Myanmar is where I go.';
    // The draft says "the" everywhere and "every bout": neither is Sunna.
    expect(codes(checkDraft(draftFixture(ledger), inward(wish)).safety)).toEqual([]);
    const reach = draftFixture(ledger);
    reach.map[0]!.trial = 'Train until Ari Jónsson lets you spar, then show Sunna what you became.';
    expect(codes(checkDraft(reach, inward(wish)).safety)).toEqual(['X5']);
    // Eve the person is still Eve, by her whole name.
    reach.map[0]!.trial = 'Train until Ari Jónsson lets you spar, then show Eve what you became.';
    expect(codes(checkDraft(reach, inward('I wish Eve would come back to me.')).safety)).toEqual(['X5']);
    expect(codes(checkDraft(draftFixture(ledger), inward('I wish Eve would come back to me.')).safety)).toEqual([]);
    // A name that only opens a sentence of the wish is still the person when the road names it mid-sentence.
    reach.map[0]!.trial = 'Train until Ari Jónsson lets you spar, then show Sunna what you became.';
    expect(codes(checkDraft(reach, inward('I cannot stop missing her. Sunna was my whole world.')).safety)).toEqual(['X5']);
    expect(codes(checkDraft(reach, inward('I wish Mr. Sunna would forgive me.')).safety)).toEqual(['X5']);
    // A month is the person only where it is no date: "June", never "in June".
    const june = draftFixture(ledger);
    june.map[1]!.road[2]!.text = 'Fly to Yangon in June and sleep near the gym.';
    expect(codes(checkDraft(june, inward('I wish June would love me again.')).safety)).toEqual([]);
    june.map[0]!.trial = 'Train until Ari Jónsson lets you spar, then show June what you became.';
    expect(codes(checkDraft(june, inward('I wish June would love me again.')).safety)).toEqual(['X5']);
  });

  it('a keeper who trains for a living is trained under and sparred with every day; a camp near a stadium is no camp beside a person (X6)', () => {
    const ledger = ledgerFixture();
    const draft = draftFixture(ledger);
    const N = (name: string) => idOf(ledger, name);
    const safe = [
      'Train under Saya Min Thu every day for a month.',
      'Sleep at the fight camp near the stadium; spar with them on Fridays.',
      'Spar every day; ask him for a fight in March.',
      'Visit Ari Jónsson every evening and hold the pads.',
    ];
    draft.map[1]!.road.push({ kind: 'do', text: safe[0]!, noteIds: [N('Saya Min Thu')] });
    draft.map[2]!.road.push({ kind: 'do', text: safe[1]!, noteIds: [N('Theinbyu Stadium')] });
    draft.map[2]!.road.push({ kind: 'do', text: safe[2]!, noteIds: [N('Ko Zaw Lin')] });
    draft.map[0]!.road.push({ kind: 'do', text: safe[3]!, noteIds: [N('Ari Jónsson')] });
    const r = checkDraft(draft, context(ledger));
    // Each line survived the soft fixes, so the checks really read it.
    const kept = r.draft.map.flatMap((w) => w.road.map((s) => s.text));
    for (const s of safe) expect(kept).toContain(s);
    expect(codes(r.safety)).toEqual([]);

    // Asking again and again pesters anyone; coming back again and again or camping beside them
    // pesters anyone who does not train for a living. "Never again" is no pestering.
    const fires = (text: string, at = 2) => {
      const d = draftFixture(ledger);
      d.map[at]!.road[1]!.text = text;
      return codes(checkDraft(d, context(ledger)).safety);
    };
    expect(fires('Write to Ko Zaw Lin again and again until he answers.')).toEqual(['X6']);
    expect(fires('Every week, ask him for a bout.')).toEqual(['X6']);
    expect(fires('Camp beside him until he takes you on.', 3)).toEqual(['X6']);
    expect(fires('Visit him every day until he takes you on.', 3)).toEqual(['X6']);
    expect(fires('Ask Ko Zaw Lin once, never again and again.')).toEqual([]);
    // A letter or a message is asking, of a person or of "them"; a home is no one's trade.
    expect(fires('Send him a message every week until he answers.')).toEqual(['X6']);
    expect(fires('Message them every week until they answer.')).toEqual(['X6']);
    expect(fires('Wait outside his house every night until he agrees.')).toEqual(['X6']);
    expect(fires("Go to Ko Zaw Lin's home every day until he agrees.")).toEqual(['X6']);
    expect(fires('Follow him home after the bouts.')).toEqual(['X6']);
    // A retired coach no longer coaches for a living.
    const retired = buildLedger(
      [ROAD, KEEPERS, 'ROLE: KEEPERS\nK7 | person | U Tin | Mandalay, Myanmar | - | Retired coach who once trained champions | VERIFIED | https://en.wikipedia.org/wiki/Lethwei | 2026-09-30'],
      seenUrls(),
      TODAY,
    );
    const visit = draftFixture(retired);
    visit.map[3]!.road[1]!.text = 'Visit U Tin every day until he takes you on.';
    expect(codes(checkDraft(visit, context(retired)).safety)).toEqual(['X6']);
  });
});

describe('the recompose turn', () => {
  it('names the safety faults the fresh compose must keep clear of, and is counted as a repair', () => {
    const ledger = ledgerFixture();
    const unsafe = draftFixture(ledger);
    unsafe.map[2]!.road[1]!.text = 'Ask Ko Zaw Lin every week until he says yes.';
    const check = (d: QuestDraftT) => checkDraft(d, context(ledger));
    const flow = drawFlow('quest');
    drawFeed(flow, { kind: 'ok', value: unsafe }, check);
    expect(flow.step).toBe('repair');
    drawFeed(flow, { kind: 'ok', value: unsafe }, check);
    expect(flow.step).toBe('recompose');
    const req = drawRequest(flow, 'COMPOSE INPUT')!;
    expect(req).toMatchObject({ stage: 'repair', effort: 'compose' });
    expect(req.turn.startsWith('COMPOSE INPUT\n<faults>')).toBe(true);
    for (const line of faultLines(flow.checked!.safety)) expect(req.turn).toContain(`- ${line}`);
    expect(req.turn).toContain('never again and again');
    // A fresh compose, not a repair: the old draft is not sent back.
    expect(req.turn).not.toContain('<draft>');
    // A clean fresh compose ends the road.
    drawFeed(flow, { kind: 'ok', value: draftFixture(ledger) }, check);
    expect(flow.step).toBe('done');
  });
});

describe('"Ask again" (H18)', () => {
  const earlier = (over: { title?: string; waypoints?: { name: string; place: string }[] }) => [
    { title: 'The Old Road', calling: 'An earlier calling.', keepers: [], waypoints: [{ name: 'Elsewhere', place: 'Elsewhere Hall' }], ...over },
  ];

  it('never redraws an earlier road: not its title, not its places in the same order', () => {
    const ledger = ledgerFixture();
    const places = draftFixture(ledger).map.map((w) => ({ name: w.name, place: w.where.place }));
    expect(codes(checkDraft(draftFixture(ledger), context(ledger, { earlier: earlier({ title: 'the ninth limb' }) })).hard)).toContain('H18');
    expect(codes(checkDraft(draftFixture(ledger), context(ledger, { earlier: earlier({ waypoints: places }) })).hard)).toContain('H18');
    // The same places in another order is another road; so is no earlier road at all.
    expect(codes(checkDraft(draftFixture(ledger), context(ledger, { earlier: earlier({ waypoints: [...places].reverse() }) })).hard)).not.toContain('H18');
    expect(codes(checkDraft(draftFixture(ledger), context(ledger)).hard)).not.toContain('H18');
  });
});

describe('the deeper checks', () => {
  /** A deeper answer on the Yangon gym (abroad from Iceland) that passes its checks. */
  function answerFixture(ledger: Ledger): DeeperDraftT {
    const N = (name: string) => idOf(ledger, name);
    return DeeperWire.parse({
      answer: 'No. Saya Min Thu still coaches fighters at Thut Ti.',
      clue: 'Drums and a reed horn play during the bouts.',
      steps: [
        { kind: 'do', text: 'Fly to Yangon and sleep near the gym.', noteIds: [N('Thut Ti Lethwei Gym')] },
        { kind: 'do', text: 'Ask Saya Min Thu at Thut Ti for a place in training.', noteIds: [N('Saya Min Thu')] },
        { kind: 'cost', text: 'Training costs 300 USD a month.', noteIds: [N('Thut Ti training fee')] },
      ],
      keeper: { name: 'Saya Min Thu', role: 'head trainer', verb: 'train you for the ring', noteId: N('Saya Min Thu') },
      words: 'I came to train, not to watch.',
      unknown: 'Which fighter will hold the pads for you first.',
    });
  }
  const deeperContext = (ledger: Ledger, over: Partial<DeeperCheckContext> = {}): DeeperCheckContext => ({
    ledger,
    seen: seenUrls(),
    todayIso: TODAY,
    tags: ['open'],
    wishText: 'I wish to become the Lethwei champion of the world.',
    question: 'Am I too old?',
    homeCountry: 'IS',
    waypointCountry: 'Myanmar',
    ...over,
  });

  it('passes a sound answer', () => {
    const ledger = ledgerFixture();
    const r = checkDeeper(answerFixture(ledger), deeperContext(ledger));
    expect(r.safety).toEqual([]);
  });

  it('keeps the road’s safety rules: no solo road abroad before 18 (X4), no reaching for the other person (X5), no pestering (X6)', () => {
    const ledger = ledgerFixture();
    const solo = answerFixture(ledger);
    solo.steps[0]!.text = 'Fly to Yangon alone and sleep near the gym.';
    expect(codes(checkDeeper(solo, deeperContext(ledger, { tags: ['open', 'youth'] })).safety)).toEqual(['X4']);
    // At home the same step is no fault.
    expect(codes(checkDeeper(solo, deeperContext(ledger, { tags: ['open', 'youth'], waypointCountry: 'Iceland' })).safety)).toEqual([]);
    const inward = answerFixture(ledger);
    inward.words = 'Tell Sunna you trained here.';
    expect(codes(checkDeeper(inward, deeperContext(ledger, { tags: ['inward'], wishText: 'I wish Sunna would love me again.' })).safety)).toEqual(['X5']);
    const pester = answerFixture(ledger);
    pester.steps[1]!.text = 'Ask Saya Min Thu at Thut Ti every week until he says yes.';
    const r = checkDeeper(pester, deeperContext(ledger));
    expect(codes(r.safety)).toEqual(['X6']);
    expect(codes(r.hard)).not.toContain('X6');
  });
});

describe('seals', () => {
  const full: FullWaypoint = {
    id: 'w3',
    position: 2,
    kind: 'test',
    emblem: 'fist',
    name: 'The Bare Knuckle Rite',
    when: 'when your trainer says',
    at: null,
    where: { place: 'Theinbyu Stadium', town: 'Yangon', country: 'Myanmar', lat: 16.787, lon: 96.165, precision: 'ledger' },
    clue: 'The crowd roars when a fighter kneels and bows.',
    lore: false,
    mystery: 'Who they will match you with on the night.',
    trial: 'Fight a sanctioned bout.',
    person: { name: 'Ko Zaw Lin', role: 'fighter', verb: 'match you', mark: null },
    earns: 'A fight record',
    steps: [{ kind: 'gate', text: 'Pass the medical.', mark: null }],
    inkedOn: null,
    note: null,
    links: { eventId: null, ideaId: null, chapterId: null, reminderId: null },
  };

  it('opens the first two, the one after an inked waypoint, and a broken seal', () => {
    expect(waypointState(0, false, false, false)).toBe('open');
    expect(waypointState(1, false, false, false)).toBe('open');
    expect(waypointState(2, false, false, false)).toBe('sealed');
    expect(waypointState(2, false, true, false)).toBe('open');
    expect(waypointState(2, false, false, true)).toBe('open');
    expect(waypointState(2, true, false, false)).toBe('inked');
  });

  it('sends a sealed waypoint with no trial, keeper, earns, steps, ink or links', () => {
    const sealed = shapeWaypoint(full, 'sealed');
    expect(sealed.state).toBe('sealed');
    for (const key of ['trial', 'person', 'earns', 'steps', 'inkedOn', 'note', 'links']) expect(sealed).not.toHaveProperty(key);
    expect(JSON.stringify(sealed)).not.toMatch(/Ko Zaw Lin|sanctioned|Pass the medical|fight record/);
    expect(sealed).toMatchObject({ name: full.name, clue: full.clue, mystery: full.mystery, where: { place: 'Theinbyu Stadium' } });
    const open = shapeWaypoint(full, 'open');
    expect(open).toMatchObject({ state: 'open', trial: full.trial, person: full.person, steps: full.steps });
  });
});

describe('draw', () => {
  it('pins each waypoint by the first that answers: ledger, place, town, country, then open water', async () => {
    const asked: string[] = [];
    const geocode = async (q: string) => {
      asked.push(q);
      if (q === 'Thut Ti Lethwei Gym, Yangon, Myanmar') return [{ label: q, lat: 16.81, lon: 96.16 }];
      if (q === 'Mandalay, Myanmar') return [{ label: q, lat: 21.97, lon: 96.08 }];
      if (q === 'Iceland') return [{ label: q, lat: 64.9, lon: -18.6 }];
      if (q === 'boom') throw new Error('geocoder down');
      return [];
    };
    const w = (where: Partial<import('../src/lib/loracle/types.ts').DraftWhere>) => ({
      where: { place: 'x', town: null, country: '', geoQuery: '', lat: null, lon: null, precision: null, ...where },
    });
    const pins = await drawPins(
      [
        w({ lat: 16.8, lon: 96.15, precision: 'ledger', geoQuery: 'never asked' }),
        w({ geoQuery: 'Thut Ti Lethwei Gym, Yangon, Myanmar', town: 'Yangon', country: 'Myanmar' }),
        w({ geoQuery: 'Unknown Ring, Mandalay', town: 'Mandalay', country: 'Myanmar' }),
        w({ geoQuery: 'boom', country: 'Iceland' }),
        w({ geoQuery: 'The open Atlantic', country: 'Atlantic', lat: 38, lon: -30, precision: 'sea' }),
        w({ geoQuery: 'nowhere', country: 'Nowhere' }),
      ],
      geocode,
    );
    expect(pins).toEqual([
      { lat: 16.8, lon: 96.15, precision: 'ledger' },
      { lat: 16.81, lon: 96.16, precision: 'place' },
      { lat: 21.97, lon: 96.08, precision: 'town' },
      { lat: 64.9, lon: -18.6, precision: 'country' },
      { lat: 38, lon: -30, precision: 'sea' },
      null,
    ]);
    expect(asked).not.toContain('never asked');
  });

  it("sets this week's day within seven days, turning a weekday into its date", () => {
    expect(weekDay('2026-11-20', TODAY)).toBe('2026-11-20');
    expect(weekDay('2026-12-20', TODAY)).toBeNull();
    expect(weekDay('2026-11-10', TODAY)).toBeNull();
    expect(weekDay('Friday', TODAY)).toBe('2026-11-20'); // 18 November 2026 is a Wednesday
    expect(weekDay('someday', TODAY)).toBeNull();
    expect(weekDay(null, TODAY)).toBeNull();
  });
});
