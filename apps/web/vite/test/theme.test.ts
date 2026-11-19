// Looks, worlds, Auto and day/night (src/lib/theme.ts, DECISIONS D34 and its note of 2026-11-19): unit tests. No
// DOM: storage is in memory and index.html's boot script runs in a sandbox. Run by `npm run test:copy` (part of
// `npm test`). Kept here, not next to theme.ts: every .ts under src is a live-text source, and test names would read
// as untranslated words.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_WORLDS,
  DEFAULT_DAY_WORLD,
  DEFAULT_WORLD,
  DRIVERS,
  DRIVER_LABELS,
  LIGHT_WORLDS,
  RETIRED_THEMES,
  STORAGE_KEYS,
  THEMES,
  WORLDS,
  applyLook,
  chooseAuto,
  chooseDayWorld,
  chooseDriver,
  chooseNightWorld,
  chooseWorld,
  getLook,
  halfOfDay,
  isDarkColour,
  isDarkTheme,
  isSunUp,
  loadChoices,
  loadSunPoint,
  loadTheme,
  nextSunTurn,
  resetLookForTests,
  setSignedIn,
  setSunPoint,
  startLook,
  sunElevation,
  sunTurns,
  worldOf,
  type WorldId,
} from '../../src/lib/theme.ts';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let storage: MemoryStorage;
function freshStorage(entries: Record<string, string> = {}) {
  storage = new MemoryStorage();
  for (const [k, v] of Object.entries(entries)) storage.setItem(k, v);
  vi.stubGlobal('localStorage', storage);
  resetLookForTests();
}
beforeEach(() => freshStorage());
afterEach(() => {
  vi.unstubAllGlobals();
  resetLookForTests();
});

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;
const REYKJAVIK = { lat: 64.15, lon: -21.94 };
const TROMSO = { lat: 69.65, lon: 18.96 };
const LONDON = { lat: 51.5, lon: -0.13 };
const K = STORAGE_KEYS;
const DEFAULTS = { auto: false, world: 'black-star-sky', night: 'black-star-sky', day: 'green-hills', driver: 'phone' };

/** Auto on, following the sun. */
function followTheSun() {
  chooseAuto(true);
  chooseDriver('sun');
}

describe('looks', () => {
  it('offers one look, lore; the Treasure Map and the older looks are retired', () => {
    expect(THEMES).toEqual(['lore']);
    expect(RETIRED_THEMES).toContain('map');
    expect(RETIRED_THEMES).toEqual(expect.arrayContaining(['system', 'light', 'dark', 'crazy']));
  });

  it('wears lore for a stored retired or unknown look, and leaves the stored value alone', () => {
    expect(loadTheme()).toBe('lore');
    for (const old of ['map', 'crazy', 'dark', 'nonsense']) {
      storage.setItem(K.theme, old);
      expect(loadTheme()).toBe('lore');
      expect(storage.getItem(K.theme)).toBe(old);
    }
  });

  it('loads defaults when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    });
    expect(loadTheme()).toBe('lore');
    expect(loadChoices()).toEqual(DEFAULTS);
    expect(loadSunPoint()).toBeNull();
    expect(() => chooseWorld('scroll')).not.toThrow();
    expect(() => chooseAuto(true)).not.toThrow();
  });
});

describe('the list of worlds', () => {
  // Adding a world adds to these lists; nothing here pins how many there are.
  it('lists every world once, dark or light, with a name and a bar colour', () => {
    const ids = WORLDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of WORLDS) {
      expect(w.label, w.id).toBeTruthy();
      expect(['dark', 'light'], w.id).toContain(w.tone);
      expect(w.bar, w.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(worldOf(w.id)).toBe(w);
    }
    expect(DARK_WORLDS.map((w) => w.id)).toEqual(
      expect.arrayContaining(['black-star-sky', 'night-map', 'midnight-vellum', 'scroll', 'treasure-map', 'mountain-range', 'northern-lights']),
    );
    expect(LIGHT_WORLDS.map((w) => w.id)).toContain('green-hills');
    expect(DARK_WORLDS.every((w) => w.tone === 'dark') && LIGHT_WORLDS.every((w) => w.tone === 'light')).toBe(true);
    // Profile shows them in this order: the dark ones, then the light ones.
    expect([...DARK_WORLDS, ...LIGHT_WORLDS].map((w) => w.id).sort()).toEqual([...ids].sort());
    expect(DEFAULT_WORLD).toBe('black-star-sky');
    expect(DEFAULT_DAY_WORLD).toBe('green-hills');
    expect(DRIVERS).toEqual(['phone', 'sun']);
    expect(DRIVER_LABELS).toEqual({ phone: 'Follow my phone', sun: 'Follow the sun where I stand' });
  });

  it('knows which bar colours want light status bar icons', () => {
    expect(isDarkColour('#030409')).toBe(true);
    expect(isDarkColour('#1a3a6e')).toBe(true);
    expect(isDarkColour('#cfe6f5')).toBe(false);
    expect(isDarkColour('#ffffff')).toBe(false);
    expect(isDarkColour('nonsense')).toBe(true);
  });
});

describe('choices', () => {
  it('gives a new Lorer the black star sky with Auto off, whatever the phone says', () => {
    expect(loadChoices()).toEqual(DEFAULTS);
    expect(applyLook()).toMatchObject({ ...DEFAULTS, daylight: 'night', shown: 'black-star-sky', half: 'night' });
    // Nothing chosen is written as a choice (only the first paint's hint).
    expect(storage.getItem(K.auto)).toBeNull();
    expect(storage.getItem(K.world)).toBeNull();
  });

  it('wears the tapped world, dark or light, with one tap and always', () => {
    chooseWorld('green-hills');
    expect(getLook()).toMatchObject({ auto: false, world: 'green-hills', daylight: 'day', shown: 'green-hills', half: 'day' });
    expect(storage.getItem(K.world)).toBe('green-hills');
    expect(storage.getItem(K.auto)).toBe('off');
    chooseWorld('scroll');
    expect(getLook()).toMatchObject({ auto: false, world: 'scroll', daylight: 'night', shown: 'scroll', half: 'night' });
  });

  it('reads unknown or misplaced worlds as the defaults', () => {
    freshStorage({ [K.auto]: 'on', [K.world]: 'leather', [K.nightWorld]: 'green-hills', [K.dayWorld]: 'scroll', [K.daylight]: 'moon' });
    expect(loadChoices()).toEqual({ ...DEFAULTS, auto: true });
    freshStorage({ [K.auto]: 'off', [K.world]: 'northern-lights' });
    expect(loadChoices()).toMatchObject({ auto: false, world: 'northern-lights' });
  });

  it('turns Auto on from the picked world, and off keeping the world on screen', () => {
    chooseWorld('scroll');
    chooseAuto(true);
    // No phone to ask here: night, so the picked dark world stays on screen.
    expect(getLook()).toMatchObject({ auto: true, night: 'scroll', day: 'green-hills', driver: 'phone', daylight: 'phone', shown: 'scroll' });
    chooseNightWorld('northern-lights');
    expect(getLook()).toMatchObject({ night: 'northern-lights', shown: 'northern-lights' });
    chooseAuto(false);
    expect(getLook()).toMatchObject({ auto: false, world: 'northern-lights', shown: 'northern-lights', half: 'night' });
    // A light world picked becomes Auto's day world.
    chooseWorld('green-hills');
    chooseAuto(true);
    expect(getLook()).toMatchObject({ auto: true, night: 'northern-lights', day: 'green-hills' });
    chooseDayWorld('green-hills');
    expect(storage.getItem(K.dayWorld)).toBe('green-hills');
  });
});

/** Each way a choice could be kept before 2026-11-19, and what it becomes. */
const OLD_WAYS: { kept: Record<string, string>; becomes: Partial<typeof DEFAULTS> }[] = [
  { kept: {}, becomes: DEFAULTS },
  { kept: { 'lore.daylight': 'phone' }, becomes: { auto: true, night: 'black-star-sky', day: 'green-hills', driver: 'phone' } },
  { kept: { 'lore.daylight': 'phone', 'lore.world': 'scroll' }, becomes: { auto: true, night: 'scroll', day: 'green-hills', driver: 'phone' } },
  { kept: { 'lore.daylight': 'sun', 'lore.world': 'northern-lights' }, becomes: { auto: true, night: 'northern-lights', driver: 'sun' } },
  { kept: { 'lore.daylight': 'sun' }, becomes: { auto: true, night: 'black-star-sky', driver: 'sun' } },
  { kept: { 'lore.daylight': 'night', 'lore.world': 'mountain-range' }, becomes: { auto: false, world: 'mountain-range' } },
  { kept: { 'lore.daylight': 'night' }, becomes: { auto: false, world: 'black-star-sky' } },
  { kept: { 'lore.daylight': 'day', 'lore.world': 'scroll' }, becomes: { auto: false, world: 'green-hills', night: 'scroll' } },
  { kept: { 'lore.daylight': 'day' }, becomes: { auto: false, world: 'green-hills' } },
  // A night world picked, nothing said about the day: that world (the owner: Auto only when they choose it).
  { kept: { 'lore.world': 'treasure-map' }, becomes: { auto: false, world: 'treasure-map' } },
  { kept: { 'lore.world': 'green-hills' }, becomes: DEFAULTS },
  { kept: { 'lore.world': 'leather', 'lore.daylight': 'xyz' }, becomes: DEFAULTS },
];

describe('choices kept before 2026-11-19', () => {
  it('keeps the old keys and names', () => {
    expect(K.world).toBe('lore.world');
    expect(K.daylight).toBe('lore.daylight');
  });

  it.each(OLD_WAYS)('reads $kept as $becomes, and writes it the new way once', ({ kept, becomes }) => {
    freshStorage(kept);
    expect(loadChoices()).toMatchObject(becomes);
    const before = loadChoices();
    applyLook();
    expect(loadChoices()).toEqual(before);
    if (Object.keys(kept).length) {
      expect(storage.getItem(K.auto)).toBe(before.auto ? 'on' : 'off');
      expect(storage.getItem(K.world)).toBe(before.world);
      expect(storage.getItem(K.nightWorld)).toBe(before.night);
      expect(storage.getItem(K.dayWorld)).toBe(before.day);
      expect(storage.getItem(K.daylight)).toBe(before.driver);
    }
    const writes = vi.spyOn(storage, 'setItem');
    applyLook();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('the sun', () => {
  it('rises and sets in Reykjavík on the winter solstice at the almanac times (to a few minutes)', () => {
    const rise = nextSunTurn(at('2026-12-21T06:00:00Z'), REYKJAVIK.lat, REYKJAVIK.lon)!;
    const set = nextSunTurn(at('2026-12-21T12:00:00Z'), REYKJAVIK.lat, REYKJAVIK.lon)!;
    expect(Math.abs(rise - at('2026-12-21T11:22:00Z'))).toBeLessThan(4 * MIN);
    expect(Math.abs(set - at('2026-12-21T15:30:00Z'))).toBeLessThan(4 * MIN);
    expect(isSunUp(at('2026-12-21T13:00:00Z'), REYKJAVIK.lat, REYKJAVIK.lon)).toBe(true);
    expect(isSunUp(at('2026-12-21T17:00:00Z'), REYKJAVIK.lat, REYKJAVIK.lon)).toBe(false);
  });

  it('sets in London at the equinox around 18:13 UTC, with the sun high at noon', () => {
    expect(sunElevation(at('2026-03-20T12:10:00Z'), LONDON.lat, LONDON.lon)).toBeGreaterThan(37);
    const set = nextSunTurn(at('2026-03-20T12:00:00Z'), LONDON.lat, LONDON.lon)!;
    expect(Math.abs(set - at('2026-03-20T18:13:00Z'))).toBeLessThan(4 * MIN);
  });

  it('knows the midnight sun and the polar night: no turn at all', () => {
    expect(isSunUp(at('2026-06-21T00:00:00Z'), TROMSO.lat, TROMSO.lon)).toBe(true);
    expect(nextSunTurn(at('2026-06-21T00:00:00Z'), TROMSO.lat, TROMSO.lon)).toBeNull();
    expect(isSunUp(at('2026-12-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)).toBe(false);
    expect(nextSunTurn(at('2026-12-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)).toBeNull();
    expect(sunTurns(at('2026-12-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)).toEqual([]);
  });

  it('lists the next turns in order, each flipping day and night', () => {
    const from = at('2026-03-20T12:00:00Z');
    const turns = sunTurns(from, LONDON.lat, LONDON.lon);
    expect(turns).toHaveLength(6);
    let up = isSunUp(from, LONDON.lat, LONDON.lon);
    let prev = from;
    for (const t of turns) {
      expect(t).toBeGreaterThan(prev);
      expect(isSunUp(t + MIN, LONDON.lat, LONDON.lon)).toBe(!up);
      up = !up;
      prev = t;
    }
  });

  it('decides the half of the day for each choice; the sun without a place falls back to the phone', () => {
    const noon = at('2026-12-21T13:00:00Z');
    const evening = at('2026-12-21T20:00:00Z');
    expect(halfOfDay('day', { now: evening, point: null, phoneDark: true })).toBe('day');
    expect(halfOfDay('night', { now: noon, point: null, phoneDark: false })).toBe('night');
    expect(halfOfDay('phone', { now: noon, point: REYKJAVIK, phoneDark: true })).toBe('night');
    expect(halfOfDay('phone', { now: noon, point: REYKJAVIK, phoneDark: false })).toBe('day');
    expect(halfOfDay('sun', { now: noon, point: REYKJAVIK, phoneDark: true })).toBe('day');
    expect(halfOfDay('sun', { now: evening, point: REYKJAVIK, phoneDark: false })).toBe('night');
    expect(halfOfDay('sun', { now: noon, point: null, phoneDark: true })).toBe('night');
  });

  it('with Auto on, wears the day world while the sun is up and the night world after it sets', () => {
    chooseWorld('mountain-range');
    followTheSun();
    setSunPoint(REYKJAVIK);
    expect(applyLook(at('2026-12-21T13:00:00Z'))).toMatchObject({ daylight: 'sun', shown: 'green-hills', half: 'day' });
    expect(applyLook(at('2026-12-21T20:00:00Z'))).toMatchObject({ daylight: 'sun', shown: 'mountain-range', half: 'night' });
    // Auto off: the sun no longer matters.
    chooseAuto(false);
    chooseWorld('scroll');
    expect(applyLook(at('2026-12-21T13:00:00Z'))).toMatchObject({ auto: false, daylight: 'night', half: 'night' });
  });

  it('keeps the home point to one decimal, and leaves the answer and the next turns for the boot script', () => {
    followTheSun();
    setSunPoint({ lat: 64.14659, lon: -21.94263 });
    expect(JSON.parse(storage.getItem(K.sun)!)).toEqual({ lat: 64.1, lon: -21.9 });
    expect(getLook().sunKnown).toBe(true);
    const noon = at('2026-12-21T13:00:00Z');
    expect(applyLook(noon)).toMatchObject({ half: 'day', shown: 'green-hills' });
    const cache = JSON.parse(storage.getItem(K.sunNow)!) as { day: boolean; turns: number[]; until: number };
    expect(cache.day).toBe(true);
    // A week of turns, on whole minutes.
    expect(cache.turns.length).toBe(14);
    expect(cache.turns.every((t) => t % MIN === 0)).toBe(true);
    expect(Math.abs(cache.turns[0]! - at('2026-12-21T15:30:00Z'))).toBeLessThan(5 * MIN);
    expect(cache.until).toBe(cache.turns[13]);
    setSunPoint(null);
    expect(storage.getItem(K.sun)).toBeNull();
    expect(storage.getItem(K.sunNow)).toBeNull();
    expect(getLook().sunKnown).toBe(false);
  });

  it('leaves the same cache when asked again a moment later, and does not write it again', () => {
    followTheSun();
    setSunPoint(REYKJAVIK);
    const noon = at('2026-12-21T13:00:00Z');
    applyLook(noon);
    const first = storage.getItem(K.sunNow);
    const writes = vi.spyOn(storage, 'setItem');
    for (const later of [1, 1000, 7000, 20_000]) applyLook(noon + later);
    expect(storage.getItem(K.sunNow)).toBe(first);
    expect(writes).not.toHaveBeenCalled();
  });

  it('near the polar night keeps the last half for two more days after the last turn', () => {
    followTheSun();
    setSunPoint(TROMSO);
    applyLook(at('2026-11-24T12:00:00Z'));
    const cache = JSON.parse(storage.getItem(K.sunNow)!) as { day: boolean; turns: number[]; until: number };
    expect(cache.turns.length).toBeGreaterThan(0);
    expect(cache.turns.length).toBeLessThan(14);
    expect(cache.until).toBe(cache.turns.at(-1)! + 48 * 3_600_000);
  });
});

// --------------------------------------------------------------- with a page (a stand-in for the DOM)

/** A stand-in page; the phone is in light mode unless `dark`. */
function stubPage(path = '/', dark = false) {
  const attrs: Record<string, string> = { 'data-theme': 'lore' };
  const meta = { content: '', setAttribute: (_k: string, v: string) => (meta.content = v) };
  const listeners: Record<string, (e: unknown) => void> = {};
  vi.stubGlobal('document', {
    documentElement: {
      getAttribute: (k: string) => attrs[k] ?? null,
      setAttribute: (k: string, v: string) => (attrs[k] = v),
    },
    querySelector: () => meta,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    visibilityState: 'visible',
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: dark, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    removeEventListener: () => undefined,
  });
  vi.stubGlobal('location', { pathname: path });
  return { attrs, meta, listeners };
}

describe('on a page', () => {
  it('puts the tone of the world on <html>: a light world is day, a dark one night, whatever the phone says', () => {
    for (const dark of [true, false]) {
      freshStorage({ [K.signedIn]: '1' });
      const { attrs, meta } = stubPage('/', dark);
      chooseWorld('green-hills');
      expect(attrs).toMatchObject({ 'data-world': 'green-hills', 'data-daylight': 'day' });
      expect(meta.content).toBe('#fbf3dc');
      chooseWorld('northern-lights');
      expect(attrs).toMatchObject({ 'data-world': 'northern-lights', 'data-daylight': 'night' });
      expect(meta.content).toBe('#03060e');
    }
  });

  it('with Auto on following the phone: the night world on a dark phone, the day world on a light one', () => {
    freshStorage({ [K.signedIn]: '1' });
    let page = stubPage('/', true);
    chooseAuto(true);
    chooseNightWorld('scroll');
    expect(page.attrs).toMatchObject({ 'data-world': 'scroll', 'data-daylight': 'night' });
    page = stubPage('/', false);
    applyLook();
    expect(page.attrs).toMatchObject({ 'data-world': 'green-hills', 'data-daylight': 'day' });
    expect(getLook()).toMatchObject({ auto: true, daylight: 'phone', shown: 'green-hills', half: 'day' });
  });

  it('wears the front door until someone is signed in on this device, and again after signing out', () => {
    const { attrs } = stubPage('/');
    chooseWorld('green-hills');
    expect(getLook()).toMatchObject({ shown: 'black-star-sky', half: 'night' });
    expect(attrs['data-world']).toBe('black-star-sky');
    setSignedIn(true);
    expect(storage.getItem(K.signedIn)).toBe('1');
    expect(getLook()).toMatchObject({ shown: 'green-hills', half: 'day' });
    expect(attrs).toMatchObject({ 'data-world': 'green-hills', 'data-daylight': 'day' });
    setSignedIn(false);
    expect(storage.getItem(K.signedIn)).toBeNull();
    expect(attrs).toMatchObject({ 'data-world': 'black-star-sky', 'data-daylight': 'night' });
  });

  it("does not answer another tab's sun cache or first-paint hint (two tabs would answer each other forever), but does its choices", () => {
    const { listeners } = stubPage('/');
    setSignedIn(true);
    followTheSun();
    setSunPoint(REYKJAVIK);
    const stop = startLook();
    const reads = vi.spyOn(storage, 'getItem');
    listeners.storage!({ key: K.sunNow });
    listeners.storage!({ key: K.boot });
    expect(reads).not.toHaveBeenCalled();
    listeners.storage!({ key: K.world });
    expect(reads).toHaveBeenCalled();
    stop();
  });

  it("gives the native status bar the icons that suit each world's top edge", () => {
    const { attrs } = stubPage('/');
    for (const w of WORLDS) {
      attrs['data-world'] = w.id;
      expect(isDarkTheme(), w.id).toBe(isDarkColour(w.bar));
    }
  });
});

// ------------------------------------------------------------------------------- index.html boot script

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const boot = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

/** Runs the boot script; the device has someone signed in unless `signedIn: false`. */
function runBoot(opts: { path?: string; store?: Record<string, string>; dark?: boolean; now?: number; signedIn?: boolean }) {
  const attrs: Record<string, string> = {};
  const meta = { content: '', setAttribute: (_k: string, v: string) => (meta.content = v) };
  const store = new MemoryStorage();
  if (opts.signedIn !== false) store.setItem(K.signedIn, '1');
  for (const [k, v] of Object.entries(opts.store ?? {})) store.setItem(k, v);
  const RealDate = Date;
  const now = opts.now ?? RealDate.now();
  const FakeDate = Object.assign(function () {}, { now: () => now }) as unknown as DateConstructor;
  runInNewContext(boot, {
    document: {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
      querySelector: () => meta,
    },
    localStorage: store,
    window: { matchMedia: () => ({ matches: opts.dark ?? true }) },
    location: { pathname: opts.path ?? '/' },
    Date: FakeDate,
    JSON,
    Object,
  });
  return { world: attrs['data-world'], half: attrs['data-daylight'], bar: meta.content };
}

/** What theme.ts puts on a page (signed in, phone dark or light) for the storage as it is. */
function wornByTheme(dark: boolean, now?: number) {
  const { attrs, meta } = stubPage('/', dark);
  resetLookForTests();
  applyLook(now);
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', storage);
  return { world: attrs['data-world'], half: attrs['data-daylight'], bar: meta.content };
}

/** The storage theme.ts leaves after these choices, on a signed-in device. */
function keptAfter(pick: () => void): Record<string, string> {
  freshStorage({ [K.signedIn]: '1' });
  pick();
  applyLook();
  return Object.fromEntries(storage.map);
}

describe('index.html boot script', () => {
  it('starts on the default world by night, with the dark base in the static markup', () => {
    expect(html).toContain('data-theme="lore"');
    expect(html).toContain('data-world="black-star-sky"');
    expect(html).toContain('<meta name="theme-color" content="#030409" />');
    expect(html).toContain('<div class="world" aria-hidden="true"></div>');
    // The server rewrites this exact tag for the Android live update (routes/appUpdates.ts).
    expect(html).toContain('<meta name="lore-api-base" content="" />');
  });

  it("reads theme.ts's keys and needs no list of worlds: only the old one, frozen, for the first start after the update", () => {
    for (const key of [K.boot, K.sunNow, K.signedIn, K.auto, K.world, K.daylight]) expect(boot).toContain(`'${key}'`);
    expect(boot).toContain(`var DEFAULT = ['${DEFAULT_WORLD}', '${worldOf(DEFAULT_WORLD).bar}'];`);
    expect(boot).toContain(`day = ['green-hills', '${worldOf('green-hills').bar}'];`);
    const old = runInNewContext(`(${/var OLD = (\{[\s\S]*?\});/.exec(boot)![1]!})`) as Record<string, string>;
    expect(Object.keys(old)).toEqual(['black-star-sky', 'night-map', 'midnight-vellum', 'scroll', 'treasure-map', 'mountain-range', 'northern-lights']);
    for (const [id, bar] of Object.entries(old)) expect(worldOf(id as WorldId).bar, id).toBe(bar);
    // A world the script has never heard of is worn from the hint alone.
    const store = { [K.boot]: JSON.stringify({ when: 'day', night: ['some-new-world', '#102030'], day: ['some-new-world', '#102030'] }) };
    expect(runBoot({ store, dark: true })).toEqual({ world: 'some-new-world', half: 'day', bar: '#102030' });
  });

  it('agrees with the stylesheets: each world in worlds.css and lore.css, one base colour, the bar = the top edge', () => {
    const css = (f: string) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), 'utf8');
    const worlds = css('worlds.css');
    const lore = css('lore.css');
    const block = (src: string, sel: string) => {
      const i = src.indexOf(sel);
      return i < 0 ? '' : src.slice(i, src.indexOf('}', i));
    };
    const token = (body: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(body)?.[1];
    for (const w of WORLDS) {
      const painted = block(worlds, `[data-world='${w.id}'] {`);
      // The default world's tokens are lore.css's plain :root[data-theme='lore'] block.
      const kit = w.id === DEFAULT_WORLD ? block(lore, ":root[data-theme='lore'] {") : block(lore, `:root[data-theme='lore'][data-world='${w.id}']`);
      expect(token(painted, '--world-bg'), w.id).toBeTruthy();
      expect(painted, w.id).toMatch(/--world-art:/);
      expect(token(kit, '--world-bg'), w.id).toBe(token(painted, '--world-bg'));
      expect(token(kit, '--world-top'), w.id).toBe(w.bar);
      expect(kit, w.id).toMatch(/--slab:\s*rgb\(/);
    }
    // The green hills' block also matches every [data-daylight='day'] with the same specificity, so another light
    // world's own block must come after it, or that world would wear the hills' tokens.
    const dayRule = lore.indexOf(":root[data-theme='lore'][data-daylight='day']");
    expect(dayRule).toBeGreaterThan(0);
    for (const w of LIGHT_WORLDS) {
      if (w.id === 'green-hills') continue;
      expect(lore.indexOf(`:root[data-theme='lore'][data-world='${w.id}']`), `${w.id} must come after the day rule`).toBeGreaterThan(dayRule);
    }
  });

  it('wears exactly what theme.ts wears: every world with Auto off, every pair with Auto on, either phone', () => {
    const ways: { name: string; pick: () => void }[] = [
      ...WORLDS.map((w) => ({ name: `Auto off, ${w.id}`, pick: () => chooseWorld(w.id) })),
      ...DARK_WORLDS.flatMap((n) =>
        LIGHT_WORLDS.map((d) => ({
          name: `Auto on, ${n.id} and ${d.id}`,
          pick: () => {
            chooseAuto(true);
            chooseNightWorld(n.id);
            chooseDayWorld(d.id);
          },
        })),
      ),
    ];
    for (const way of ways) {
      const store = keptAfter(way.pick);
      for (const dark of [true, false]) {
        expect(runBoot({ store, dark }), `${way.name}, ${dark ? 'dark' : 'light'} phone`).toEqual(wornByTheme(dark));
      }
    }
  });

  it.each(OLD_WAYS)('wears what theme.ts makes of $kept on the first start after the update', ({ kept }) => {
    for (const dark of [true, false]) {
      freshStorage({ ...kept, [K.signedIn]: '1' });
      const first = runBoot({ store: Object.fromEntries(storage.map), dark });
      expect(first, `${dark ? 'dark' : 'light'} phone`).toEqual(wornByTheme(dark));
      // And from the hint theme.ts left, the start after.
      expect(runBoot({ store: Object.fromEntries(storage.map), dark })).toEqual(first);
    }
  });

  it('falls back to the default world on a broken or missing hint once theme.ts keeps choices the new way', () => {
    expect(runBoot({ store: { [K.boot]: '{broken', [K.auto]: 'off', [K.world]: 'scroll' } })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
    expect(runBoot({ store: { [K.boot]: JSON.stringify({ when: 'day', night: 'scroll' }), [K.auto]: 'on' } }).world).toBe('black-star-sky');
    expect(runBoot({ store: { [K.boot]: JSON.stringify({ when: 'day', night: 'scroll', day: 'green-hills' }), [K.auto]: 'on' } }).world).toBe('black-star-sky');
    // An unknown `when` is night.
    const store = { [K.boot]: JSON.stringify({ when: 'moon', night: ['scroll', '#2a1708'], day: ['green-hills', '#fbf3dc'] }) };
    expect(runBoot({ store, dark: false })).toEqual({ world: 'scroll', half: 'night', bar: '#2a1708' });
  });

  it('pins Welcome and "Where do you stand?" to the default world by night', () => {
    const store = keptAfter(() => chooseWorld('green-hills'));
    expect(runBoot({ store, path: '/welcome' })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
    expect(runBoot({ store, path: '/welcome/where' }).world).toBe('black-star-sky');
    expect(runBoot({ store, path: '/welcomes' })).toEqual({ world: 'green-hills', half: 'day', bar: '#fbf3dc' });
  });

  it('wears the front door on any start with no one signed in on this device (a new install opens on /)', () => {
    expect(runBoot({ path: '/', dark: false, signedIn: false })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
    const { [K.signedIn]: _signedIn, ...store } = keptAfter(() => chooseWorld('scroll'));
    expect(runBoot({ store, path: '/' }).world).toBe('scroll');
    expect(runBoot({ store, path: '/', signedIn: false }).world).toBe('black-star-sky');
    // Signed in with nothing picked: the default, by night, even on a light phone.
    expect(runBoot({ path: '/', dark: false })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
  });

  it('reads the sun from the cache theme.ts left, counting the turns since, and falls back to the phone', () => {
    freshStorage({ [K.signedIn]: '1' });
    chooseWorld('northern-lights');
    followTheSun();
    setSunPoint(REYKJAVIK);
    const noon = at('2026-12-21T13:00:00Z');
    applyLook(noon);
    const store = Object.fromEntries(storage.map);
    expect(runBoot({ store, now: noon, dark: true })).toEqual({ world: 'green-hills', half: 'day', bar: '#fbf3dc' });
    // After the sunset (15:30): the night world, without theme.ts having run again.
    expect(runBoot({ store, now: at('2026-12-21T18:00:00Z'), dark: false })).toEqual({ world: 'northern-lights', half: 'night', bar: '#03060e' });
    // The next morning, after sunrise.
    expect(runBoot({ store, now: at('2026-12-22T12:30:00Z'), dark: true }).half).toBe('day');
    // Five days later the cache still knows.
    expect(runBoot({ store, now: at('2026-12-26T12:30:00Z'), dark: true }).half).toBe('day');
    expect(runBoot({ store, now: at('2026-12-26T18:00:00Z'), dark: false }).half).toBe('night');
    // After its week the cache has run out: the phone decides.
    expect(runBoot({ store, now: at('2026-12-30T12:00:00Z'), dark: true }).half).toBe('night');
    expect(runBoot({ store, now: at('2026-12-30T12:00:00Z'), dark: false }).half).toBe('day');
  });

  it('near the polar night reads the last half for two days past the last turn', () => {
    freshStorage({ [K.signedIn]: '1' });
    followTheSun();
    setSunPoint(TROMSO);
    applyLook(at('2026-11-24T12:00:00Z'));
    const store = Object.fromEntries(storage.map);
    const last = (JSON.parse(store[K.sunNow]!) as { turns: number[] }).turns.at(-1)!;
    // The last sunset before the polar night: a light phone still gets night a day later...
    expect(runBoot({ store, now: last + 24 * 3_600_000, dark: false }).half).toBe('night');
    // ...and the phone decides once the cache has run out.
    expect(runBoot({ store, now: last + 49 * 3_600_000, dark: false }).half).toBe('day');
  });
});
