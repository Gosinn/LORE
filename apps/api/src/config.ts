import { createHash, randomBytes } from 'node:crypto';
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
  MEDIA_STORAGE: z.enum(['disk', 'database']).optional(),
  /** Built web app to serve (production single-server deploy). */
  PUBLIC_DIR: z.string().default(path.join(repoRoot, 'apps', 'web', 'dist')),
  /** Browser origins allowed to make cookie-authenticated writes. Comma separated. */
  WEB_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  /** Origins of the native apps (Capacitor WebViews). They authenticate with bearer tokens. */
  NATIVE_ORIGINS: z.string().default('https://localhost,capacitor://localhost,http://localhost'),
  /** Comma-separated LORE usernames that may moderate (reports, suspensions, support messages). */
  ADMIN_USERNAMES: z.string().default(''),
  /** Signs photo links; set it in production so links survive restarts. */
  MEDIA_URL_SECRET: z.string().min(16).optional(),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  /**
   * scrypt cost (power of two) and parallelism. The default (2^17, p=1) needs 128 MB
   * per hash; small servers can trade memory for CPU at equal strength per OWASP,
   * e.g. 2^15 with p=3 (32 MB). Lowered further only in tests.
   */
  SCRYPT_COST: z.coerce.number().int().optional(),
  SCRYPT_PARALLELISM: z.coerce.number().int().min(1).max(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The Loracle's mind (Claude). Without it the stone sleeps and everything else works. Never logged. */
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  /** `fake`: a deterministic dev mind (no network, canned quests). Only ever on when set explicitly. */
  LORACLE_MIND: z.enum(['real', 'fake']).default('real'),
  /** The owner's monthly spend ceiling for the Loracle, in US$. Past it, wishes wait for the new moon. */
  LORACLE_MONTHLY_USD: z.coerce.number().min(0).default(150),
});

/** Claude's effort levels (output_config.effort). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface LoracleConfig {
  /**
   * awake: a real key and the real mind · fake: LORACLE_MIND=fake (dev; no network) ·
   * asleep: no key, the stone sleeps (casts answer 503 `asleep`). /api/health reports it.
   */
  mode: 'awake' | 'asleep' | 'fake';
  /**
   * The Anthropic API key. Non-enumerable on loadConfig()'s object, so it never shows up when the
   * config is logged, serialised or spread. Read it only where the client is made.
   */
  readonly apiKey?: string;
  /** Every call uses this model. */
  model: 'claude-opus-5-5';
  /** output_config.effort per stage (always sent explicitly). */
  effort: { weigh: Effort; scout: Effort; compose: Effort; repair: Effort };
  /** The owner's monthly ceiling across everyone, US$ (LORACLE_MONTHLY_USD). */
  monthlyUsd: number;
  /** The hidden per-Lorer limit: casts that drew a road in a rolling 24 hours. Never shown as a number. */
  castsPer24h: number;
  /**
   * The weighings a Lorer may ask for in a rolling 24 hours (riddles, reroutes and silences included).
   * Generous; it only stops a script from weighing wish after wish on the owner's money. Never shown.
   */
  weighsPer24h: number;
  /** Jobs running at once across the server (one per Lorer). */
  maxConcurrent: number;
  /** A job's whole budget before it is cut off as a timeout. */
  jobTimeoutMs: number;
  /** Salt for the anonymous id sent as metadata.user_id. */
  anonSalt: string;
  /**
   * Seals the stone's reroute offers (routes/loracle.ts offerToken). Non-enumerable like the key.
   * Derived from DATABASE_URL when set, else random per process (an offer cast after a restart is
   * simply weighed as a new wish).
   */
  readonly offerSecret: string;
}

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
  adminUsernames: string[];
  mediaUrlSecret: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionDays: number;
  scryptCost: number;
  scryptParallelism: number;
  logLevel: string;
  /** The Loracle (wishes). */
  loracle: LoracleConfig;
}

/** The Loracle's settings. The key is attached as a non-enumerable property (see LoracleConfig.apiKey). */
export function loracleConfig(opts: {
  apiKey?: string | undefined;
  mind?: 'real' | 'fake';
  monthlyUsd?: number;
  anonSalt: string;
  offerSecret?: string;
}): LoracleConfig {
  const mode = opts.mind === 'fake' ? 'fake' : opts.apiKey ? 'awake' : 'asleep';
  const config = {
    mode,
    model: 'claude-opus-5-5',
    effort: { weigh: 'low', scout: 'medium', compose: 'high', repair: 'medium' },
    monthlyUsd: opts.monthlyUsd ?? 150,
    castsPer24h: 10,
    weighsPer24h: 40,
    maxConcurrent: 3,
    jobTimeoutMs: 360_000,
    anonSalt: opts.anonSalt,
  } as LoracleConfig;
  if (opts.apiKey) Object.defineProperty(config, 'apiKey', { value: opts.apiKey, enumerable: false });
  Object.defineProperty(config, 'offerSecret', {
    value: opts.offerSecret ?? randomBytes(32).toString('hex'),
    enumerable: false,
  });
  return config;
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
  // Render sets RENDER=true. Its free tier has 512 MB of RAM, a disk that's wiped on
  // restart and a proxy in front, so pick fitting defaults there: then the only
  // thing to configure is DATABASE_URL. Explicit variables still win.
  const onRender = env.RENDER === 'true';
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    mediaDir: e.MEDIA_DIR,
    mediaStorage: e.MEDIA_STORAGE ?? (onRender ? 'database' : 'disk'),
    publicDir: e.PUBLIC_DIR,
    webOrigins: list(e.WEB_ORIGINS),
    nativeOrigins: list(e.NATIVE_ORIGINS),
    adminUsernames: list(e.ADMIN_USERNAMES).map((u) => u.toLowerCase()),
    // Without an explicit secret, derive a stable one from the (secret) database
    // URL so photo links survive restarts.
    mediaUrlSecret:
      e.MEDIA_URL_SECRET ??
      (e.DATABASE_URL ? createHash('sha256').update(`lore-media-links:${e.DATABASE_URL}`).digest('hex') : undefined),
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY ?? onRender,
    sessionDays: e.SESSION_DAYS,
    scryptCost: e.SCRYPT_COST ?? (onRender ? 2 ** 15 : 2 ** 17),
    scryptParallelism: e.SCRYPT_PARALLELISM ?? (onRender ? 3 : 1),
    logLevel: e.LOG_LEVEL,
    loracle: loracleConfig({
      apiKey: e.ANTHROPIC_API_KEY,
      mind: e.LORACLE_MIND,
      monthlyUsd: e.LORACLE_MONTHLY_USD,
      // Stable per deployment, like the media secret; never the key itself.
      anonSalt: createHash('sha256')
        .update(`lore-loracle-anon:${e.DATABASE_URL ?? e.PGLITE_DIR}`)
        .digest('hex'),
      offerSecret: e.DATABASE_URL
        ? createHash('sha256').update(`lore-loracle-offer:${e.DATABASE_URL}`).digest('hex')
        : undefined,
    }),
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
