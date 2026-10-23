import { rollCrazy, startCrazy, stopCrazy } from './crazy.ts';

export type ThemeChoice = 'system' | 'light' | 'dark' | 'crazy';
const KEY = 'lore.theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'crazy' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Crazy: paint everything on screen again in new random colours. */
export const rollColors = rollCrazy;

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  if (choice === 'crazy') startCrazy();
  else stopCrazy();
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

/** Dark-looking themes want light status bar icons. */
export function isDarkTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light' || theme === 'crazy') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
