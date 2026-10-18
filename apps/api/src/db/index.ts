import fs, { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.ts';

/**
 * The query builder used everywhere. Both drivers expose the same Postgres
 * query-builder API, so the app is typed against the node-postgres flavour.
 */
export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Production: pass a Postgres URL. Development: pass a directory for an embedded
 * PGlite database (real Postgres compiled to WebAssembly, persisted to disk).
 * Tests: pass neither for a throwaway in-memory database.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string }): Promise<Database> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      kind: 'postgres',
      migrate: () => migratePg(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  if (opts.pgliteDir) {
    mkdirSync(opts.pgliteDir, { recursive: true });
    tolerateFilesystemTimestampLimits();
  }
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

/**
 * PGlite stamps some files with 1970 timestamps. FAT-family filesystems (exFAT
 * external drives, for instance) can't store dates before 1980 and reject the call
 * with EINVAL, which aborts startup. File times mean nothing to Postgres, so retry
 * with the earliest date such filesystems accept.
 */
let timestampsPatched = false;
function tolerateFilesystemTimestampLimits() {
  if (timestampsPatched) return;
  timestampsPatched = true;
  const earliest = Date.UTC(1980, 0, 2) / 1000;
  const clamp = (t: unknown) => Math.max(t instanceof Date ? t.getTime() / 1000 : Number(t), earliest);
  const mutable = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['utimesSync', 'futimesSync', 'lutimesSync']) {
    const original = mutable[name]!;
    mutable[name] = (target: unknown, atime: unknown, mtime: unknown) => {
      try {
        return original(target, atime, mtime);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EINVAL') throw err;
        return original(target, clamp(atime), clamp(mtime));
      }
    };
  }
}

export { schema };
