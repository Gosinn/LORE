import type { FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { unauthorized } from './lib/errors.ts';
import type { MediaStorage } from './lib/storage.ts';

export interface AppContext {
  db: Db;
  config: Config;
  storage: MediaStorage;
  /** Which database is in use, reported by /api/health so a deploy can be checked from outside. */
  dbKind?: 'postgres' | 'pglite';
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    sessionToken: string | null;
  }
}

/** The signed-in user's id, or a 401. Every route except auth and health calls this. */
export function requireUser(req: FastifyRequest): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
