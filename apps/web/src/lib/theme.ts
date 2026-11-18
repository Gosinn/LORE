import { rollCrazy, startCrazy, stopCrazy } from './crazy.ts';

/**
 * LORE's looks. Only the Treasure Map is offered. The older looks are retired, not deleted
 * (owner, 2026-11-18: "dont delete them, just retire them ... i might change my mind"): their CSS and code
 * stay as they were. To bring one back, move its name from RETIRED_THEMES into THEMES. Profile lists THEMES.
 * Also drop `data-theme="map"` (and the paper theme-color) from index.html, or set them from a tiny inline
 * script that reads lore.theme; otherwise every start of the returned look flashes the map paper first.
 * The browser bar follows the look's --bg by itself (AppShell).
 */
export const THEMES = ['map'] as const;
export const RETIRED_THEMES = ['system', 'light', 'dark', 'crazy'] as const;

export type ActiveTheme = (typeof THEMES)[number];
export type RetiredTheme = (typeof RETIRED_THEMES)[number];
export type ThemeChoice = ActiveTheme | RetiredTheme;

export const DEFAULT_THEME: ActiveTheme = 'map';

export const THEME_LABELS: Record<ThemeChoice, string> = {
  map: 'Treasure Map',
  system: 'Match device',
  light: 'Paper',
  dark: 'Campfire',
  crazy: 'Crazy',
};

const KEY = 'lore.theme';
const isOffered = (v: string | null): v is ActiveTheme => (THEMES as readonly string[]).includes(v ?? '');

/**
 * The look to wear. A retired or unknown stored choice wears the default. The stored value is left alone,
 * so if that look is ever brought back, people get their old pick back.
 */
export function loadTheme(): ActiveTheme {
  try {
    const v = localStorage.getItem(KEY);
    return isOffered(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Crazy (retired): paint everything on screen again in new random colours. */
export const rollColors = rollCrazy;

/** Puts a look on the page. Doesn't save it (main.tsx calls this on every start). */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  if (choice === 'crazy') startCrazy();
  else stopCrazy();
}

/** Someone picked a look in Profile: wear it and remember it. */
export function chooseTheme(choice: ActiveTheme) {
  applyTheme(choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

/** Dark-looking themes want light status bar icons. The map is paper. */
export function isDarkTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'map' || theme === 'light' || theme === 'crazy') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
