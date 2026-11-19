import { useEffect, useSyncExternalStore } from 'react';
import { rollCrazy, startCrazy, stopCrazy } from './crazy.ts';

/**
 * LORE's looks and worlds (docs/DECISIONS.md D34, and its note of 2026-11-19).
 *
 * One look, `lore`: the Loracle's own kit (stone buttons, wells, slabs) everywhere (styles/lore.css). The variety
 * is the world behind it (styles/worlds.css), dark or light, all listed once in WORLDS below. What a Lorer picks in
 * Profile → Your world, on this device:
 *   Auto off (the default)  one world, dark or light, always: the one they tapped (the black star sky until then)
 *   Auto on                 a dark world by night and a light one by day; the phone's light/dark switch or the real
 *                           sun where the Lorer stands says which half of the day it is
 * What <html> carries, and what the CSS reads:
 *   data-theme="lore"                  the look
 *   data-world="<WorldId>"             the world on screen now
 *   data-daylight="night" | "day"      that world's tone: "day" on a light world (the day-mode text rules: ink on a
 *                                      vellum plate), "night" on a dark one
 *   data-cards="vellum"                not set: light vellum cards by day, ready in lore.css, not offered yet
 *                                      (the owner picked stone; DECISIONS Q10)
 * The choices live on the device (localStorage), not on the account (ROADMAP: sync worlds across devices).
 * index.html wears them before the first paint from what applyLook() leaves it (BOOT_KEY), so it never needs to
 * know the worlds itself.
 *
 * The older looks are retired, not deleted (owner, 2026-11-18: "dont delete them, just retire them ... i might
 * change my mind"): their CSS and code stay as they were. To bring one back, move its name from RETIRED_THEMES into
 * THEMES (Profile lists THEMES when there is more than one), and set data-theme from index.html's boot script
 * instead of the fixed "lore", or every start of the returned look flashes the worlds first.
 */
export const THEMES = ['lore'] as const;
export const RETIRED_THEMES = ['map', 'system', 'light', 'dark', 'crazy'] as const;

export type ActiveTheme = (typeof THEMES)[number];
export type RetiredTheme = (typeof RETIRED_THEMES)[number];
export type ThemeChoice = ActiveTheme | RetiredTheme;

export const DEFAULT_THEME: ActiveTheme = 'lore';

export const THEME_LABELS: Record<ThemeChoice, string> = {
  lore: 'LORE',
  map: 'Treasure Map',
  system: 'Match device',
  light: 'Paper',
  dark: 'Campfire',
  crazy: 'Crazy',
};

// ------------------------------------------------------------------------------------------- worlds

export type Tone = 'dark' | 'light';

interface WorldEntry {
  readonly id: string;
  readonly label: string;
  readonly tone: Tone;
  readonly bar: string;
}

/**
 * Every world, in the order Profile shows them (the dark ones under "Dark", the light ones under "Light").
 *   id     its name in the CSS: [data-world='<id>']
 *   label  its name in Profile (live text: the owner can reword it in the app; `label` is a key the live-text
 *          transform reads as words, so it must stay `label`)
 *   tone   'dark' (a night world) or 'light' (a day world: <html data-daylight="day">, the day-mode text rules)
 *   bar    the colour along the art's top edge, worn by the browser bar so it runs straight into the sky; the same
 *          as the world's --world-top in lore.css (AppShell copies that one on every navigation)
 *
 * To add a world: its art in assets/worlds/; a block in styles/worlds.css (--world-bg, --world-art); a block in
 * styles/lore.css (--world-bg, --world-top = bar, --slab; a light one after the green hills' block, which also
 * holds every [data-daylight='day']); and one line here. Nothing else lists the worlds (index.html reads
 * BOOT_KEY); vite/test/theme.test.ts checks the stylesheets against this list.
 */
export const WORLDS = [
  { id: 'black-star-sky', label: 'Black star sky', tone: 'dark', bar: '#030409' },
  { id: 'night-map', label: 'Night map', tone: 'dark', bar: '#241b14' },
  { id: 'midnight-vellum', label: 'Midnight vellum', tone: 'dark', bar: '#1f1a2c' },
  { id: 'scroll', label: 'Scroll', tone: 'dark', bar: '#2a1708' },
  { id: 'treasure-map', label: 'Treasure map', tone: 'dark', bar: '#14201e' },
  { id: 'mountain-range', label: 'Mountain range', tone: 'dark', bar: '#060a18' },
  { id: 'northern-lights', label: 'Northern lights', tone: 'dark', bar: '#03060e' },
  { id: 'green-hills', label: 'The green hills', tone: 'light', bar: '#fbf3dc' },
  { id: 'sea-chart', label: 'Sea chart by day', tone: 'light', bar: '#cfdcd3' },
  { id: 'dawn-peaks', label: 'Peaks at dawn', tone: 'light', bar: '#a9c4e2' },
  { id: 'celestial-vellum', label: 'Celestial vellum', tone: 'light', bar: '#f4ead2' },
] as const satisfies readonly WorldEntry[];

export type World = (typeof WORLDS)[number];
export type WorldId = World['id'];
export type DarkWorld = Extract<World, { tone: 'dark' }>['id'];
export type LightWorld = Extract<World, { tone: 'light' }>['id'];

export const DARK_WORLDS = WORLDS.filter((w): w is Extract<World, { tone: 'dark' }> => w.tone === 'dark');
export const LIGHT_WORLDS = WORLDS.filter((w): w is Extract<World, { tone: 'light' }> => w.tone === 'light');

/** Everyone's world until they pick, and Auto's night world until they pick one. */
export const DEFAULT_WORLD: DarkWorld = 'black-star-sky';
/** Auto's day world until they pick one. */
export const DEFAULT_DAY_WORLD: LightWorld = 'green-hills';

const BY_ID = new Map<string, World>(WORLDS.map((w) => [w.id, w]));
/** A world's entry in WORLDS. */
export const worldOf = (id: WorldId): World => BY_ID.get(id)!;
const isWorld = (v: string | null): v is WorldId => BY_ID.has(v ?? '');
const isDark = (v: string | null): v is DarkWorld => BY_ID.get(v ?? '')?.tone === 'dark';
const isLight = (v: string | null): v is LightWorld => BY_ID.get(v ?? '')?.tone === 'light';

/** What tells Auto it's day: the phone's own light/dark setting, or the real sun where the Lorer stands. */
export const DRIVERS = ['phone', 'sun'] as const;
export type Driver = (typeof DRIVERS)[number];
export const DEFAULT_DRIVER: Driver = 'phone';

export const DRIVER_LABELS: Record<Driver, string> = {
  phone: 'Follow my phone',
  sun: 'Follow the sun where I stand',
};

/** What decides the half of the day right now: Auto's driver, or (Auto off) the picked world's own tone. */
export type DaylightChoice = Driver | 'night' | 'day';

export type Half = 'day' | 'night';

/** Where the Lorer stands, to one decimal (about 10 km): plenty for the sun, and no more than it needs. */
export interface SunPoint {
  lat: number;
  lon: number;
}

/** What a Lorer picked in Profile → Your world. */
export interface Choices {
  auto: boolean;
  /** The world when Auto is off: any world. */
  world: WorldId;
  /** Auto's night world (a dark one) and day world (a light one). */
  night: DarkWorld;
  day: LightWorld;
  driver: Driver;
}

// ------------------------------------------------------------------------------------------ storage

const KEY = 'lore.theme';
/** The world when Auto is off (any world). Kept before 2026-11-19: the night world. */
const WORLD_KEY = 'lore.world';
/**
 * 'on' or 'off'. Missing: nothing picked since 2026-11-19, so lore.world and lore.daylight are read as they were
 * kept before (loadChoices), and the next applyLook() writes them the new way.
 */
const AUTO_KEY = 'lore.auto';
const NIGHT_KEY = 'lore.nightWorld';
const DAY_KEY = 'lore.dayWorld';
/** Auto's driver, 'phone' or 'sun'. Kept before 2026-11-19 it could also be 'night' or 'day' (Always night/day). */
const DAYLIGHT_KEY = 'lore.daylight';
const SUN_KEY = 'lore.sun';
/** The sun's last answer and until when it holds: index.html reads it before the first paint. */
const SUN_NOW_KEY = 'lore.sunNow';
/**
 * What index.html's boot script wears, worked out here (applyLook) so the script needs no list of worlds:
 * `{ when, night: [id, bar], day: [id, bar] }`. `when` is 'phone' or 'sun' (Auto on) or the picked world's half
 * (Auto off: 'night' or 'day', with that world in both slots). Never a choice of its own; rewritten only when it
 * changed.
 */
const BOOT_KEY = 'lore.boot';
/**
 * "1" while someone is signed in on this device (World.tsx keeps it). Without it a start wears the front door's
 * world, as Welcome does: a new install or a signed-out start opens on '/', waits for /auth/me and lands on
 * Welcome, and must not show a picked world for those seconds first. Only a hint for the first paint.
 */
const IN_KEY = 'lore.in';
/** How many sunrises and sunsets the boot script gets: about a week, so a start days later still knows. */
const SUN_TURNS = 14;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

const isOffered = (v: string | null): v is ActiveTheme => (THEMES as readonly string[]).includes(v ?? '');

/**
 * The look to wear. A retired or unknown stored choice (a stored `map` included) wears the default. The stored
 * value is left alone, so if that look is ever brought back, people get their old pick back.
 */
export function loadTheme(): ActiveTheme {
  const v = read(KEY);
  return isOffered(v) ? v : DEFAULT_THEME;
}

/**
 * The choices kept on this device. Unknown or missing values are the defaults: Auto off, the black star sky (and
 * for Auto, the black star sky by night, the green hills by day, following the phone).
 *
 * Kept before 2026-11-19 (no lore.auto): lore.world was the night world and lore.daylight said when it's day.
 * "Follow my phone" or "the sun" become Auto on, with the same driver, that night world and the green hills;
 * "Always night" is that night world, "Always day" the green hills; a night world picked with nothing said about
 * the day is that world (the owner: what they choose is what they see; Auto only when they choose it).
 */
export function loadChoices(): Choices {
  const auto = read(AUTO_KEY);
  const when = read(DAYLIGHT_KEY);
  const stored = read(WORLD_KEY);
  const driver: Driver = when === 'sun' ? 'sun' : DEFAULT_DRIVER;
  if (auto === null) {
    const night = isDark(stored) ? stored : DEFAULT_WORLD;
    const day = DEFAULT_DAY_WORLD;
    if (when === 'phone' || when === 'sun') return { auto: true, world: night, night, day, driver };
    return { auto: false, world: when === 'day' ? day : night, night, day, driver: DEFAULT_DRIVER };
  }
  const night = read(NIGHT_KEY);
  const day = read(DAY_KEY);
  return {
    auto: auto === 'on',
    world: isWorld(stored) ? stored : DEFAULT_WORLD,
    night: isDark(night) ? night : DEFAULT_WORLD,
    day: isLight(day) ? day : DEFAULT_DAY_WORLD,
    driver,
  };
}

/** Choices kept before 2026-11-19 that haven't been written the new way yet (applyLook rewrites them). */
const keptTheOldWay = () => read(AUTO_KEY) === null && (read(WORLD_KEY) !== null || read(DAYLIGHT_KEY) !== null);

function saveChoices(c: Choices) {
  write(WORLD_KEY, c.world);
  write(NIGHT_KEY, c.night);
  write(DAY_KEY, c.day);
  write(DAYLIGHT_KEY, c.driver);
  // Last: until it is there, the keys above are read the old way.
  write(AUTO_KEY, c.auto ? 'on' : 'off');
}

export function loadSunPoint(): SunPoint | null {
  try {
    const p = JSON.parse(read(SUN_KEY) ?? 'null') as Partial<SunPoint> | null;
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat!) <= 90 && Math.abs(p.lon!) <= 180) {
      return { lat: p.lat!, lon: p.lon! };
    }
  } catch {
    // A broken value is no point at all.
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- sun

const RAD = Math.PI / 180;
/** The sun's centre this far below the horizon is sunrise and sunset (refraction and the sun's own radius). */
const HORIZON = -0.833;

/**
 * The sun's height above the horizon, in degrees, at a moment and a place (NOAA's solar position equations,
 * good to a minute or so of sunrise and sunset). Works on the device: nothing is asked of any server.
 */
export function sunElevation(at: number, lat: number, lon: number): number {
  const jd = at / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  // The equation of time, in minutes.
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  const minutes = (((at % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const solarTime = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = solarTime / 4 - 180;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle * RAD);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

export const isSunUp = (at: number, lat: number, lon: number) => sunElevation(at, lat, lon) > HORIZON;

/**
 * The next sunrise or sunset after `at`, on the whole minute just after it (so asking again a moment later
 * gives the same answer), or null when the sun neither rises nor sets in the next two days (midnight sun,
 * polar night): no limit on where a Lorer stands.
 */
export function nextSunTurn(at: number, lat: number, lon: number): number | null {
  const step = 10 * 60_000;
  const up = isSunUp(at, lat, lon);
  let a = at;
  for (let b = at + step; b <= at + 48 * 3_600_000; b += step) {
    if (isSunUp(b, lat, lon) !== up) {
      let lo = a;
      let hi = b;
      while (hi - lo > 1_000) {
        const mid = (lo + hi) / 2;
        if (isSunUp(mid, lat, lon) === up) lo = mid;
        else hi = mid;
      }
      return Math.ceil(hi / 60_000) * 60_000;
    }
    a = b;
  }
  return null;
}

/** The next sunrises and sunsets after `at` (six: about three days' worth, unless asked for more), in order. */
export function sunTurns(at: number, lat: number, lon: number, count = 6): number[] {
  const turns: number[] = [];
  let from = at;
  while (turns.length < count) {
    const turn = nextSunTurn(from, lat, lon);
    if (turn === null) break;
    turns.push(turn);
    from = turn + 60_000;
  }
  return turns;
}

/** Day or night for a choice. Following the sun without a place falls back to the phone. */
export function halfOfDay(choice: DaylightChoice, ctx: { now: number; point: SunPoint | null; phoneDark: boolean }): Half {
  if (choice === 'day') return 'day';
  if (choice === 'night') return 'night';
  if (choice === 'sun' && ctx.point) return isSunUp(ctx.now, ctx.point.lat, ctx.point.lon) ? 'day' : 'night';
  return ctx.phoneDark ? 'night' : 'day';
}

/** What decides the half of the day for these choices: Auto's driver, or the picked world's own tone. */
const daylightOf = (c: Choices): DaylightChoice => (c.auto ? c.driver : worldOf(c.world).tone === 'light' ? 'day' : 'night');

/** The world these choices put on screen in a half of the day (the front door aside). */
const worldFor = (c: Choices, half: Half): WorldId => (!c.auto ? c.world : half === 'day' ? c.day : c.night);

// --------------------------------------------------------------------------------------- the store

export interface Look extends Choices {
  /** What decides the half of the day now: 'phone' or 'sun' (Auto on), or the picked world's 'night' or 'day'. */
  daylight: DaylightChoice;
  /** The world on screen now. */
  shown: WorldId;
  /** The tone of the world on screen: 'day' on a light world. */
  half: Half;
  /** Following the sun can work: the device knows where the Lorer stands. */
  sunKnown: boolean;
}

const START: Look = {
  auto: false,
  world: DEFAULT_WORLD,
  night: DEFAULT_WORLD,
  day: DEFAULT_DAY_WORLD,
  driver: DEFAULT_DRIVER,
  daylight: 'night',
  shown: DEFAULT_WORLD,
  half: 'night',
  sunKnown: false,
};

let pins = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let current: Look = START;
const listeners = new Set<() => void>();

const hasDom = () => typeof document !== 'undefined';
const phoneIsDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
};
/**
 * Welcome and "Where do you stand?" wear the default world with its compass rose (also before React mounts), and
 * so does any start before someone is signed in on this device (it is on its way to Welcome).
 */
const onFrontDoor = () => hasDom() && (/^\/welcome(\/|$)/.test(location.pathname) || read(IN_KEY) !== '1');
const inTemple = () => hasDom() && (location.pathname === '/oracle' || location.pathname.startsWith('/oracle/'));

/**
 * Works out the world for now and puts it on <html>. Cheap and idempotent: called on start, on every choice,
 * when the phone flips light/dark, when the app comes back to the front, and at sunrise and sunset.
 */
export function applyLook(now: number = Date.now()): Look {
  const oldWay = keptTheOldWay();
  const c = loadChoices();
  if (oldWay) saveChoices(c);
  const point = loadSunPoint();
  const daylight = daylightOf(c);
  const natural = halfOfDay(daylight, { now, point, phoneDark: phoneIsDark() });
  const pinned = pins > 0 || onFrontDoor();
  const shown: WorldId = pinned ? DEFAULT_WORLD : worldFor(c, natural);
  const half: Half = worldOf(shown).tone === 'light' ? 'day' : 'night';

  if (hasDom()) {
    const root = document.documentElement;
    if (root.getAttribute('data-world') !== shown || root.getAttribute('data-daylight') !== half) {
      root.setAttribute('data-world', shown);
      root.setAttribute('data-daylight', half);
      // The native shell (lib/native.ts) re-styles the status bar when data-theme is written; writing it again
      // tells it about the new world too.
      const theme = root.getAttribute('data-theme');
      if (theme) root.setAttribute('data-theme', theme);
    }
    if (!inTemple()) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', worldOf(shown).bar);
  }

  // What index.html wears on the next start, before the first paint (BOOT_KEY). Written only when it changed.
  const slot = (w: WorldId) => [w, worldOf(w).bar];
  const boot = JSON.stringify({ when: daylight, night: slot(worldFor(c, 'night')), day: slot(worldFor(c, 'day')) });
  if (read(BOOT_KEY) !== boot) write(BOOT_KEY, boot);

  // Sunrise and sunset: wake at the next one, and leave the answer (and the next week of turns) for index.html's
  // next first paint, so a start after a sunset is already night. When fewer turns come (the edge of the
  // midnight sun or the polar night), the last half holds at least two more days. Written only when it changed:
  // every tab writes this cache, and none reacts to another's (startLook).
  clearTimeout(timer);
  timer = undefined;
  if (daylight === 'sun' && point) {
    const turns = sunTurns(now, point.lat, point.lon, SUN_TURNS);
    const last = turns.length ? turns[turns.length - 1]! : Math.floor(now / 60_000) * 60_000;
    const until = turns.length === SUN_TURNS ? last : last + 48 * 3_600_000;
    const value = JSON.stringify({ day: natural === 'day', turns, until });
    if (read(SUN_NOW_KEY) !== value) write(SUN_NOW_KEY, value);
    if (hasDom()) timer = setTimeout(() => applyLook(), Math.min((turns[0] ?? until) - now + 5_000, 6 * 3_600_000));
  }

  const next: Look = { ...c, daylight, shown, half, sunKnown: !!point };
  if ((Object.keys(next) as (keyof Look)[]).some((k) => next[k] !== current[k])) {
    current = next;
    for (const fn of listeners) fn();
  }
  return current;
}

/** Keeps the world in step with the phone's light/dark switch, the app coming to the front, and other tabs. */
export function startLook(): () => void {
  if (!hasDom()) return () => undefined;
  const again = () => applyLook();
  const onVisible = () => {
    if (document.visibilityState === 'visible') applyLook();
  };
  // Another tab changed a choice. Not the sun's cache nor the boot script's hint: every tab writes those, so
  // reacting to them could have two tabs answer each other forever.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SUN_NOW_KEY || e.key === BOOT_KEY) return;
    if (e.key === null || e.key.startsWith('lore.')) applyLook();
  };
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', again);
  } catch {
    media = null;
  }
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('storage', onStorage);
  applyLook();
  return () => {
    media?.removeEventListener('change', again);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('storage', onStorage);
    clearTimeout(timer);
    timer = undefined;
  };
}

export function getLook(): Look {
  return current;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current world and choices, re-rendering when they change. */
export function useLook(): Look {
  return useSyncExternalStore(subscribe, getLook, getLook);
}

/** Welcome and "Where do you stand?": wear the default night world (and its compass rose) while mounted. */
export function useFrontDoorWorld() {
  useEffect(() => {
    pins++;
    applyLook();
    return () => {
      pins--;
      applyLook();
    };
  }, []);
}

function choose(change: Partial<Choices>) {
  saveChoices({ ...loadChoices(), ...change });
  applyLook();
}

/** Someone tapped a world with Auto off: that world, always, dark or light. */
export function chooseWorld(world: WorldId) {
  choose({ world });
}

/** Someone picked Auto's world for the night (a dark one). */
export function chooseNightWorld(night: DarkWorld) {
  choose({ night });
}

/** Someone picked Auto's world for the day (a light one). */
export function chooseDayWorld(day: LightWorld) {
  choose({ day });
}

/** Someone picked what tells Auto it's day. */
export function chooseDriver(driver: Driver) {
  choose({ driver });
}

/**
 * Auto on or off, without a jump where it can be helped. On: the picked world becomes Auto's world for its own
 * half (a dark one for the night, a light one for the day). Off: the world on screen now stays, as the picked one.
 */
export function chooseAuto(on: boolean) {
  const c = loadChoices();
  if (on === c.auto) return;
  if (on) {
    const w = c.world;
    choose({ auto: true, night: isDark(w) ? w : c.night, day: isLight(w) ? w : c.day });
    return;
  }
  const half = halfOfDay(c.driver, { now: Date.now(), point: loadSunPoint(), phoneDark: phoneIsDark() });
  choose({ auto: false, world: worldFor(c, half) });
}

/** Where the Lorer stands (the Loracle's home point), or null when unknown or signed out. */
export function setSunPoint(point: SunPoint | null) {
  const round = (x: number) => Math.round(x * 10) / 10;
  const value = point ? JSON.stringify({ lat: round(point.lat), lon: round(point.lon) }) : null;
  if (value === read(SUN_KEY)) return;
  write(SUN_KEY, value);
  if (!value) write(SUN_NOW_KEY, null);
  applyLook();
}

/** Someone is (or no one is) signed in on this device: the first-paint hint (IN_KEY). World.tsx keeps it. */
export function setSignedIn(signedIn: boolean) {
  const value = signedIn ? '1' : null;
  if (read(IN_KEY) === value) return;
  write(IN_KEY, value);
  applyLook();
}

// ------------------------------------------------------------------------------------------- looks

/** Crazy (retired): paint everything on screen again in new random colours. */
export const rollColors = rollCrazy;

/** Puts a look on the page. Doesn't save it (main.tsx calls this on every start). */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  if (choice === 'crazy') startCrazy();
  else stopCrazy();
  if (choice === 'lore') applyLook();
}

/** Someone picked a look in Profile: wear it and remember it. */
export function chooseTheme(choice: ActiveTheme) {
  applyTheme(choice);
  write(KEY, choice);
}

/** True when a colour like '#1a3a6e' is dark enough that light letters read best on it (WCAG luminance). */
export function isDarkColour(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return true;
  const lin = (h: string) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!);
  // Where white and black letters read equally well: (1.05) / (l + 0.05) = (l + 0.05) / 0.05.
  return l < 0.179;
}

/**
 * Dark-looking themes want light status bar icons. In LORE that's the top edge of the world on screen (its
 * `bar`): every world today is dark there, the green hills too (a deep blue sky over the sun); a light world with
 * a pale sky gets dark icons.
 */
export function isDarkTheme(): boolean {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  if (theme === 'lore') {
    const shown = root.getAttribute('data-world');
    return isWorld(shown) ? isDarkColour(worldOf(shown).bar) : true;
  }
  if (theme === 'dark') return true;
  if (theme === 'map' || theme === 'light' || theme === 'crazy') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Exported for tests: forget the store's state between cases. */
export function resetLookForTests() {
  pins = 0;
  clearTimeout(timer);
  timer = undefined;
  current = START;
}

/** The keys this module stores under (index.html's boot script reads boot, sunNow and signedIn, and, once after
 * the update of 2026-11-19, world and daylight as they were kept before). */
export const STORAGE_KEYS = {
  theme: KEY,
  world: WORLD_KEY,
  auto: AUTO_KEY,
  nightWorld: NIGHT_KEY,
  dayWorld: DAY_KEY,
  daylight: DAYLIGHT_KEY,
  sun: SUN_KEY,
  sunNow: SUN_NOW_KEY,
  boot: BOOT_KEY,
  signedIn: IN_KEY,
} as const;
