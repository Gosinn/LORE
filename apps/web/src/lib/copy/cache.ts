// Live text: what this device keeps between starts (LIVE_TEXT_SPEC 5.1, 5.3).
// Every storage access is wrapped: private windows, blocked storage and the server-side test run have none.
import type { CopyState } from '#shared';
import { COPY_FORBIDDEN, COPY_KEY_RE, MAX_COPY_OVERRIDES, MAX_COPY_TEXT } from '#shared/copy';
import type { Pending } from './types.ts';

/** The published words, as last fetched: `{ version, texts }`. Read before the first render. */
export const CACHE_KEY = 'lore.copy';
/** The owner's unpublished edits. Opened only after the owner gate confirms him (gate.tsx). */
export const draftKey = (userId: string) => `lore.copy.draft.${userId}`;
/** The Profile switch: '1' when the owner wants the editor (pen) loaded. */
export const SWITCH_KEY = 'lore.copy.editor';
/** sessionStorage: this session crashed with live text applied, so it runs on the code's words only. */
export const CRASH_KEY = 'lore.copy.crashed';

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readItem(key: string): string | null {
  try {
    return local()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string | null): void {
  try {
    const s = local();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Full or blocked storage: the words still apply for this session.
  }
}

const okText = (t: unknown): t is string =>
  typeof t === 'string' && t.length > 0 && t.length <= MAX_COPY_TEXT && !COPY_FORBIDDEN.test(t);

/**
 * Keeps only what can be shown safely: a string-or-null version, well-formed keys, texts of 1 to 8,000
 * characters with no control, bidi or marker characters, at most 2,000 of them. Bad entries are dropped,
 * never the whole state; anything that isn't a state at all gives null.
 */
export function cleanState(raw: unknown): CopyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const { version, texts } = raw as { version?: unknown; texts?: unknown };
  if (version !== null && typeof version !== 'string') return null;
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, text] of Object.entries(texts as Record<string, unknown>)) {
    if (n >= MAX_COPY_OVERRIDES) break;
    if (!COPY_KEY_RE.test(key) || !okText(text)) continue;
    out[key] = text;
    n++;
  }
  return { version: version || null, texts: out };
}

export function readCache(): CopyState | null {
  const raw = readItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return cleanState(JSON.parse(raw));
  } catch {
    writeItem(CACHE_KEY, null);
    return null;
  }
}

export function writeCache(state: CopyState): void {
  writeItem(CACHE_KEY, JSON.stringify(state));
}

export function clearCache(): void {
  writeItem(CACHE_KEY, null);
}

export function cleanDrafts(raw: unknown): Array<[string, Pending]> {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null;
  if (!items || typeof items !== 'object' || Array.isArray(items)) return [];
  const out: Array<[string, Pending]> = [];
  for (const [key, p] of Object.entries(items as Record<string, unknown>)) {
    if (out.length >= MAX_COPY_OVERRIDES) break;
    if (!COPY_KEY_RE.test(key) || !p || typeof p !== 'object') continue;
    const { text, original, context } = p as Partial<Record<keyof Pending, unknown>>;
    if (text !== null && !okText(text)) continue;
    if (typeof original !== 'string' || !original) continue;
    out.push([key, { text, original, context: typeof context === 'string' ? context : null }]);
  }
  return out;
}

export function readDrafts(userId: string): Array<[string, Pending]> {
  const raw = readItem(draftKey(userId));
  if (!raw) return [];
  try {
    return cleanDrafts(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeDrafts(userId: string, entries: Iterable<[string, Pending]>): void {
  const items = Object.fromEntries(entries);
  writeItem(draftKey(userId), Object.keys(items).length ? JSON.stringify({ v: 1, items }) : null);
}

export function isCrashed(): boolean {
  try {
    return session()?.getItem(CRASH_KEY) === '1';
  } catch {
    return false;
  }
}

export function markCrashed(): void {
  try {
    session()?.setItem(CRASH_KEY, '1');
  } catch {
    // Without sessionStorage the guard can't remember; it then never reloads (see guard.tsx).
  }
}

/** Whether sessionStorage works (the crash guard reloads only when it can remember that it did). */
export function canRememberCrash(): boolean {
  try {
    const s = session();
    if (!s) return false;
    s.setItem('lore.copy.probe', '1');
    s.removeItem('lore.copy.probe');
    return true;
  } catch {
    return false;
  }
}
