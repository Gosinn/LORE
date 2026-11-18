// Looks, worlds and day/night (src/lib/theme.ts, WORLDS spec 3 and 5): unit tests. No DOM: storage is in memory and
// index.html's boot script runs in a sandbox. Run by `npm run test:copy` (part of `npm test`). Kept here, not next to
// theme.ts: every .ts under src is a live-text source, and test names would read as untranslated words.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAYLIGHTS,
  DAY_WORLD,
  DEFAULT_WORLD,
  NIGHT_WORLDS,
  RETIRED_THEMES,
  STORAGE_KEYS,
  THEMES,
  WORLD_BAR,
  WORLD_LABELS,
  applyLook,
  chooseDaylight,
  chooseWorld,
  getLook,
  halfOfDay,
  isSunUp,
  loadDaylight,
  loadSunPoint,
  loadTheme,
  loadWorld,
  nextSunTurn,
  resetLookForTests,
  setSignedIn,
  setSunPoint,
  startLook,
  sunElevation,
  sunTurns,
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
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  resetLookForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLookForTests();
});

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;
const REYKJAVIK = { lat: 64.15, lon: -21.94 };
const TROMSO = { lat: 69.65, lon: 18.96 };
const LONDON = { lat: 51.5, lon: -0.13 };

describe('looks', () => {
  it('offers one look, lore; the Treasure Map and the older looks are retired', () => {
    expect(THEMES).toEqual(['lore']);
    expect(RETIRED_THEMES).toContain('map');
    expect(RETIRED_THEMES).toEqual(expect.arrayContaining(['system', 'light', 'dark', 'crazy']));
  });

  it('wears lore for a stored retired or unknown look, and leaves the stored value alone', () => {
    expect(loadTheme()).toBe('lore');
    for (const old of ['map', 'crazy', 'dark', 'nonsense']) {
      storage.setItem(STORAGE_KEYS.theme, old);
      expect(loadTheme()).toBe('lore');
      expect(storage.getItem(STORAGE_KEYS.theme)).toBe(old);
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
    expect(loadWorld()).toBe(DEFAULT_WORLD);
    expect(loadDaylight()).toBe('phone');
    expect(loadSunPoint()).toBeNull();
    expect(() => chooseWorld('scroll')).not.toThrow();
  });
});

describe('worlds', () => {
  it('has the seven night worlds, the black star sky first and default, and the green hills by day', () => {
    expect(NIGHT_WORLDS).toEqual([
      'black-star-sky',
      'night-map',
      'midnight-vellum',
      'scroll',
      'treasure-map',
      'mountain-range',
      'northern-lights',
    ]);
    expect(DEFAULT_WORLD).toBe('black-star-sky');
    expect(DAY_WORLD).toBe('green-hills');
    for (const w of [...NIGHT_WORLDS, DAY_WORLD]) {
      expect(WORLD_LABELS[w]).toBeTruthy();
      expect(WORLD_BAR[w]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('only a night world can be the stored world', () => {
    storage.setItem(STORAGE_KEYS.world, 'northern-lights');
    expect(loadWorld()).toBe('northern-lights');
    for (const bad of ['green-hills', 'leather', '']) {
      storage.setItem(STORAGE_KEYS.world, bad);
      expect(loadWorld()).toBe(DEFAULT_WORLD);
    }
  });

  it('shows the picked night world by night and the green hills by day', () => {
    chooseWorld('mountain-range');
    chooseDaylight('night');
    expect(getLook()).toMatchObject({ world: 'mountain-range', daylight: 'night', shown: 'mountain-range', half: 'night' });
    chooseDaylight('day');
    expect(getLook()).toMatchObject({ world: 'mountain-range', daylight: 'day', shown: 'green-hills', half: 'day' });
    expect(storage.getItem(STORAGE_KEYS.world)).toBe('mountain-range');
    expect(storage.getItem(STORAGE_KEYS.daylight)).toBe('day');
  });

  it('follows the phone by default (no phone to ask here: night)', () => {
    expect(loadDaylight()).toBe('phone');
    expect(applyLook().half).toBe('night');
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
    expect(DAYLIGHTS).toEqual(['phone', 'sun', 'night', 'day']);
  });

  it('keeps the home point to one decimal, and leaves the answer and the next turns for the boot script', () => {
    chooseDaylight('sun');
    setSunPoint({ lat: 64.14659, lon: -21.94263 });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.sun)!)).toEqual({ lat: 64.1, lon: -21.9 });
    expect(getLook().sunKnown).toBe(true);
    const noon = at('2026-12-21T13:00:00Z');
    expect(applyLook(noon)).toMatchObject({ half: 'day', shown: 'green-hills' });
    const cache = JSON.parse(storage.getItem(STORAGE_KEYS.sunNow)!) as { day: boolean; turns: number[]; until: number };
    expect(cache.day).toBe(true);
    // A week of turns, on whole minutes.
    expect(cache.turns.length).toBe(14);
    expect(cache.turns.every((t) => t % MIN === 0)).toBe(true);
    expect(Math.abs(cache.turns[0]! - at('2026-12-21T15:30:00Z'))).toBeLessThan(5 * MIN);
    expect(cache.until).toBe(cache.turns[13]);
    setSunPoint(null);
    expect(storage.getItem(STORAGE_KEYS.sun)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.sunNow)).toBeNull();
    expect(getLook().sunKnown).toBe(false);
  });

  it('leaves the same cache when asked again a moment later, and does not write it again', () => {
    chooseDaylight('sun');
    setSunPoint(REYKJAVIK);
    const noon = at('2026-12-21T13:00:00Z');
    applyLook(noon);
    const first = storage.getItem(STORAGE_KEYS.sunNow);
    const writes = vi.spyOn(storage, 'setItem');
    for (const later of [1, 1000, 7000, 20_000]) applyLook(noon + later);
    expect(storage.getItem(STORAGE_KEYS.sunNow)).toBe(first);
    expect(writes).not.toHaveBeenCalled();
  });

  it('near the polar night keeps the last half for two more days after the last turn', () => {
    chooseDaylight('sun');
    setSunPoint(TROMSO);
    applyLook(at('2026-11-24T12:00:00Z'));
    const cache = JSON.parse(storage.getItem(STORAGE_KEYS.sunNow)!) as { day: boolean; turns: number[]; until: number };
    expect(cache.turns.length).toBeGreaterThan(0);
    expect(cache.turns.length).toBeLessThan(14);
    expect(cache.until).toBe(cache.turns.at(-1)! + 48 * 3_600_000);
  });
});

// --------------------------------------------------------------- with a page (a stand-in for the DOM)

function stubPage(path = '/') {
  const attrs: Record<string, string> = {};
  const listeners: Record<string, (e: unknown) => void> = {};
  vi.stubGlobal('document', {
    documentElement: {
      getAttribute: (k: string) => attrs[k] ?? null,
      setAttribute: (k: string, v: string) => (attrs[k] = v),
    },
    querySelector: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    visibilityState: 'visible',
  });
  vi.stubGlobal('window', {
    // A phone in light mode.
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    removeEventListener: () => undefined,
  });
  vi.stubGlobal('location', { pathname: path });
  return { attrs, listeners };
}

describe('on a page', () => {
  it('wears the front door until someone is signed in on this device, and again after signing out', () => {
    const { attrs } = stubPage('/');
    expect(applyLook()).toMatchObject({ shown: 'black-star-sky', half: 'night' });
    setSignedIn(true);
    expect(storage.getItem(STORAGE_KEYS.signedIn)).toBe('1');
    expect(getLook()).toMatchObject({ shown: 'green-hills', half: 'day' });
    expect(attrs['data-world']).toBe('green-hills');
    setSignedIn(false);
    expect(storage.getItem(STORAGE_KEYS.signedIn)).toBeNull();
    expect(attrs['data-world']).toBe('black-star-sky');
  });

  it("does not answer another tab's sun cache (two tabs would answer each other forever), but does its choices", () => {
    const { listeners } = stubPage('/');
    setSignedIn(true);
    chooseDaylight('sun');
    setSunPoint(REYKJAVIK);
    const stop = startLook();
    const reads = vi.spyOn(storage, 'getItem');
    listeners.storage!({ key: STORAGE_KEYS.sunNow });
    expect(reads).not.toHaveBeenCalled();
    listeners.storage!({ key: STORAGE_KEYS.world });
    expect(reads).toHaveBeenCalled();
    stop();
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
  if (opts.signedIn !== false) store.setItem(STORAGE_KEYS.signedIn, '1');
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

describe('index.html boot script', () => {
  it('starts on the default world by night, with the dark base in the static markup', () => {
    expect(html).toContain('data-theme="lore"');
    expect(html).toContain('data-world="black-star-sky"');
    expect(html).toContain('<meta name="theme-color" content="#030409" />');
    expect(html).toContain('<div class="world" aria-hidden="true"></div>');
    // The server rewrites this exact tag for the Android live update (routes/appUpdates.ts).
    expect(html).toContain('<meta name="lore-api-base" content="" />');
  });

  it('holds the same world table and storage keys as lib/theme.ts', () => {
    const table = /var BAR = (\{[\s\S]*?\});/.exec(boot)![1]!;
    const bar = runInNewContext(`(${table})`) as Record<string, string>;
    expect(bar).toEqual(WORLD_BAR);
    for (const key of [STORAGE_KEYS.world, STORAGE_KEYS.daylight, STORAGE_KEYS.sunNow, STORAGE_KEYS.signedIn]) {
      expect(boot).toContain(`'${key}'`);
    }
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
    for (const w of [...NIGHT_WORLDS, DAY_WORLD]) {
      const painted = block(worlds, `[data-world='${w}'] {`);
      // The default world's tokens are lore.css's plain :root[data-theme='lore'] block.
      const kit = w === DEFAULT_WORLD ? block(lore, ":root[data-theme='lore'] {") : block(lore, `:root[data-theme='lore'][data-world='${w}']`);
      expect(token(painted, '--world-bg'), w).toBeTruthy();
      expect(token(kit, '--world-bg'), w).toBe(token(painted, '--world-bg'));
      expect(token(kit, '--world-top'), w).toBe(WORLD_BAR[w]);
      expect(kit, w).toMatch(/--slab:\s*rgb\(/);
    }
  });

  it('wears the stored world and follows the phone', () => {
    const store = { [STORAGE_KEYS.world]: 'northern-lights' };
    expect(runBoot({ store, dark: true })).toEqual({ world: 'northern-lights', half: 'night', bar: '#03060e' });
    expect(runBoot({ store, dark: false })).toEqual({ world: 'green-hills', half: 'day', bar: '#1a3a6e' });
    expect(runBoot({ store: { ...store, [STORAGE_KEYS.daylight]: 'night' }, dark: false }).world).toBe('northern-lights');
    expect(runBoot({ store: { ...store, [STORAGE_KEYS.daylight]: 'day' }, dark: true }).world).toBe('green-hills');
    expect(runBoot({ store: { [STORAGE_KEYS.world]: 'green-hills' }, dark: true }).world).toBe('black-star-sky');
    // An unknown "when" follows the phone, as theme.ts does; so does "sun" with no answer kept.
    expect(runBoot({ store: { ...store, [STORAGE_KEYS.daylight]: 'xyz' }, dark: false }).half).toBe('day');
    expect(runBoot({ store: { ...store, [STORAGE_KEYS.daylight]: 'sun' }, dark: false }).half).toBe('day');
    expect(runBoot({ store: { ...store, [STORAGE_KEYS.sunNow]: '{broken' }, dark: true }).world).toBe('northern-lights');
  });

  it('pins Welcome and "Where do you stand?" to the default world by night', () => {
    const store = { [STORAGE_KEYS.world]: 'scroll', [STORAGE_KEYS.daylight]: 'day' };
    expect(runBoot({ store, path: '/welcome' })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
    expect(runBoot({ store, path: '/welcome/where' }).world).toBe('black-star-sky');
    expect(runBoot({ store, path: '/welcomes' }).world).toBe('green-hills');
  });

  it('wears the front door on any start with no one signed in on this device (a new install opens on /)', () => {
    expect(runBoot({ path: '/', dark: false, signedIn: false })).toEqual({ world: 'black-star-sky', half: 'night', bar: '#030409' });
    const store = { [STORAGE_KEYS.world]: 'scroll', [STORAGE_KEYS.daylight]: 'day' };
    expect(runBoot({ store, path: '/', signedIn: false }).world).toBe('black-star-sky');
    expect(runBoot({ path: '/', dark: false })).toEqual({ world: 'green-hills', half: 'day', bar: '#1a3a6e' });
  });

  it('reads the sun from the cache theme.ts left, counting the turns since, and falls back to the phone', () => {
    chooseDaylight('sun');
    setSunPoint(REYKJAVIK);
    const noon = at('2026-12-21T13:00:00Z');
    applyLook(noon);
    const store = Object.fromEntries(storage.map);
    expect(runBoot({ store, now: noon, dark: true }).half).toBe('day');
    // After the sunset (15:30): night, without theme.ts having run again.
    expect(runBoot({ store, now: at('2026-12-21T18:00:00Z'), dark: false }).half).toBe('night');
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
    chooseDaylight('sun');
    setSunPoint(TROMSO);
    applyLook(at('2026-11-24T12:00:00Z'));
    const store = Object.fromEntries(storage.map);
    const last = (JSON.parse(store[STORAGE_KEYS.sunNow]!) as { turns: number[] }).turns.at(-1)!;
    // The last sunset before the polar night: a light phone still gets night a day later...
    expect(runBoot({ store, now: last + 24 * 3_600_000, dark: false }).half).toBe('night');
    // ...and the phone decides once the cache has run out.
    expect(runBoot({ store, now: last + 49 * 3_600_000, dark: false }).half).toBe('day');
  });
});
