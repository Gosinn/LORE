// The Loracle's code-side mind: ledger, checks, marks, draw and seals. No network, no database.
import { describe, expect, it } from 'vitest';
import { checkDraft, findPhrase, type CheckContext } from '../src/lib/loracle/checks.ts';
import { drawPins, shapeWaypoint, toRoad, waypointState, weekDay, type FullWaypoint } from '../src/lib/loracle/draw.ts';
import { SeenUrls, buildLedger, canonicalUrl, foldName, markOf, parseDossier, samePlace, type Ledger } from '../src/lib/loracle/ledger.ts';
import { BANNED, HEDGES } from '../src/lib/loracle/prompts.ts';
import { QuestDraftWire, type QuestDraftT } from '../src/lib/loracle/schema.ts';
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
