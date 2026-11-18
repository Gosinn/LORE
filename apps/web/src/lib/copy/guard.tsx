// Live text: the crash guard (LIVE_TEXT_SPEC 5.3). Overrides are only text, so this should never fire;
// it exists so a bug can never brick the app, offline included. If rendering throws while edited words
// are applied, it drops the cached words, closes the owner's drafts, remembers that for this session (so
// the session runs on the code's own words) and reloads once.
// Not touched by the build transform (lib/copy/**): these words stay as written.
import { Component, useEffect, type ReactNode } from 'react';
import { useRouteError } from 'react-router';
import { canRememberCrash, clearCache, isCrashed, markCrashed, SWITCH_KEY, writeItem } from './cache.ts';
import { copyStore } from './runtime.ts';

/**
 * A page's code that can't be loaded: after a deploy the new service worker drops the old chunks, so an
 * open tab that navigates to a page it hasn't loaded yet fails like this. Nothing to do with the words.
 */
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

export const isStaleChunk = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && STALE_CHUNK.test(error.message);

const CHUNK_RELOAD_KEY = 'lore.chunkReload';

/** Stale page code: one reload fetches the new build (at most once a minute, so offline never loops). */
function reloadForNewBuild(): void {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return; // no storage, no way to know we already tried: leave it to the Reload button
  }
  window.location.reload();
}

/**
 * Drops live text and reloads, once per session. False when there was nothing to drop (or already did), and
 * for stale page code after a deploy: a reload fixes that, without switching the words off.
 */
export function recoverFromCopyCrash(error?: unknown): boolean {
  if (isStaleChunk(error)) return false;
  if (!copyStore.hasLiveCopy() || isCrashed() || !canRememberCrash()) return false;
  markCrashed();
  clearCache();
  // The owner's drafts stay stored, but closed until he switches the editor on again (Profile).
  if (copyStore.draftsUser()) writeItem(SWITCH_KEY, null);
  copyStore.closeDrafts();
  window.location.reload();
  return true;
}

function CrashNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : null;
  return (
    <div className="empty" role="alert" style={{ margin: '48px 16px' }}>
      <p className="serif">Something went wrong on this page.</p>
      {message && <p className="small muted">{message}</p>}
      <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

/** Around the whole app (main.tsx). */
export class CopyCrashBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    recoverFromCopyCrash(error);
  }

  override render() {
    return this.state.error ? <CrashNote error={this.state.error} /> : this.props.children;
  }
}

/**
 * The router catches errors in route components itself, so the top-level routes use this as their
 * `errorElement` (router.tsx): same guard, then a plain note with Reload.
 */
export function CopyRouteError() {
  const error = useRouteError();
  useEffect(() => {
    if (isStaleChunk(error)) reloadForNewBuild();
    else recoverFromCopyCrash(error);
  }, [error]);
  return <CrashNote error={error} />;
}
