// Live text gate: who counts as signed in (LIVE_TEXT_SPEC 5.5). Run by `npm run test:copy`.
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from '#shared';

vi.mock('../api.ts', () => ({ api: { get: vi.fn() }, isNative: false, onCopyVersion: () => undefined }));
vi.mock('../queries.ts', () => ({ useMe: () => ({ data: undefined }) }));

const { canEditCopy, readMe, subscribeMe } = await import('./gate.tsx');

const owner = { id: 'u1', username: 'gosinn', canEditCopy: true } as unknown as Me;

describe('the gate reads who is signed in from the cache', () => {
  it('notices a sign-out that clears the cache, which a useMe observer misses', () => {
    const qc = new QueryClient();
    qc.setQueryData(['me'], owner);
    // What useMe() holds: an observer on the ['me'] query.
    const observer = new QueryObserver<Me | null>(qc, { queryKey: ['me'], enabled: false });
    const unobserve = observer.subscribe(() => undefined);
    const changed = vi.fn();
    const unsubscribe = subscribeMe(qc, changed);
    expect(canEditCopy(readMe(qc))).toBe(true);

    // Profile → Sign out (and account deletion): clear(), then me = null.
    qc.clear();
    qc.setQueryData(['me'], null);

    expect(changed).toHaveBeenCalled();
    expect(readMe(qc)).toBeNull();
    expect(canEditCopy(readMe(qc))).toBe(false);
    // The stale observer still says the owner: the reason the gate doesn't use it.
    expect(observer.getCurrentResult().data).toEqual(owner);

    // Someone else signs in on the same tab: never the owner's editor.
    qc.setQueryData(['me'], { ...owner, id: 'u2', username: 'guest', canEditCopy: false });
    expect(canEditCopy(readMe(qc))).toBe(false);
    unsubscribe();
    unobserve();
  });

  it('ignores other queries', () => {
    const qc = new QueryClient();
    const changed = vi.fn();
    const unsubscribe = subscribeMe(qc, changed);
    qc.setQueryData(['copy-admin'], { version: null });
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });
});
