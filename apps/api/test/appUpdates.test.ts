// Live updates for the Android app: the update check, and the zipped web app.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.ts';

const BUILD = '202610190900-abc123';
let t: TestApp;
let publicDir: string;

/** Reads a zip back (central directory → local entries), checking every CRC. */
function readZip(zip: Buffer): Map<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + size));
    expect(crc32(data)).toBe(crc);
    files.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  return files;
}

beforeAll(async () => {
  publicDir = mkdtempSync(path.join(tmpdir(), 'lore-public-'));
  mkdirSync(path.join(publicDir, 'assets'));
  writeFileSync(path.join(publicDir, 'build.json'), JSON.stringify({ build: BUILD, version: '0.2.0' }));
  writeFileSync(path.join(publicDir, 'index.html'), '<head><meta name="lore-api-base" content="" /></head>');
  writeFileSync(path.join(publicDir, 'assets', 'app-x1.js'), 'console.log("LORE")');
  t = await createTestApp({ config: { publicDir } });
});
afterAll(async () => {
  await t.close();
  rmSync(publicDir, { recursive: true, force: true });
});

const check = (body: object) => t.app.inject({ method: 'POST', url: '/api/app/updates', payload: body });

describe('live updates', () => {
  it('offers the current web build to an app running anything else', async () => {
    const res = await check({ app_id: 'com.gosinn.lore', version_name: 'builtin', platform: 'android' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.version).toBe(BUILD);
    expect(body.url).toMatch(new RegExp(`/api/app/bundle/${BUILD}\\.zip$`));
    expect(body.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says up to date when the app already runs this build, or for other apps', async () => {
    for (const body of [{ app_id: 'com.gosinn.lore', version_name: BUILD }, { app_id: 'com.example.other' }]) {
      const res = JSON.parse((await check(body)).body);
      expect(res).toMatchObject({ error: 'no_new_version_available', kind: 'up_to_date' });
    }
  });

  it('serves the zipped web app, pointed at this server, matching its checksum', async () => {
    const { checksum, url } = JSON.parse((await check({ app_id: 'com.gosinn.lore', version_name: 'builtin' })).body);
    const res = await t.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(checksum);

    const files = readZip(res.rawPayload);
    expect([...files.keys()]).toEqual(['assets/app-x1.js', 'build.json', 'index.html']);
    expect(files.get('index.html')).toMatch(/<meta name="lore-api-base" content="http:\/\/localhost[^"]*" \/>/);
    expect(files.get('assets/app-x1.js')).toBe('console.log("LORE")');
  });

  it('refuses bundles it does not have', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/app/bundle/old-build.zip' });
    expect(res.statusCode).toBe(404);
  });

  it('reports its build', async () => {
    expect(JSON.parse((await t.app.inject({ method: 'GET', url: '/api/app/version' })).body)).toEqual({ build: BUILD });
  });
});
