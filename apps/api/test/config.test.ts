import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

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
});
