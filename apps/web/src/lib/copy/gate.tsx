// Live text: the owner gate (LIVE_TEXT_SPEC 5.5). In the main bundle, beside the router (main.tsx).
// - Only the owner (Me.canEditCopy) with the Profile switch on gets his unpublished edits applied and the
//   editor loaded (its own lazily loaded chunk, components/copyEditor, so nobody else downloads it).
// - Anyone else never sees drafts; signing out (me becomes null), another account or the switch off
//   closes them (they stay stored for him). With the switch off he sees exactly what everyone sees.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Component, lazy, Suspense, useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Me } from '#shared';
import { useMe } from '../queries.ts';
import { readItem, SWITCH_KEY, writeItem } from './cache.ts';
import { copyStore } from './runtime.ts';

const CopyEditor = lazy(() => import('../../components/copyEditor/CopyEditor.tsx').then((m) => ({ default: m.CopyEditor })));

/** The owner (the server decides; this only picks what UI loads). */
export const canEditCopy = (me: Me | null | undefined): me is Me => !!me && me.canEditCopy === true;

// ------------------------------------------------------------------ the Profile switch

const switchListeners = new Set<() => void>();
const subscribeSwitch = (fn: () => void) => {
  switchListeners.add(fn);
  return () => switchListeners.delete(fn);
};

export const isCopyEditorOn = (): boolean => readItem(SWITCH_KEY) === '1';

export function setCopyEditorOn(on: boolean): void {
  writeItem(SWITCH_KEY, on ? '1' : null);
  if (!on) copyStore.setEditing(false);
  for (const fn of [...switchListeners]) fn();
}

export const useCopyEditorOn = (): boolean => useSyncExternalStore(subscribeSwitch, isCopyEditorOn, () => false);

// ------------------------------------------------------------------ the gate

/** A broken or unreachable editor chunk (offline) must never take the app down with it. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const ME_HASH = JSON.stringify(['me']);

/**
 * Who is signed in, straight from the query cache. Sign-out and account deletion call `qc.clear()`, which
 * removes the ['me'] query without telling its observers, so `useMe().data` here (beside the router, never
 * re-rendered by a navigation) would keep the owner until a reload. The cache itself always tells.
 */
export const readMe = (qc: QueryClient): Me | null | undefined => qc.getQueryData<Me | null>(['me']);
export const subscribeMe = (qc: QueryClient, onChange: () => void): (() => void) =>
  qc.getQueryCache().subscribe((e) => {
    if (e.query.queryHash === ME_HASH) onChange();
  });

export function CopyEditorGate() {
  useMe(); // keeps /auth/me fetched
  const qc = useQueryClient();
  const subscribe = useCallback((cb: () => void) => subscribeMe(qc, cb), [qc]);
  const me = useSyncExternalStore(subscribe, () => readMe(qc), () => undefined);
  const owner = canEditCopy(me) ? me.id : null;
  const on = useCopyEditorOn();

  useEffect(() => {
    if (owner && on) copyStore.openDrafts(owner);
    else copyStore.closeDrafts();
  }, [owner, on]);

  if (!owner || !on) return null;
  // Keyed by the owner: another account (or the same one after signing in again) gets a fresh editor,
  // with its own queries.
  return (
    <Quiet key={owner}>
      <Suspense fallback={null}>
        <CopyEditor userId={owner} />
      </Suspense>
    </Quiet>
  );
}
