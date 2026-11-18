// Live text: the owner changes LORE's words in the app and publishes them (routes/copy.ts,
// lib/copy.ts). Each part runs on its own database: publishing has per-minute and per-hour limits.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { copy, copyKey, LORACLE_LINES, signLine, type CopyCatalog } from '#shared';
import { buildApp } from '../src/app.ts';
import { OWNER_DEFAULT, testConfig, type Config } from '../src/config.ts';
import { copyOverrides, copyRevisions, copyState, users } from '../src/db/schema.ts';
import type { Db } from '../src/db/index.ts';
import { ownerStartupNote } from '../src/lib/access.ts';
import { createLiveCopy } from '../src/lib/copy.ts';
import { DatabaseStorage } from '../src/lib/storage.ts';
import { createTestApp, quietWorld, type Client, type TestApp } from './helpers.ts';

type T = TestApp & { db: Db };

const UUID = /^[0-9a-f-]{36}$/;
const k = (scope: string, text: string) => copyKey(scope, text);
const enc = encodeURIComponent;

/** Publishes as `c`, always on the version it last saw (like the editor). */
function publisher(c: Client) {
  let version: string | null = null;
  return {
    get version() {
      return version;
    },
    set version(v: string | null) {
      version = v;
    },
    async put(body: { set?: unknown[]; revert?: string[] }, base: string | null = version) {
      const res = await c.put('/api/admin/copy', { baseVersion: base, ...body });
      if (res.status === 200) version = res.body.version;
      return res;
    },
    async undo(revisionId: string, base: string | null = version) {
      const res = await c.post('/api/admin/copy/undo', { revisionId, baseVersion: base });
      if (res.status === 200) version = res.body.version;
      return res;
    },
  };
}

const item = (scope: string, original: string, text: string, context: string | null = null) => ({
  key: k(scope, original),
  text,
  original,
  context,
});

/** A second app over the same database (another boot, another server, another build). */
async function bootAnother(db: Db, config: Partial<Config>, copyCatalog?: CopyCatalog | null): Promise<FastifyInstance> {
  const app = await buildApp({
    db,
    config: testConfig(config),
    storage: new DatabaseStorage(db),
    world: quietWorld,
    ...(copyCatalog === undefined ? {} : { copyCatalog }),
  });
  await app.ready();
  return app;
}

const inject = (app: FastifyInstance, method: 'GET' | 'PUT' | 'POST', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });

// ---------------------------------------------------------------------------

describe('live text: publishing', () => {
  let t: T;
  let keeper: Client;
  let ana: Client;
  let pub: ReturnType<typeof publisher>;
  const home = item('pages/Home', 'Welcome back', 'Welcome home, wanderer', 'Home › h1');

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['keeper'] } });
    keeper = await t.signUp('keeper', 'Keeper');
    ana = await t.signUp('anna');
    pub = publisher(keeper);
  });
  afterAll(() => t.close());

  it('serves the published words to anyone, signed out, with the version on every API response', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/copy' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ version: null, texts: {} });
    expect(res.headers['x-lore-copy']).toBe('0');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(JSON.parse((await t.app.inject({ method: 'GET', url: '/api/copy?v=0' })).body)).toEqual({ version: null, unchanged: true });

    for (const url of ['/api/health', '/api/nowhere', '/api/auth/me', '/api/events']) {
      expect((await t.app.inject({ method: 'GET', url })).headers['x-lore-copy']).toBe('0');
    }
    // The native apps (another origin) may read it.
    const native = await t.app.inject({ method: 'GET', url: '/api/copy', headers: { origin: 'https://localhost' } });
    expect(native.headers['access-control-expose-headers']).toBe('x-lore-copy');
  });

  it('keeps the editor and its routes to the owner', async () => {
    expect((await keeper.get('/api/auth/me')).body).toMatchObject({ isAdmin: true, canEditCopy: true });
    expect((await ana.get('/api/auth/me')).body).toMatchObject({ isAdmin: false, canEditCopy: false });
    expect(keeper.user.canEditCopy).toBe(true);

    expect((await ana.get('/api/admin/copy')).status).toBe(404);
    expect((await ana.get(`/api/admin/copy/history?key=${enc(home.key)}`)).status).toBe(404);
    expect((await ana.put('/api/admin/copy', { nonsense: true })).status).toBe(404);
    expect((await ana.put('/api/admin/copy', { baseVersion: null, set: [home] })).status).toBe(404);
    expect((await ana.post('/api/admin/copy/undo', { revisionId: randomUUID(), baseVersion: null })).status).toBe(404);

    expect((await t.app.inject({ method: 'GET', url: '/api/admin/copy' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'PUT', url: '/api/admin/copy', payload: { baseVersion: null, set: [home] } })).statusCode).toBe(401);

    // Another site can't publish with the owner's cookie.
    const crossSite = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/copy',
      headers: { cookie: keeper.cookie, origin: 'https://evil.example' },
      payload: { baseVersion: null, set: [home] },
    });
    expect(crossSite.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/copy' })).headers['x-lore-copy']).toBe('0');
  });

  it('publishes in one revision, bumps the version everywhere, and refuses a stale base', async () => {
    const res = await pub.put({ set: [home] });
    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(UUID);
    expect(res.body.revisionId).toBe(res.body.version);
    expect(res.body.texts).toEqual({ [home.key]: 'Welcome home, wanderer' });
    expect(res.headers['x-lore-copy']).toBe(res.body.version);

    const pub1 = await t.app.inject({ method: 'GET', url: '/api/copy' });
    expect(JSON.parse(pub1.body)).toEqual({ version: res.body.version, texts: { [home.key]: 'Welcome home, wanderer' } });
    expect(pub1.headers['x-lore-copy']).toBe(res.body.version);
    expect((await ana.get('/api/events')).headers['x-lore-copy']).toBe(res.body.version);
    expect((await ana.get(`/api/copy?v=${res.body.version}`)).body).toEqual({ version: res.body.version, unchanged: true });

    // Edited on an older version (another device): 409, nothing changes.
    const stale = await pub.put({ set: [{ ...home, text: 'Lost words' }] }, null);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('copy_stale');

    const admin = (await keeper.get('/api/admin/copy')).body;
    expect(admin).toMatchObject({ version: res.body.version, enabled: true, catalogBuild: null, catalogChecked: false });
    expect(admin.overrides).toEqual([
      {
        key: home.key,
        text: 'Welcome home, wanderer',
        original: 'Welcome back',
        context: 'Home › h1',
        followedFrom: null,
        updatedAt: expect.any(String),
        updatedBy: expect.objectContaining({ id: keeper.user.id, username: 'keeper' }),
      },
    ]);
    expect(admin.revisions).toEqual([
      {
        id: res.body.version,
        kind: 'publish',
        publishedBy: expect.objectContaining({ username: 'keeper' }),
        undoOf: null,
        changes: [{ key: home.key, before: null, after: 'Welcome home, wanderer', original: 'Welcome back', context: 'Home › h1' }],
        createdAt: expect.any(String),
      },
    ]);
  });

  it('never puts anyone’s data, or anything but the words, in the public answer', async () => {
    const body = (await t.app.inject({ method: 'GET', url: '/api/copy' })).body;
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['texts', 'version']);
    for (const secret of [keeper.user.id, 'keeper', 'keeper@example.test', 'Welcome back', 'Home › h1']) {
      expect(body).not.toContain(secret);
    }
  });

  it('goes back to the code’s words (revert, or the original typed again) and keeps each text’s history', async () => {
    expect((await pub.put({ set: [{ ...home, text: 'Welcome home again' }] })).status).toBe(200);
    const same = await pub.put({ set: [{ ...home, text: '  Welcome back ' }] });
    expect(same.status).toBe(200);
    expect(same.body.texts).toEqual({});
    expect((await pub.put({ set: [{ ...home, text: 'Third words' }] })).body.texts).toEqual({ [home.key]: 'Third words' });
    const reverted = await pub.put({ revert: [home.key] });
    expect(reverted.body.texts).toEqual({});
    expect(await t.db.select().from(copyOverrides)).toEqual([]);

    // Nothing to change: no revision, same version.
    const before = pub.version;
    const noop = await pub.put({ revert: [home.key] });
    expect(noop.status).toBe(200);
    expect(noop.body).toMatchObject({ revisionId: null, version: before });

    const history = await keeper.get(`/api/admin/copy/history?key=${enc(home.key)}`);
    expect(history.status).toBe(200);
    expect(history.body.key).toBe(home.key);
    expect(history.body.entries.map((e: { before: string | null; after: string | null }) => [e.before, e.after])).toEqual([
      ['Third words', null],
      [null, 'Third words'],
      ['Welcome home again', null],
      ['Welcome home, wanderer', 'Welcome home again'],
      [null, 'Welcome home, wanderer'],
    ]);
    expect(history.body.entries[0]).toMatchObject({ kind: 'publish', publishedBy: { username: 'keeper' } });
    expect((await keeper.get('/api/admin/copy/history?key=nope')).status).toBe(400);
  });

  it('undoes a publish, leaving texts that changed again since', async () => {
    const a = item('pages/Profile', 'Help', 'Ask the elders');
    const b = item('pages/Profile', 'Sign out', 'Leave the camp');
    const first = await pub.put({ set: [a, b] });
    const firstId = first.body.revisionId as string;
    await pub.put({ set: [{ ...b, text: 'Break camp' }] });

    expect((await pub.undo(firstId, null)).status).toBe(409);
    expect((await pub.undo(randomUUID())).status).toBe(404);

    const undone = await pub.undo(firstId);
    expect(undone.status).toBe(200);
    expect(undone.body.skipped).toEqual([b.key]);
    expect(undone.body.texts).toEqual({ [b.key]: 'Break camp' });
    const [rev] = (await keeper.get('/api/admin/copy')).body.revisions;
    expect(rev).toMatchObject({ kind: 'undo', undoOf: firstId, changes: [{ key: a.key, before: 'Ask the elders', after: null }] });

    // Undoing the undo brings the words back.
    expect((await pub.undo(rev.id)).body.texts).toEqual({ [a.key]: 'Ask the elders', [b.key]: 'Break camp' });
    // Taking the first publish back again only touches what still holds its words.
    const again = await pub.undo(firstId);
    expect(again.body).toMatchObject({ skipped: [b.key], texts: { [b.key]: 'Break camp' } });
    // Nothing left to take back: no revision.
    const noop = await pub.undo(firstId);
    expect(noop.body).toMatchObject({ revisionId: null, skipped: [a.key, b.key] });
  });
});

// ---------------------------------------------------------------------------

describe('live text: checking words before they go live', () => {
  let t: T;
  let pub: ReturnType<typeof publisher>;

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['keeper'] } });
    pub = publisher(await t.signUp('keeper'));
  });
  afterAll(() => t.close());

  const refused = async (set: unknown[], field?: string) => {
    const res = await pub.put({ set });
    expect(res.status).toBe(400);
    return field ? res.body.error.fields[field] : res.body.error.message;
  };

  it('refuses malformed keys, foreign originals and odd batches', async () => {
    expect(await refused([{ key: 'nope', text: 'x', original: 'y' }], 'set.0.key')).toBeTruthy();
    expect(await refused([{ ...item('pages/Home', 'Create', 'Make'), original: 'Something else' }], 'set.0.original')).toMatch(/belong/);
    expect((await pub.put({ set: [] })).status).toBe(400);
    const twice = item('pages/Home', 'Create', 'Make');
    expect((await pub.put({ set: [twice], revert: [twice.key] })).status).toBe(400);
    const many = Array.from({ length: 301 }, (_, i) => item('pages/Many', `Text ${i}`, `Words ${i}`));
    expect((await pub.put({ set: many })).status).toBe(400);
  });

  it('refuses empty, overlong, invisible, multi-line and script-scheme words', async () => {
    expect(await refused([item('pages/Home', 'Create', '   ')], 'set.0.text')).toBe('Can’t be empty.');
    expect(await refused([item('pages/Home', 'Create', 'x'.repeat(4001))], 'set.0.text')).toBe('Too long.');
    // Tag characters (invisible ASCII: "Ig"), a line separator, LRM, a variation selector supplement, U+2065.
    const hidden = ['I wish\u{E0049}\u{E0067}', 'a\u2028b', 'left\u200Eright', 'han\u{E0100}', 'odd\u2065', 'note\uFFF9'];
    for (const bad of ['bell\u0007', 'flip‮ped', 'mark⁣⁠⁤ed', 'zero​width', 'bom﻿', ...hidden]) {
      expect(await refused([item('pages/Home', 'Create', bad)], 'set.0.text')).toBe('Invisible or control characters aren’t allowed.');
    }
    // The context is shown in the editor and handed to Claude: no hidden characters there either.
    expect((await pub.put({ set: [{ ...item('pages/Home', 'Create', 'Make'), context: 'Home\u{E0049}' }] })).status).toBe(400);
    expect(await refused([item('pages/Home', 'Create', 'two\nlines')], 'set.0.text')).toBe('One line only.');
    expect(await refused([item('pages/Home', 'Create', 'javascript:alert(1)')], 'set.0.text')).toMatch(/javascript/);
  });

  it('keeps placeholders, and tags only where the default has them (no catalog)', async () => {
    expect(await refused([item('pages/Home', 'Hi {name}', 'Hello there')], 'set.0.text')).toBe('Keep {name} in the text.');
    expect(await refused([item('pages/Home', 'Hi {name}', '{name}, {name}!')], 'set.0.text')).toMatch(/as often/);
    expect(await refused([item('pages/Home', 'Now this', 'Now <em>this</em>')], 'set.0.text')).toMatch(/Plain words/);
    expect(await refused([item('pages/Home', 'Now <em>this</em>', 'Now <em>that')], 'set.0.text')).toBe('Close the <em> you opened.');
  });

  it('accepts real words: emoji joiners, other scripts, kept placeholders, “<script>” as plain text', async () => {
    const res = await pub.put({
      set: [
        item('pages/Home', 'Family', 'Family 👨‍👩‍👧'),
        item('pages/Home', 'Hi {name}', 'Ahoy, {name}!'),
        item('pages/Home', 'Now <em>this</em>', 'Now <strong>that</strong><br/>too'),
        item('pages/Home', 'First\nSecond', 'One\nTwo'),
        item('pages/Legal', 'Terms', '<script>alert(1)</script>'),
        item('pages/Home', 'Wish', 'می‌خواهم'),
      ],
    });
    expect(res.status).toBe(200);
    expect(Object.values(res.body.texts)).toEqual(
      expect.arrayContaining(['Family 👨‍👩‍👧', 'Ahoy, {name}!', '<script>alert(1)</script>', 'One\nTwo', 'می‌خواهم']),
    );
    // Stored normalized: NFC, edges off.
    const cafe = await pub.put({ set: [item('pages/Home', 'Coffee', '  Café \r\n')] });
    expect(cafe.body.texts[k('pages/Home', 'Coffee')]).toBe('Café');
  });
});

// ---------------------------------------------------------------------------

describe('live text: the server speaks the published words', () => {
  let t: T;
  let keeper: Client;
  let pub: ReturnType<typeof publisher>;

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['keeper'] } });
    keeper = await t.signUp('keeper');
    pub = publisher(keeper);
  });
  afterAll(() => t.close());

  it('in static error messages and their fields', async () => {
    expect(
      (
        await pub.put({
          set: [
            item('srv', 'That event could not be found.', 'No such adventure here.'),
            item('srv', 'Use at least 10 characters', 'Ten letters at least, traveller'),
          ],
        })
      ).status,
    ).toBe(200);
    const missing = await keeper.get(`/api/events/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('No such adventure here.');

    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'shorty', displayName: 'S', email: 'shorty@example.test', password: 'short', acceptTerms: true },
    });
    expect(reg.statusCode).toBe(400);
    expect(JSON.parse(reg.body).error.fields.password).toBe('Ten letters at least, traveller');
  });

  it('in notification titles, with Lorers’ names only ever filled in', async () => {
    expect((await pub.put({ set: [item('srv', '{actor} wants to be friends', '{actor} would walk the road with you')] })).status).toBe(200);
    const ana = await t.signUp('anna', 'Ana');
    const bea = await t.signUp('bea');
    expect((await ana.post('/api/friends/requests', { username: 'bea' })).status).toBe(201);
    const [n] = (await bea.get('/api/notifications')).body;
    expect(n.title).toBe('Ana would walk the road with you');
    // The public words hold the template, never the name.
    expect((await t.app.inject({ method: 'GET', url: '/api/copy' })).body).not.toContain('Ana');
  });

  it('in vocabulary lines the server sends, and never a broken override', async () => {
    expect((await pub.put({ set: [item('shared/vocabulary', LORACLE_LINES.asleep, 'The stone dozes.')] })).status).toBe(200);
    expect(t.app.liveCopy.say(LORACLE_LINES.asleep)).toBe('The stone dozes.');
    expect(t.app.liveCopy.say('Something nobody edited.')).toBe('Something nobody edited.');

    // A row that slipped past the checks (hand-edited database) is ignored, not shown.
    await t.db.insert(copyOverrides).values({ key: k('srv', '{title} was canceled'), text: 'Cancelled!', original: '{title} was canceled' });
    await t.app.liveCopy.load();
    expect(copy('{title} was canceled', { title: 'Hike' })).toBe('Hike was canceled');
  });

  it('in the stone’s signs written into new roads', async () => {
    expect(
      (
        await pub.put({
          set: [
            item('srv', 'The stone listens…', 'The stone hears you…'),
            item('srv', 'It asks the roads about {words}', 'It asks every road about {words}'),
          ],
        })
      ).status,
    ).toBe(200);
    expect(signLine({ kind: 'listening' })).toBe('The stone hears you…');
    // The road's words keep their own end (clip adds the full stop or an ellipsis).
    expect(signLine({ kind: 'search', query: 'Kjölur highland route' })).toBe('It asks every road about Kjölur highland route.');
    expect(signLine({ kind: 'name' })).toBe('A name keeps coming up.');
  });

  it('caps publishing per hour, and keeps the words when the publisher’s account goes', async () => {
    await t.db
      .insert(copyRevisions)
      .values(Array.from({ length: 20 }, () => ({ kind: 'publish' as const, publishedBy: keeper.user.id, changes: [] })));
    const capped = await pub.put({ set: [item('pages/Home', 'Create', 'Make')] });
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('rate_limited');

    const del = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: keeper.cookie },
      payload: { password: 'correct horse battery' },
    });
    expect(del.statusCode).toBe(200);
    const rows = await t.db.select().from(copyOverrides);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.updatedBy === null)).toBe(true);
    const revs = await t.db.select().from(copyRevisions);
    expect(revs.every((r) => r.publishedBy === null)).toBe(true);
    expect(JSON.parse((await t.app.inject({ method: 'GET', url: '/api/copy' })).body).texts[k('srv', 'That event could not be found.')]).toBe(
      'No such adventure here.',
    );
  });
});

// ---------------------------------------------------------------------------

describe('live text: the kill switch', () => {
  let t: T;
  let keeper: Client;

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['keeper'], copyOverrides: false } });
    keeper = await t.signUp('keeper');
  });
  afterAll(() => t.close());

  it('COPY_OVERRIDES=off shows the code’s words and refuses to publish', async () => {
    const version = randomUUID();
    await t.db.insert(copyOverrides).values({ key: k('srv', 'Not found.'), text: 'Gone.', original: 'Not found.' });
    await t.db.update(copyState).set({ version }).where(eq(copyState.id, 1));
    await t.app.liveCopy.load();

    const res = await t.app.inject({ method: 'GET', url: '/api/copy' });
    expect(JSON.parse(res.body)).toEqual({ version: null, texts: {} });
    expect(res.headers['x-lore-copy']).toBe('0');
    expect(JSON.parse((await t.app.inject({ method: 'GET', url: '/api/nowhere' })).body).error.message).toBe('Not found.');

    const put = await keeper.put('/api/admin/copy', { baseVersion: version, set: [item('pages/Home', 'Create', 'Make')] });
    expect(put.status).toBe(503);
    expect(put.body.error).toMatchObject({ code: 'copy_off', message: 'Live text is switched off on the server.' });
    expect((await keeper.post('/api/admin/copy/undo', { revisionId: version, baseVersion: version })).status).toBe(503);
    expect((await keeper.get('/api/admin/copy')).body).toMatchObject({ enabled: false, version: null });
  });
});

// ---------------------------------------------------------------------------

describe('live text: the served build’s catalog (production)', () => {
  let t: T;
  let keeper: Client;
  let withCatalog: FastifyInstance;
  let withoutCatalog: FastifyInstance;
  const dirs: string[] = [];
  const save = { scope: 'components/ui', text: 'Save' };
  const story = { scope: 'pages/Chapter', text: 'Read the story' };
  const catalog: CopyCatalog = {
    build: 'build-42',
    keys: {
      [k(save.scope, save.text)]: { text: save.text, kind: 's', ctx: 'Button' },
      [k(story.scope, story.text)]: { text: story.text, kind: 'n', ctx: 'Chapter › p' },
    },
  };

  beforeAll(async () => {
    t = await createTestApp();
    keeper = await t.signUp('keeper');
    const served = mkdtempSync(path.join(tmpdir(), 'lore-copy-'));
    const empty = mkdtempSync(path.join(tmpdir(), 'lore-copy-'));
    dirs.push(served, empty);
    writeFileSync(path.join(served, 'copy-catalog.json'), JSON.stringify(catalog));
    // Read from PUBLIC_DIR, as on the live server.
    withCatalog = await bootAnother(t.db, { env: 'production', publicDir: served, adminUsernames: ['keeper'] });
    withoutCatalog = await bootAnother(t.db, { env: 'production', publicDir: empty, adminUsernames: ['keeper'] });
  });
  afterAll(async () => {
    await withCatalog.close();
    await withoutCatalog.close();
    await t.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const publish = (app: FastifyInstance, body: object) => inject(app, 'PUT', '/api/admin/copy', keeper.cookie, body);

  it('only takes texts this build has, with the kind it has them', async () => {
    const admin = JSON.parse((await inject(withCatalog, 'GET', '/api/admin/copy', keeper.cookie)).body);
    expect(admin).toMatchObject({ catalogBuild: 'build-42', catalogChecked: true });

    const unknown = await publish(withCatalog, { baseVersion: null, set: [item('pages/Gone', 'Old words', 'New words')] });
    expect(unknown.statusCode).toBe(400);
    expect(JSON.parse(unknown.body).error.code).toBe('copy_unknown_key');

    // A string-kind text may not gain emphasis; page content may, even when the default has none.
    const plain = await publish(withCatalog, { baseVersion: null, set: [item(save.scope, save.text, '<em>Keep</em> it')] });
    expect(plain.statusCode).toBe(400);
    const rich = await publish(withCatalog, { baseVersion: null, set: [item(story.scope, story.text, 'Read <em>the</em> tale', null)] });
    expect(rich.statusCode).toBe(200);
    const body = JSON.parse(rich.body);
    expect(body.texts).toEqual({ [k(story.scope, story.text)]: 'Read <em>the</em> tale' });
    // The context comes from the catalog when the editor sends none.
    const [row] = await t.db.select().from(copyOverrides);
    expect(row).toMatchObject({ context: 'Chapter › p', original: 'Read the story' });

    // Orphans can always go back to the code's words.
    const revert = await publish(withCatalog, { baseVersion: body.version, revert: [k('pages/Gone', 'Old words')] });
    expect(revert.statusCode).toBe(200);
  });

  it('without a catalog it refuses new words (503) but still allows reverts', async () => {
    const [state] = await t.db.select().from(copyState);
    const version = state!.version;
    const res = await publish(withoutCatalog, { baseVersion: version, set: [item(save.scope, save.text, 'Keep')] });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('copy_catalog_missing');
    const revert = await publish(withoutCatalog, { baseVersion: version, revert: [k(story.scope, story.text)] });
    expect(revert.statusCode).toBe(200);
    expect(JSON.parse(revert.body).texts).toEqual({});
  });

  it('development and tests skip the check (a dev API may see an old build)', () => {
    const dev = createLiveCopy({ db: t.db, config: { env: 'development', copyOverrides: true }, catalog });
    expect(dev.checkCatalog).toBe(false);
    expect(t.app.liveCopy.checkCatalog).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('live text: words follow their text after a deploy', () => {
  let t: T;
  let next: FastifyInstance;
  let served = '';
  const moved = { from: k('pages/Old', 'Begin the quest'), to: k('pages/New', 'Begin the quest') };
  const ambiguous = k('pages/Old', 'Cancel');
  const taken = { from: k('pages/Old', 'Taken'), to: k('pages/New', 'Taken') };
  // "Copy for Claude" baked AppShell's 'Profile' → 'Me' into the code; pages/Profile still says 'Profile'.
  const baked = { from: k('components/AppShell', 'Profile'), now: k('components/AppShell', 'Me'), other: k('pages/Profile', 'Profile') };
  const catalog: CopyCatalog = {
    build: 'build-43',
    keys: {
      [moved.to]: { text: 'Begin the quest', kind: 'n', ctx: 'New page › button' },
      [k('pages/A', 'Cancel')]: { text: 'Cancel', kind: 's' },
      [k('pages/B', 'Cancel')]: { text: 'Cancel', kind: 's' },
      [taken.to]: { text: 'Taken', kind: 's' },
      [baked.now]: { text: 'Me', kind: 's' },
      [baked.other]: { text: 'Profile', kind: 's' },
    },
  };

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['keeper'] } });
    const keeper = await t.signUp('keeper');
    await t.db.insert(copyOverrides).values([
      { key: moved.from, text: 'Start the adventure', original: 'Begin the quest', context: 'Old page', updatedBy: keeper.user.id },
      { key: ambiguous, text: 'Turn back', original: 'Cancel' },
      { key: taken.from, text: 'Old taken words', original: 'Taken' },
      { key: taken.to, text: 'Words already here', original: 'Taken' },
      { key: baked.from, text: 'Me', original: 'Profile' },
    ]);
    // The next deploy boots with a build where 'Begin the quest' moved to pages/New.
    served = mkdtempSync(path.join(tmpdir(), 'lore-copy-'));
    next = await bootAnother(t.db, { env: 'production', publicDir: served, adminUsernames: ['keeper'] }, catalog);
  });
  afterAll(async () => {
    await next.close();
    await t.close();
    rmSync(served, { recursive: true, force: true });
  });

  it('re-attaches orphaned words to the one new home of their text, once', async () => {
    const rows = new Map((await t.db.select().from(copyOverrides)).map((r) => [r.key, r]));
    expect(rows.get(moved.to)).toMatchObject({ text: 'Start the adventure', followedFrom: moved.from, context: 'New page › button' });
    expect(rows.get(moved.from)?.text).toBe('Start the adventure'); // kept for older native builds
    expect(rows.get(taken.to)?.text).toBe('Words already here');
    expect([...rows.keys()].filter((key) => key.startsWith('pages/A') || key.startsWith('pages/B'))).toEqual([]);

    const revs = await t.db.select().from(copyRevisions);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ kind: 'follow', publishedBy: null, changes: [{ key: moved.to, before: null, after: 'Start the adventure' }] });
    const [state] = await t.db.select().from(copyState);
    expect(state!.version).toBe(revs[0]!.id);
    expect(JSON.parse((await inject(next, 'GET', '/api/copy')).body).texts[moved.to]).toBe('Start the adventure');

    expect(await next.liveCopy.followMoved()).toEqual({ followed: [], ambiguous: [ambiguous] });
  });

  it('never follows words already baked into the code onto another file with the same default', async () => {
    const rows = new Map((await t.db.select().from(copyOverrides)).map((r) => [r.key, r]));
    expect(rows.get(baked.other)).toBeUndefined(); // the Profile page title stays 'Profile'
    expect(rows.get(baked.from)?.text).toBe('Me'); // the old row waits for Clean up
  });

  it('another instance picks the change up within 30 seconds of a request', async () => {
    // t.app booted before the follow: its snapshot is older.
    expect(JSON.parse((await inject(t.app, 'GET', '/api/copy')).body).texts[moved.to]).toBeUndefined();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    try {
      const res = await inject(t.app, 'GET', '/api/copy');
      expect(JSON.parse(res.body).texts[moved.to]).toBe('Start the adventure');
    } finally {
      clock.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------

describe('the owner: ADMIN_USERNAMES, or gosinn from before the cut-off', () => {
  let t: T;
  let gosinn: Client;

  beforeAll(async () => {
    t = await createTestApp({ config: { ownerDefault: { ...OWNER_DEFAULT } } });
    gosinn = await t.signUp('gosinn');
  });
  afterAll(() => t.close());

  const createdOn = (iso: string) => t.db.update(users).set({ createdAt: new Date(iso) }).where(eq(users.id, gosinn.user.id));

  it('is the gosinn account created before the cut-off', async () => {
    await createdOn('2026-01-01T00:00:00Z');
    expect((await gosinn.get('/api/auth/me')).body).toMatchObject({ isAdmin: true, canEditCopy: true });
    expect((await gosinn.get('/api/admin/copy')).status).toBe(200);
    expect((await gosinn.get('/api/admin/summary')).status).toBe(200);
    expect(await ownerStartupNote(t.db, { adminUsernames: [], ownerDefault: OWNER_DEFAULT })).toEqual({
      level: 'info',
      message: 'Owner: gosinn (default; set ADMIN_USERNAMES to change)',
    });
  });

  it('is never a gosinn created after it (a re-taken name, a fresh database)', async () => {
    await createdOn('2026-11-19T00:00:01Z');
    expect((await gosinn.get('/api/auth/me')).body).toMatchObject({ isAdmin: false, canEditCopy: false });
    expect((await gosinn.get('/api/admin/copy')).status).toBe(404);
    expect((await gosinn.get('/api/admin/summary')).status).toBe(404);
    expect((await ownerStartupNote(t.db, { adminUsernames: [], ownerDefault: OWNER_DEFAULT })).level).toBe('warn');
  });

  it('follows ADMIN_USERNAMES exactly when it is set (no cut-off), and nobody when it is empty', async () => {
    const explicit = await bootAnother(t.db, { adminUsernames: ['gosinn'], ownerDefault: null });
    const nobody = await bootAnother(t.db, { adminUsernames: [], ownerDefault: null });
    try {
      expect(JSON.parse((await inject(explicit, 'GET', '/api/auth/me', gosinn.cookie)).body).canEditCopy).toBe(true);
      expect(JSON.parse((await inject(nobody, 'GET', '/api/auth/me', gosinn.cookie)).body).canEditCopy).toBe(false);
      expect((await inject(nobody, 'GET', '/api/admin/copy', gosinn.cookie)).statusCode).toBe(404);
    } finally {
      await explicit.close();
      await nobody.close();
    }
    expect(await ownerStartupNote(t.db, { adminUsernames: [], ownerDefault: null })).toMatchObject({ level: 'warn' });
    expect(await ownerStartupNote(t.db, { adminUsernames: ['gosinn'], ownerDefault: null })).toEqual({
      level: 'info',
      message: 'Owner: gosinn (ADMIN_USERNAMES)',
    });
  });
});

