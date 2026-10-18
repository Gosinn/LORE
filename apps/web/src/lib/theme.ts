export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'lore.theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}
