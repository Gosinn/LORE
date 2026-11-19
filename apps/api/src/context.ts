import type { FastifyRequest } from 'fastify';
import type { CopyCatalog } from '#shared';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import type { LiveCopy } from './lib/copy.ts';
import { unauthorized } from './lib/errors.ts';
import type { BatchClient } from './lib/loracle/client.ts';
import type { LoracleMind } from './lib/loracle/types.ts';
import type { MediaStorage } from './lib/storage.ts';
import type { WorldData } from './lib/world.ts';

export interface AppContext {
  db: Db;
  config: Config;
  storage: MediaStorage;
  /** Places, weather and sky from open-data services, for the Oracle. */
  world: WorldData;
  /**
   * The Loracle's mind: Claude when config.loracle.mode is 'awake', the dev fake when 'fake',
   * undefined while asleep (casts answer 503 `asleep`). Tests pass their own.
   */
  mind?: LoracleMind;
  /**
   * The Message Batches client for the dawn lane (phase B). Undefined: made from the key when the
   * stone is awake. Tests pass their own (no network).
   */
  batches?: BatchClient;
  /** Which database is in use, reported by /api/health so a deploy can be checked from outside. */
  dbKind?: 'postgres' | 'pglite';
  /**
   * Live text: the catalog of texts in the served web build. Undefined: read
   * `<publicDir>/copy-catalog.json` (never in tests); tests pass their own or null.
   */
  copyCatalog?: CopyCatalog | null;
  /** Live text: the published words in memory (made by buildApp). */
  liveCopy?: LiveCopy;
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
