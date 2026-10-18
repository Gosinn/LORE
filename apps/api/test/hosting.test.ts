// Settings for small free hosts: photos stored in Postgres (no lasting disk) and
// password hashing that trades memory for CPU.
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaBlobs } from '../src/db/schema.ts';
import { createTestApp, PNG_1X1, type Client, type TestApp } from './helpers.ts';
import type { Db } from '../src/db/index.ts';

let t: TestApp & { db: Db };
let ari: Client;

beforeAll(async () => {
  t = await createTestApp({ mediaStorage: 'database', config: { scryptCost: 2 ** 10, scryptParallelism: 3 } });
  ari = await t.signUp('ari');
});
afterAll(() => t.close());

const blobCount = async () => (await t.db.select({ n: count() }).from(mediaBlobs))[0]!.n;

describe('photos stored in the database', () => {
  it('round-trips a photo and removes it with its contribution', async () => {
    const ch = await ari.post('/api/chapters', { title: 'Stored in Postgres', occurredOn: '2025-01-01' });
    const upload = await ari.upload(`/api/media?chapterId=${ch.body.id}`, PNG_1X1);
    expect(upload.status).toBe(201);
    expect(await blobCount()).toBe(1);

    const file = await t.app.inject({ method: 'GET', url: upload.body.url });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PNG_1X1)).toBe(true);

    const withPhoto = await ari.post(`/api/chapters/${ch.body.id}/contributions`, { type: 'photo', mediaId: upload.body.id });
    const contribution = withPhoto.body.contributions[0];
    await ari.del(`/api/contributions/${contribution.id}`);
    expect(await blobCount()).toBe(0);
  });
});

describe('lighter password hashing', () => {
  it('signs in with p=3 hashes and stores the parameters', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'ari', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    const { users } = await import('../src/db/schema.ts');
    const [row] = await t.db.select({ hash: users.passwordHash }).from(users).where(eq(users.username, 'ari'));
    expect(row!.hash.split('$').slice(1, 4)).toEqual(['1024', '8', '3']);
  });
});
