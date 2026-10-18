import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(4000),
  /** Postgres connection string. Without it, an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default(path.join(repoRoot, '.data', 'pglite')),
  MEDIA_DIR: z.string().default(path.join(repoRoot, '.data', 'media')),
  /** Where photo files go: `disk` (MEDIA_DIR) or `database` (hosts without a lasting disk). */
  MEDIA_STORAGE: z.enum(['disk', 'database']).default('disk'),
  /** Built web app to serve (production single-server deploy). */
  PUBLIC_DIR: z.string().default(path.join(repoRoot, 'apps', 'web', 'dist')),
  /** Browser origins allowed to make cookie-authenticated writes. Comma separated. */
  WEB_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  /** Origins of the native apps (Capacitor WebViews). They authenticate with bearer tokens. */
  NATIVE_ORIGINS: z.string().default('https://localhost,capacitor://localhost,http://localhost'),
  /** Signs photo links; set it in production so links survive restarts. */
  MEDIA_URL_SECRET: z.string().min(16).optional(),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default(false),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  /**
   * scrypt cost (power of two) and parallelism. The default (2^17, p=1) needs 128 MB
   * per hash; small servers can trade memory for CPU at equal strength per OWASP,
   * e.g. 2^15 with p=3 (32 MB). Lowered further only in tests.
   */
  SCRYPT_COST: z.coerce.number().int().default(2 ** 17),
  SCRYPT_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databaseUrl: string | undefined;
  pgliteDir: string;
  mediaDir: string;
  mediaStorage: 'disk' | 'database';
  publicDir: string;
  webOrigins: string[];
  nativeOrigins: string[];
  mediaUrlSecret: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionDays: number;
  scryptCost: number;
  scryptParallelism: number;
  logLevel: string;
}

const list = (v: string) =>
  v
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    mediaDir: e.MEDIA_DIR,
    mediaStorage: e.MEDIA_STORAGE,
    publicDir: e.PUBLIC_DIR,
    webOrigins: list(e.WEB_ORIGINS),
    nativeOrigins: list(e.NATIVE_ORIGINS),
    mediaUrlSecret: e.MEDIA_URL_SECRET,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    sessionDays: e.SESSION_DAYS,
    scryptCost: e.SCRYPT_COST,
    scryptParallelism: e.SCRYPT_PARALLELISM,
    logLevel: e.LOG_LEVEL,
  };
}

/** Settings for tests: in-memory everything, cheap password hashing. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    scryptCost: 2 ** 10,
    logLevel: 'silent',
    ...overrides,
  };
}
