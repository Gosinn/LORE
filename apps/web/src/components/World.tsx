import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { LoracleState } from '#shared';
import { api } from '../lib/api.ts';
import { readMe, subscribeMe } from '../lib/copy/gate.tsx';
import { useMe } from '../lib/queries.ts';
import { setSignedIn, setSunPoint, startLook, useLook, type SunPoint } from '../lib/theme.ts';

const pointOf = (state: LoracleState | undefined): SunPoint | null => {
  const realm = state?.settings?.realm;
  return realm ? { lat: realm.lat, lon: realm.lon } : null;
};

/**
 * Keeps the world in step (lib/theme.ts): the phone's light/dark switch, the app coming back to the front, and
 * the sun where the Lorer stands. Renders nothing: the backdrop is <div class="world"> in index.html, painted
 * before React starts (styles/worlds.css).
 *
 * "Follow the sun where I stand" needs the Loracle's home point (GET /loracle, settings.realm). It is asked
 * for once when that is the choice, never kept watched (every write in the app refreshes watched queries), and
 * picked up whenever the Loracle page loads it anyway. Signing out forgets it, and the device's signed-in hint
 * (the first paint's front door) follows who is signed in.
 *
 * Who is signed in is read from the query cache itself, as the copy gate does (lib/copy/gate.tsx): sign-out and
 * account deletion `qc.clear()` the ['me'] query without telling a `useMe()` observer, so `useMe().data` here,
 * beside the router, would keep the old Lorer (and their home point) until a reload.
 */
export function World() {
  const qc = useQueryClient();
  useMe(); // keeps /auth/me fetched
  const subscribe = useCallback((cb: () => void) => subscribeMe(qc, cb), [qc]);
  const me = useSyncExternalStore(subscribe, () => readMe(qc), () => undefined);
  const { daylight } = useLook();
  const known = me !== undefined;
  const signedIn = !!me;
  const signedOut = me === null;

  useEffect(() => startLook(), []);

  useEffect(
    () =>
      qc.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (event.type === 'updated' && event.action.type === 'success' && key.length === 1 && key[0] === 'loracle') {
          setSunPoint(pointOf(event.query.state.data as LoracleState | undefined));
        }
      }),
    [qc],
  );

  useEffect(() => {
    if (known) setSignedIn(signedIn);
  }, [known, signedIn]);

  useEffect(() => {
    if (signedOut) setSunPoint(null);
  }, [signedOut]);

  useEffect(() => {
    if (daylight !== 'sun' || !signedIn) return;
    qc.fetchQuery({ queryKey: ['loracle'], queryFn: () => api.get<LoracleState>('/loracle'), staleTime: 10 * 60_000 })
      .then((state) => setSunPoint(pointOf(state)))
      .catch(() => undefined);
  }, [daylight, signedIn, qc]);

  return null;
}
