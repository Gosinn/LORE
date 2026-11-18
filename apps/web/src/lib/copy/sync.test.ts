// Live text sync: unit tests (LIVE_TEXT_SPEC 5.3). The API module is mocked; storage is in memory.
// Run by `npm run test:copy`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashText } from '#shared/copy';

const get = vi.fn();
let listener: ((v: string) => void) | null = null;

vi.mock('../api.ts', () => ({
  api: { get: (path: string) => get(path) },
  isNative: false,
  onCopyVersion: (fn: ((v: string) => void) | null) => {
    listener = fn;
  },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: async () => undefined })) } }));

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const HOME = `pages/Home#${hashText('Home')}`;
let local: MemoryStorage;
let session: MemoryStorage;
let sync: typeof import('./sync.ts');
let rt: typeof import('./runtime.ts');

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(async () => {
  vi.useFakeTimers();
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  delete (globalThis as { __loreCopy?: unknown }).__loreCopy;
  vi.resetModules();
  get.mockReset();
  listener = null;
  rt = await import('./runtime.ts');
  sync = await import('./sync.ts');
});

afterEach(() => {
  sync.resetCopySyncForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('copy sync', () => {
  it('fetches at start, applies the words and caches them', async () => {
    get.mockResolvedValueOnce({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    sync.startCopySync();
    expect(get).toHaveBeenCalledWith('/copy');
    expect(listener).toBeTypeOf('function');
    await flush();
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');
    expect(JSON.parse(local.getItem('lore.copy')!)).toEqual({ version: 'v1', texts: { [HOME]: 'Hearth' } });
  });

  it('asks with ?v= and leaves everything alone when unchanged', async () => {
    rt.copyStore.apply({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    const tick = rt.__copyTick();
    get.mockResolvedValueOnce({ version: 'v1', unchanged: true });
    await sync.refreshCopy();
    expect(get).toHaveBeenCalledWith('/copy?v=v1');
    expect(rt.__copyTick()).toBe(tick);
  });

  it('refetches once, after a second, when response headers announce another version', async () => {
    get.mockResolvedValue({ version: 'v2', texts: { [HOME]: 'Camp' } });
    sync.noteCopyVersion('v2');
    sync.noteCopyVersion('v2');
    sync.noteCopyVersion('v2');
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(rt.__t(HOME, 'Home')).toBe('Camp');

    // The same version again (as on the fetch's own response): nothing to do.
    sync.noteCopyVersion('v2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('treats header 0 as "no edits" and doesn’t loop on a version the server can’t give yet', async () => {
    sync.noteCopyVersion('0');
    await vi.advanceTimersByTimeAsync(1000);
    expect(get).not.toHaveBeenCalled();

    get.mockResolvedValue({ version: 'v1', texts: {} });
    sync.noteCopyVersion('v3');
    await vi.advanceTimersByTimeAsync(1000);
    sync.noteCopyVersion('v3');
    await vi.advanceTimersByTimeAsync(1000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps one request in flight', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const a = sync.refreshCopy();
    const b = sync.refreshCopy();
    expect(get).toHaveBeenCalledTimes(1);
    resolve({ version: 'v1', texts: {} });
    await Promise.all([a, b]);
  });

  it('drops bad entries and keeps the words when offline', async () => {
    get.mockResolvedValueOnce({ version: 'v1', texts: { [HOME]: 'Hearth', 'no good': 'x', 'srv#00000000': 'a⁣b' } });
    await sync.refreshCopy();
    expect([...rt.copyStore.published().keys()]).toEqual([HOME]);

    get.mockRejectedValueOnce(new Error('offline'));
    await sync.refreshCopy();
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');
  });

  it('runs on the code’s words for the rest of a session that crashed', async () => {
    session.setItem('lore.copy.crashed', '1');
    get.mockResolvedValueOnce({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    await sync.refreshCopy();
    // Nothing fetched: words it would never show.
    expect(get).not.toHaveBeenCalled();
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    // A publish by the owner still applies explicitly.
    sync.applyCopyState({ version: 'v2', texts: { [HOME]: 'Camp' } });
    expect(rt.__t(HOME, 'Home')).toBe('Camp');
  });

  it('lets the editor catch up after a 409, even in a crashed session', async () => {
    session.setItem('lore.copy.crashed', '1');
    get.mockResolvedValueOnce({ version: 'v7', texts: { [HOME]: 'Camp' } });
    await sync.catchUpCopy();
    expect(get).toHaveBeenCalledWith('/copy');
    // The retry publishes on the version the server has now, not on a stale one.
    expect(rt.copyStore.version()).toBe('v7');
  });
});
