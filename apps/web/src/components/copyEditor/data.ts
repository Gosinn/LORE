// Live text editor: data and small helpers (catalog, owner state, labels).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CopyAdminState, CopyCatalog, CopyCatalogEntry, CopyHistory } from '#shared';
import { hashText, keyHash, keyScope, kindFromOriginal, placeholderNames, SERVER_SCOPE, type CopyKind } from '#shared/copy';
import { api } from '../../lib/api.ts';
import { copyStore } from '../../lib/copy/runtime.ts';
import { whereLabel } from './where.ts';

/** Re-renders on every change of the words, drafts or edit mode. */
export function useCopyTick(): number {
  return useSyncExternalStore(copyStore.subscribe, copyStore.getTick, copyStore.getTick);
}

// ------------------------------------------------------------------ the catalog (every text in this build)

let catalogPromise: Promise<CopyCatalog | null> | null = null;

/** dist/copy-catalog.json: next to index.html on the web, inside the app bundle on phones. Loaded once. */
export function loadCatalog(): Promise<CopyCatalog | null> {
  catalogPromise ??= fetch(`${import.meta.env.BASE_URL}copy-catalog.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<CopyCatalog>) : null))
    .then((c) => (c && typeof c === 'object' && c.keys && typeof c.keys === 'object' ? c : null))
    .catch(() => null)
    .then((c) => {
      if (!c) catalogPromise = null; // try again next time the editor opens
      return c;
    });
  return catalogPromise;
}

export function useCatalog(): { catalog: CopyCatalog | null; loading: boolean } {
  const [state, setState] = useState<{ catalog: CopyCatalog | null; loading: boolean }>({ catalog: null, loading: true });
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((catalog) => alive && setState({ catalog, loading: false }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

// ------------------------------------------------------------------ owner-only API

export const ADMIN_KEY = ['copy-admin'] as const;

export const useCopyAdmin = () =>
  useQuery({ queryKey: ADMIN_KEY, queryFn: () => api.get<CopyAdminState>('/admin/copy'), staleTime: 30_000 });

export const useKeyHistory = (key: string, enabled: boolean) =>
  useQuery({
    queryKey: ['copy-history', key],
    queryFn: () => api.get<CopyHistory>(`/admin/copy/history?key=${encodeURIComponent(key)}`),
    enabled,
  });

// ------------------------------------------------------------------ what a key is

export interface KeyFacts {
  key: string;
  entry: CopyCatalogEntry | undefined;
  /** The default from the code ('' when neither this device nor the catalog knows the key). */
  d: string;
  kind: CopyKind;
  names: string[];
  /** The catalog's context ("EventFormInner › Field label"): stored with a publish, shown as a tooltip. */
  context: string | null;
  /** Where it lives, in plain words ("Event page › field name"). */
  label: string;
  legal: boolean;
  /** Can be changed here (a server message must be a fixed one from the catalog). */
  editable: boolean;
}

export function factsOf(key: string, catalog: CopyCatalog | null): KeyFacts {
  const entry = catalog?.keys[key];
  const info = copyStore.info(key);
  // The runtime's default only when it is the key's own text: a server message the server already sent
  // in published words is known to this device by those words, not by the code's.
  const own = info && hashText(info.d) === keyHash(key) ? info.d : undefined;
  const d = own ?? entry?.text ?? '';
  // The runtime can only show plain strings where it uses a key as one, whatever the catalog says.
  const kind: CopyKind = info?.kind === 's' ? 's' : (entry?.kind ?? info?.kind ?? kindFromOriginal(d));
  const names = entry?.ph ? Object.keys(entry.ph) : info?.names.length ? [...info.names] : placeholderNames(d);
  const scope = keyScope(key);
  return {
    key,
    entry,
    d,
    kind,
    names,
    context: entry?.ctx ?? null,
    label: whereLabel(key, entry?.ctx),
    legal: !!entry?.legal || scope === 'pages/Legal',
    editable: !!d && (scope !== SERVER_SCOPE || !catalog || !!entry),
  };
}

export { whereLabel } from './where.ts';

/** Plain words for where a text lives, and the code's own context as a tooltip. `stored`: a publish's context. */
export function whereOf(key: string, catalog: CopyCatalog | null, stored?: string | null): { label: string; hint: string | undefined } {
  const ctx = catalog?.keys[key]?.ctx ?? stored ?? null;
  return { label: whereLabel(key, ctx), hint: ctx ?? undefined };
}

/** The words a key shows right now on this device (the owner's drafts included). */
export function wordsOf(key: string, catalog: CopyCatalog | null): string {
  return copyStore.current(key).text ?? (factsOf(key, catalog).d || '');
}

/** Other files with exactly the same words (offered as "Change those too"). */
export function sameWordsElsewhere(key: string, d: string, catalog: CopyCatalog | null): string[] {
  if (!catalog || !d) return [];
  const scope = keyScope(key);
  return Object.entries(catalog.keys)
    .filter(([k, e]) => k !== key && e.text === d && keyScope(k) !== scope && keyScope(k) !== SERVER_SCOPE)
    .map(([k]) => k);
}

// ------------------------------------------------------------------ orphans

export { orphansOf, type Orphan } from './orphans.ts';

export const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
