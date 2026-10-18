import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Me } from '#shared';
import { buildApp } from '../src/app.ts';
import { testConfig, type Config } from '../src/config.ts';
import { openDatabase, type Db } from '../src/db/index.ts';
import { DatabaseStorage, LocalDiskStorage } from '../src/lib/storage.ts';

/** A 1×1 PNG, for upload tests. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface Response<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

export interface Client {
  user: Me;
  cookie: string;
  get<T = any>(url: string): Promise<Response<T>>;
  post<T = any>(url: string, body?: unknown): Promise<Response<T>>;
  patch<T = any>(url: string, body?: unknown): Promise<Response<T>>;
  put<T = any>(url: string, body?: unknown): Promise<Response<T>>;
  del<T = any>(url: string): Promise<Response<T>>;
  upload<T = any>(url: string, file: Buffer, filename?: string): Promise<Response<T>>;
}

export interface TestApp {
  app: FastifyInstance;
  /** Registers a fresh account and returns a client signed in as it. */
  signUp(username: string, displayName?: string): Promise<Client>;
  befriend(a: Client, b: Client): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: { mediaStorage?: 'disk' | 'database'; config?: Partial<Config> } = {},
): Promise<TestApp & { db: Db }> {
  // TEST_DATABASE_URL runs a file against a real Postgres server (fresh, empty
  // database) through the production `pg` driver instead of in-memory PGlite.
  const database = await openDatabase({ url: process.env.TEST_DATABASE_URL });
  await database.migrate();
  const mediaDir = mkdtempSync(path.join(tmpdir(), 'lore-media-'));
  const storage = opts.mediaStorage === 'database' ? new DatabaseStorage(database.db) : new LocalDiskStorage(mediaDir);
  const app = await buildApp({ db: database.db, config: testConfig(opts.config), storage });
  await app.ready();

  const request = async (method: string, url: string, cookie: string | undefined, body?: unknown): Promise<Response> => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: cookie ? { cookie } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, headers: res.headers };
  };

  const clientFor = (user: Me, cookie: string): Client => ({
    user,
    cookie,
    get: (url) => request('GET', url, cookie),
    post: (url, body = {}) => request('POST', url, cookie, body),
    patch: (url, body = {}) => request('PATCH', url, cookie, body),
    put: (url, body = {}) => request('PUT', url, cookie, body),
    del: (url) => request('DELETE', url, cookie),
    upload: async (url, file, filename = 'photo.png') => {
      const boundary = '----lore-test-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      return { status: res.statusCode, body: safeJson(res.body), headers: res.headers };
    },
  });

  return {
    app,
    db: database.db,
    async signUp(username, displayName = username[0]!.toUpperCase() + username.slice(1)) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username, displayName, email: `${username}@example.test`, password: 'correct horse battery' },
      });
      if (res.statusCode !== 201) throw new Error(`signUp failed: ${res.statusCode} ${res.body}`);
      const setCookie = res.cookies.find((c) => c.name === 'lore_session');
      return clientFor(JSON.parse(res.body).user, `lore_session=${setCookie!.value}`);
    },
    async befriend(a, b) {
      const req = await a.post('/api/friends/requests', { username: b.user.username });
      if (req.status !== 201) throw new Error(`friend request failed: ${req.status}`);
      const pending = await b.get('/api/friends/requests');
      const incoming = pending.body.find((r: any) => r.user.id === a.user.id);
      const ok = await b.post(`/api/friends/requests/${incoming.id}/accept`);
      if (ok.status !== 200) throw new Error(`accept failed: ${ok.status}`);
    },
    async close() {
      await app.close();
      await database.close();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const inDays = (days: number, hour = 18) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
