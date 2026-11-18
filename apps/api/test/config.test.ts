import { describe, expect, it } from 'vitest';
import { loadConfig, OWNER_DEFAULT, testConfig } from '../src/config.ts';

describe('configuration', () => {
  it('picks free-tier defaults on Render, so only DATABASE_URL is needed', () => {
    const c = loadConfig({ NODE_ENV: 'production', RENDER: 'true', DATABASE_URL: 'postgres://u:p@h/db' });
    expect(c).toMatchObject({ mediaStorage: 'database', trustProxy: true, scryptCost: 2 ** 15, scryptParallelism: 3 });
    expect(c.mediaUrlSecret).toMatch(/^[0-9a-f]{64}$/);
    // Stable across restarts, different per database.
    expect(loadConfig({ RENDER: 'true', DATABASE_URL: 'postgres://u:p@h/db' }).mediaUrlSecret).toBe(c.mediaUrlSecret);
    expect(loadConfig({ RENDER: 'true', DATABASE_URL: 'postgres://u:p@h/other' }).mediaUrlSecret).not.toBe(c.mediaUrlSecret);
  });

  it('keeps the regular defaults elsewhere, and explicit settings always win', () => {
    expect(loadConfig({})).toMatchObject({ mediaStorage: 'disk', trustProxy: false, scryptCost: 2 ** 17, scryptParallelism: 1 });
    expect(loadConfig({ RENDER: 'true', MEDIA_STORAGE: 'disk', TRUST_PROXY: 'false' })).toMatchObject({
      mediaStorage: 'disk',
      trustProxy: false,
    });
  });
  it('makes gosinn the owner when ADMIN_USERNAMES is unset, with the cut-off on real servers', () => {
    const cutoff = OWNER_DEFAULT.createdBefore;
    expect(cutoff.toISOString()).toBe('2026-11-19T00:00:00.000Z');
    expect(loadConfig({ NODE_ENV: 'production' })).toMatchObject({
      adminUsernames: [],
      ownerDefault: { username: 'gosinn', createdBefore: cutoff },
    });
    // A server that forgot NODE_ENV still gets the cut-off (Render, or any real database).
    expect(loadConfig({ RENDER: 'true' }).ownerDefault?.createdBefore).toEqual(cutoff);
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' }).ownerDefault?.createdBefore).toEqual(cutoff);
    // Local development data: no cut-off.
    expect(loadConfig({}).ownerDefault).toEqual({ username: 'gosinn', createdBefore: null });
    expect(loadConfig({ NODE_ENV: 'test' }).ownerDefault).toEqual({ username: 'gosinn', createdBefore: null });
  });

  it('keeps ADMIN_USERNAMES exactly as set: empty means nobody, a list means those (no cut-off)', () => {
    expect(loadConfig({ NODE_ENV: 'production', ADMIN_USERNAMES: '' })).toMatchObject({ adminUsernames: [], ownerDefault: null });
    expect(loadConfig({ NODE_ENV: 'production', ADMIN_USERNAMES: ' Gosinn, mod ' })).toMatchObject({
      adminUsernames: ['gosinn', 'mod'],
      ownerDefault: null,
    });
    // Tests start with nobody as owner.
    expect(testConfig()).toMatchObject({ adminUsernames: [], ownerDefault: null });
  });

  it('switches live text off with COPY_OVERRIDES=off', () => {
    expect(loadConfig({}).copyOverrides).toBe(true);
    expect(loadConfig({ COPY_OVERRIDES: 'on' }).copyOverrides).toBe(true);
    expect(loadConfig({ COPY_OVERRIDES: 'off' }).copyOverrides).toBe(false);
  });

  it('reads the kill switch leniently and fails safe (typed in a hurry, it must never stop the boot)', () => {
    for (const on of ['', ' ', 'on', 'ON', ' On ', 'true', '1', 'yes']) {
      expect(loadConfig({ COPY_OVERRIDES: on }).copyOverrides, JSON.stringify(on)).toBe(true);
    }
    for (const off of ['OFF', 'Off', ' off', 'off ', 'false', '0', 'no', 'maybe']) {
      expect(() => loadConfig({ COPY_OVERRIDES: off }), JSON.stringify(off)).not.toThrow();
      expect(loadConfig({ COPY_OVERRIDES: off }).copyOverrides, JSON.stringify(off)).toBe(false);
    }
  });
});
