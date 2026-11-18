// Live text: keeping the published words current on this device (LIVE_TEXT_SPEC 5.3, 5.4).
//
// No timers. The cached words are applied before the first render (runtime.ts); then:
// - at start, GET /api/copy?v=<version we have> in the background;
// - every API response carries `x-lore-copy: <version>` (api.ts hands it here); when it differs from what
//   we show, fetch once (single flight, after 1 s so a burst of responses is one fetch);
// - when the app comes to the front (tab visible, window focus, Capacitor resume).
import { App } from '@capacitor/app';
import type { CopyFetch, CopyState } from '#shared';
import { api, isNative, onCopyVersion } from '../api.ts';
import { cleanState, isCrashed, writeCache } from './cache.ts';
import { copyStore } from './runtime.ts';

const DEBOUNCE_MS = 1000;
/** A header that still differs right after a fetch (several servers out of step) is retried this rarely. */
const SAME_TARGET_MS = 30_000;
/** Coming to the front more often than this doesn't ask again (focus and visibility fire together). */
const FRONT_MS = 5000;

let started = false;
let inflight: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The newest version a response header announced. */
let announced: string | null | undefined;
let lastTarget: string | null | undefined;
let lastTargetAt = 0;
let lastFront = 0;

const fromHeader = (v: string): string | null => (v && v !== '0' ? v : null);

/**
 * New published words: checked entry by entry (bad ones dropped), shown, and kept for the next start.
 * After a crash in this session (guard.tsx) only an explicit call (a publish) applies them.
 */
export function applyCopyState(state: CopyState, opts: { auto?: boolean } = {}): void {
  const clean = cleanState(state);
  if (!clean) return;
  if (opts.auto && isCrashed()) return;
  writeCache(clean);
  if (clean.version !== copyStore.version() || !sameTexts(clean.texts, copyStore.published())) copyStore.apply(clean);
}

function sameTexts(a: Record<string, string>, b: ReadonlyMap<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === b.size && keys.every((k) => b.get(k) === a[k]);
}

/**
 * Asks the server for the published words now (one request at a time). Never after a crash in this session:
 * it would only fetch words it won't show (the editor fetches and applies explicitly, catchUpCopy).
 */
export function refreshCopy(): Promise<void> {
  if (isCrashed()) return Promise.resolve();
  if (inflight) {
    again = true;
    return inflight;
  }
  const have = copyStore.version();
  inflight = (async () => {
    try {
      const res = await api.get<CopyFetch>(`/copy${have ? `?v=${encodeURIComponent(have)}` : ''}`);
      if (res && !('unchanged' in res && res.unchanged)) applyCopyState(res as CopyState, { auto: true });
    } catch {
      // Offline or an older server without live text: keep the words we have.
    }
  })().finally(() => {
    inflight = null;
    if (again) {
      again = false;
      schedule();
    }
  });
  return inflight;
}

/**
 * The editor after a 409 (published elsewhere meanwhile): the current words, fetched and applied now. Never a
 * request already under way (it may have started before the other publish), and applied even in a crashed
 * session, where the store would otherwise keep an old version and every retry would be stale again.
 */
export async function catchUpCopy(): Promise<void> {
  applyCopyState(await api.get<CopyState>('/copy'));
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(maybeRefresh, DEBOUNCE_MS);
}

function maybeRefresh(): void {
  if (announced === undefined || announced === copyStore.version()) return;
  // The same announcement that a fetch just failed to reach: don't ask every second.
  if (announced === lastTarget && Date.now() - lastTargetAt < SAME_TARGET_MS) return;
  lastTarget = announced;
  lastTargetAt = Date.now();
  void refreshCopy();
}

/** api.ts calls this with the `x-lore-copy` header of every response. */
export function noteCopyVersion(header: string): void {
  const v = fromHeader(header);
  if (v === copyStore.version()) return;
  announced = v;
  schedule();
}

function onFront(): void {
  const now = Date.now();
  if (now - lastFront < FRONT_MS) return;
  lastFront = now;
  void refreshCopy();
}

/** main.tsx, once, before the first render. */
export function startCopySync(): void {
  if (started) return;
  started = true;
  onCopyVersion(noteCopyVersion);
  void refreshCopy();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFront();
    });
  }
  if (typeof window !== 'undefined') window.addEventListener('focus', onFront);
  // The Android/iOS app coming back from the background.
  if (isNative) void App.addListener('resume', onFront).catch(() => undefined);
}

/** Tests only: forget timers and state. */
export function resetCopySyncForTests(): void {
  clearTimeout(timer);
  started = false;
  inflight = null;
  again = false;
  announced = undefined;
  lastTarget = undefined;
  lastTargetAt = 0;
  lastFront = 0;
}
