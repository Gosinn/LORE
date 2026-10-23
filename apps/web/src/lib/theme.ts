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

/** Crazy: every container picks its neon from a palette that is rolled again on each visit. */
export function rollNeon() {
  document.documentElement.style.setProperty('--shift', String(Math.floor(Math.random() * 360)));
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  if (choice === 'crazy') rollNeon();
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

/** Dark-looking themes want light status bar icons. */
export function isDarkTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark' || theme === 'crazy') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
