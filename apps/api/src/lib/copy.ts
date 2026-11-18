// Live text on the server: the owner's published words held in memory, the served build's catalog
// of texts, publishing, undo, and following words a deploy moved to another file
// (docs/ARCHITECTURE.md § Live text). LORE runs as one instance: the snapshot is loaded at boot and
// replaced in the request that changes it. No timers (the Neon database may suspend when idle).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  checkOverride,
  COPY_KEY_RE,
  COPY_PUBLISHES_PER_HOUR,
  copyProblemText,
  hashText,
  keyHash,
  keyScope,
  kindFromOriginal,
  MAX_COPY_OVERRIDES,
  SERVER_SCOPE,
  splitEdges,
  VOCABULARY_SCOPE,
  type CopyAdminState,
  type CopyCatalog,
  type CopyCatalogEntry,
  type CopyChange,
  type CopyHistory,
  type CopyOverride,
  type CopyPublishInput,
  type CopyPublishResult,
  type CopyRevisionSummary,
  type CopyState,
  type CopyUndoInput,
  type CopyUndoResult,
  type UserSummary,
} from '#shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { copyOverrides, copyRevisions, copyState, users } from '../db/schema.ts';
import { HttpError, notFound } from './errors.ts';
import { iso, toUserSummary } from './queries.ts';

/** The file the build plugin writes next to index.html. */
export const CATALOG_FILE = 'copy-catalog.json';

/** How often (at most) a GET re-reads the version, in case another instance published. */
const RECHECK_MS = 30_000;

const SWITCHED_OFF = 'Live text is switched off on the server.';
const UNKNOWN_KEY = 'This text isn’t in the live version of LORE (update the app, or it was changed in code).';
const NO_CATALOG = 'This server’s build carries no list of texts, so edits can’t be checked. Deploy again, then publish.';
const STALE = 'LORE’s words changed while you were editing (another device?). Your changes are kept: publish again.';
const TOO_MANY = `LORE carries at most ${MAX_COPY_OVERRIDES.toLocaleString('en')} changed texts. Clean up some orphans first.`;
const TOO_OFTEN = 'That’s a lot of publishing for one hour. Take a breath and try again soon.';

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

/**
 * Reads and checks `<publicDir>/copy-catalog.json`. Null when there is none; entries that don't
 * look right are dropped (a broken file must not take the server down).
 */
export function readCatalog(publicDir: string, log?: Logger): CopyCatalog | null {
  const file = path.join(path.resolve(publicDir), CATALOG_FILE);
  if (!existsSync(file)) return null;
  try {
    return toCatalog(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    log?.warn(`${CATALOG_FILE} in PUBLIC_DIR could not be read; treating the build as having no catalog.`);
    return null;
  }
}

/** Validates a parsed catalog. */
export function toCatalog(raw: unknown): CopyCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const { build, keys } = raw as { build?: unknown; keys?: unknown };
  if (!keys || typeof keys !== 'object') return null;
  const out: Record<string, CopyCatalogEntry> = {};
  for (const [key, value] of Object.entries(keys as Record<string, unknown>)) {
    const e = value as Partial<CopyCatalogEntry> | null;
    if (!COPY_KEY_RE.test(key) || !e || typeof e.text !== 'string' || (e.kind !== 's' && e.kind !== 'n')) continue;
    out[key] = e as CopyCatalogEntry;
  }
  return { build: typeof build === 'string' ? build : null, keys: out };
}

export interface LiveCopy {
  /** False with COPY_OVERRIDES=off: nothing is served, nothing publishes. */
  readonly enabled: boolean;
  readonly catalog: CopyCatalog | null;
  /** Production: every published key must be in the served build's catalog. */
  readonly checkCatalog: boolean;
  /** For the x-lore-copy header: the published version, `0` before the first publish or when off. */
  tag(): string;
  /** GET /api/copy: from memory. */
  publicState(): CopyState;
  /** Reads the published words from the database into memory. */
  load(): Promise<void>;
  /** At most every 30 s, and only when asked: reloads if another instance published. */
  refreshIfStale(): Promise<void>;
  /** The published override of a default (server messages and vocabulary lines), checked; or undefined. */
  resolve(core: string): string | undefined;
  /** A server message as people should read it (static messages the owner edited). */
  say(message: string): string;
  adminState(): Promise<CopyAdminState>;
  history(key: string): Promise<CopyHistory>;
  publish(userId: string, input: CopyPublishInput): Promise<CopyPublishResult>;
  undo(userId: string, input: CopyUndoInput): Promise<CopyUndoResult>;
  /** After a deploy: re-attach orphaned words to the one new key holding the same default. */
  followMoved(): Promise<{ followed: { from: string; to: string }[]; ambiguous: string[] }>;
}

type OverrideRow = typeof copyOverrides.$inferSelect;

export function createLiveCopy(opts: {
  db: Db;
  config: Pick<Config, 'env' | 'copyOverrides'>;
  catalog: CopyCatalog | null;
  log?: Logger;
}): LiveCopy {
  const { db, catalog } = opts;
  const enabled = opts.config.copyOverrides;
  const checkCatalog = opts.config.env === 'production';

  let version: string | null = null;
  let texts = new Map<string, string>();
  let publicTexts: Record<string, string> = Object.freeze({}) as Record<string, string>;
  let lastCheck = 0;

  // Publishes, undos and follows run one at a time in this process, so snapshot reloads stay in
  // order (the copy_state row lock orders them across processes).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const off = () => new HttpError(503, 'copy_off', SWITCHED_OFF);

  async function readVersion(): Promise<string | null> {
    const [row] = await db.select({ version: copyState.version }).from(copyState).where(eq(copyState.id, 1)).limit(1);
    return row?.version ?? null;
  }

  async function load() {
    await db.insert(copyState).values({ id: 1, version: null }).onConflictDoNothing();
    // Version first, rows second: a publish landing in between makes the rows newer than the
    // version, which the next check corrects (never the other way round).
    const v = await readVersion();
    const rows = await db.select({ key: copyOverrides.key, text: copyOverrides.text }).from(copyOverrides);
    version = v;
    texts = new Map(rows.map((r) => [r.key, r.text]));
    publicTexts = Object.freeze(Object.fromEntries(texts)) as Record<string, string>;
    lastCheck = Date.now();
  }

  async function guardRate(userId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(copyRevisions)
      .where(and(eq(copyRevisions.publishedBy, userId), gt(copyRevisions.createdAt, new Date(Date.now() - 3_600_000))));
    if ((row?.n ?? 0) >= COPY_PUBLISHES_PER_HOUR) throw new HttpError(429, 'rate_limited', TOO_OFTEN);
  }

  function resolve(core: string): string | undefined {
    if (!enabled || texts.size === 0) return undefined;
    const h = hashText(core);
    for (const key of [`${SERVER_SCOPE}#${h}`, `${VOCABULARY_SCOPE}#${h}`]) {
      const t = texts.get(key);
      if (t !== undefined && !checkOverride(t, core, 's')) return t;
    }
    return undefined;
  }

  const summary = (u: { id: string | null; username: string | null; displayName: string | null; avatarMediaId: string | null }): UserSummary | null =>
    u.id && u.username && u.displayName
      ? toUserSummary({ id: u.id, username: u.username, displayName: u.displayName, avatarMediaId: u.avatarMediaId })
      : null;
  const userCols = {
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    avatarMediaId: users.avatarMediaId,
  };

  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

  /** Locks the version row and checks the caller edited the current version. */
  async function lockVersion(tx: Tx, baseVersion: string | null | undefined): Promise<void> {
    await tx.insert(copyState).values({ id: 1, version: null }).onConflictDoNothing();
    const [st] = await tx.select().from(copyState).where(eq(copyState.id, 1)).for('update');
    if (baseVersion !== undefined && (st?.version ?? null) !== baseVersion) {
      throw new HttpError(409, 'copy_stale', STALE);
    }
  }

  /** Writes one revision and the rows it changes; returns its id. */
  async function commit(
    tx: Tx,
    rev: { kind: 'publish' | 'undo' | 'follow'; publishedBy: string | null; undoOf?: string },
    changes: CopyChange[],
    rows: { upsert: (typeof copyOverrides.$inferInsert)[]; remove: string[] },
  ): Promise<string> {
    const [written] = await tx
      .insert(copyRevisions)
      .values({ kind: rev.kind, publishedBy: rev.publishedBy, undoOf: rev.undoOf ?? null, changes })
      .returning({ id: copyRevisions.id });
    if (rows.upsert.length) {
      await tx
        .insert(copyOverrides)
        .values(rows.upsert)
        .onConflictDoUpdate({
          target: copyOverrides.key,
          set: {
            text: sql`excluded.text`,
            original: sql`excluded.original`,
            context: sql`excluded.context`,
            followedFrom: sql`excluded.followed_from`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`now()`,
          },
        });
    }
    if (rows.remove.length) await tx.delete(copyOverrides).where(inArray(copyOverrides.key, rows.remove));
    await tx.update(copyState).set({ version: written!.id }).where(eq(copyState.id, 1));
    return written!.id;
  }

  async function publish(userId: string, input: CopyPublishInput): Promise<CopyPublishResult> {
    if (!enabled) throw off();
    if (checkCatalog && !catalog && input.set.length) throw new HttpError(503, 'copy_catalog_missing', NO_CATALOG);

    // Check every text against what the code says it replaces (the catalog when there is one).
    const items = input.set.map((item, i) => {
      const entry = catalog?.keys[item.key];
      if (checkCatalog && !entry) {
        throw new HttpError(400, 'copy_unknown_key', UNKNOWN_KEY, { [`set.${i}.key`]: UNKNOWN_KEY });
      }
      const original = entry?.text ?? item.original;
      const problem = checkOverride(item.text, original, entry?.kind ?? kindFromOriginal(original));
      if (problem) {
        const message = copyProblemText(problem);
        throw new HttpError(400, 'bad_request', message, { [`set.${i}.text`]: message });
      }
      // The catalog's context first: the client's is only a fallback for texts the catalog lacks (dev).
      return { ...item, original, context: entry?.ctx ?? item.context ?? null };
    });

    await guardRate(userId);
    return serial(async () => {
      const revisionId = await db.transaction(async (tx) => {
        await lockVersion(tx, input.baseVersion);
        const keys = [...items.map((s) => s.key), ...input.revert];
        const current = await tx.select().from(copyOverrides).where(inArray(copyOverrides.key, keys));
        const byKey = new Map<string, OverrideRow>(current.map((r) => [r.key, r]));

        const changes: CopyChange[] = [];
        const upsert: (typeof copyOverrides.$inferInsert)[] = [];
        const remove: string[] = [];
        for (const s of items) {
          const before = byKey.get(s.key)?.text ?? null;
          // The same words as the code: that's going back to the default.
          const after = s.text === s.original ? null : s.text;
          if (before === after) continue;
          changes.push({ key: s.key, before, after, original: s.original, context: s.context });
          if (after === null) remove.push(s.key);
          else upsert.push({ key: s.key, text: after, original: s.original, context: s.context, followedFrom: null, updatedBy: userId });
        }
        for (const key of input.revert) {
          const row = byKey.get(key);
          if (!row) continue;
          changes.push({ key, before: row.text, after: null, original: row.original, context: row.context });
          remove.push(key);
        }
        if (changes.length === 0) return null;

        const added = upsert.filter((u) => !byKey.has(u.key)).length;
        if (added > 0) {
          const [total] = await tx.select({ n: count() }).from(copyOverrides);
          if ((total?.n ?? 0) + added - remove.length > MAX_COPY_OVERRIDES) throw new HttpError(400, 'bad_request', TOO_MANY);
        }
        return commit(tx, { kind: 'publish', publishedBy: userId }, changes, { upsert, remove });
      });
      await load();
      return { ...publicState(), revisionId };
    });
  }

  async function undo(userId: string, input: CopyUndoInput): Promise<CopyUndoResult> {
    if (!enabled) throw off();
    await guardRate(userId);
    return serial(async () => {
      const skipped: string[] = [];
      const revisionId = await db.transaction(async (tx) => {
        await lockVersion(tx, input.baseVersion);
        const [rev] = await tx.select().from(copyRevisions).where(eq(copyRevisions.id, input.revisionId)).limit(1);
        if (!rev) throw notFound('That publish');
        const keys = rev.changes.map((c) => c.key);
        const current = keys.length ? await tx.select().from(copyOverrides).where(inArray(copyOverrides.key, keys)) : [];
        const byKey = new Map<string, OverrideRow>(current.map((r) => [r.key, r]));

        const changes: CopyChange[] = [];
        const upsert: (typeof copyOverrides.$inferInsert)[] = [];
        const remove: string[] = [];
        for (const c of rev.changes) {
          const now = byKey.get(c.key)?.text ?? null;
          // Changed again since: leave it, and say so.
          if (now !== c.after) {
            skipped.push(c.key);
            continue;
          }
          if (now === c.before) continue;
          changes.push({ key: c.key, before: now, after: c.before, original: c.original, context: c.context });
          if (c.before === null) remove.push(c.key);
          else upsert.push({ key: c.key, text: c.before, original: c.original, context: c.context, followedFrom: null, updatedBy: userId });
        }
        if (changes.length === 0) return null;
        return commit(tx, { kind: 'undo', publishedBy: userId, undoOf: rev.id }, changes, { upsert, remove });
      });
      await load();
      return { ...publicState(), revisionId, skipped };
    });
  }

  async function followMoved() {
    const followed: { from: string; to: string }[] = [];
    const ambiguous: string[] = [];
    if (!enabled || !catalog) return { followed, ambiguous };
    return serial(async () => {
      const rows = await db.select().from(copyOverrides);
      const has = new Set(rows.map((r) => r.key));
      const byHash = new Map<string, string[]>();
      for (const key of Object.keys(catalog.keys)) {
        const h = keyHash(key);
        byHash.set(h, [...(byHash.get(h) ?? []), key]);
      }

      // Orphans (published keys this build doesn't have) whose default now lives at exactly one key.
      const plan = new Map<string, OverrideRow[]>();
      for (const row of rows) {
        if (catalog.keys[row.key]) continue;
        // Baked ("Copy for Claude"): the code says the edited words now, so nothing moved. Following would
        // copy them onto another file's identical default that the owner never touched.
        if (catalog.keys[`${keyScope(row.key)}#${hashText(row.text)}`]) continue;
        const candidates = (byHash.get(hashText(row.original)) ?? []).filter((k) => catalog.keys[k]!.text === row.original);
        if (candidates.length !== 1) {
          if (candidates.length > 1) ambiguous.push(row.key);
          continue;
        }
        const target = candidates[0]!;
        if (has.has(target)) continue; // already has words (perhaps followed on an earlier boot)
        const entry = catalog.keys[target]!;
        if (checkOverride(row.text, entry.text, entry.kind)) continue; // would not show there
        plan.set(target, [...(plan.get(target) ?? []), row]);
      }
      // Two orphans with different words aiming at one text: the owner decides.
      for (const [target, list] of plan) {
        if (new Set(list.map((r) => r.text)).size > 1) {
          ambiguous.push(...list.map((r) => r.key));
          plan.delete(target);
        }
      }
      if (plan.size === 0) return { followed, ambiguous };

      await db.transaction(async (tx) => {
        await lockVersion(tx, undefined);
        const changes: CopyChange[] = [];
        const upsert: (typeof copyOverrides.$inferInsert)[] = [];
        for (const [target, list] of plan) {
          const row = [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]!;
          const entry = catalog.keys[target]!;
          const context = entry.ctx ?? row.context;
          changes.push({ key: target, before: null, after: row.text, original: entry.text, context });
          upsert.push({ key: target, text: row.text, original: entry.text, context, followedFrom: row.key, updatedBy: row.updatedBy });
          followed.push({ from: row.key, to: target });
        }
        // The old rows stay until the owner cleans up orphans: older native builds still use them.
        await commit(tx, { kind: 'follow', publishedBy: null }, changes, { upsert, remove: [] });
      });
      await load();
      opts.log?.info(`Live text: followed ${followed.length} moved text(s) to their new place.`);
      return { followed, ambiguous };
    });
  }

  async function adminState(): Promise<CopyAdminState> {
    const rows = await db
      .select({ o: copyOverrides, u: userCols })
      .from(copyOverrides)
      .leftJoin(users, eq(users.id, copyOverrides.updatedBy))
      .orderBy(desc(copyOverrides.updatedAt));
    const revs = await db
      .select({ r: copyRevisions, u: userCols })
      .from(copyRevisions)
      .leftJoin(users, eq(users.id, copyRevisions.publishedBy))
      .orderBy(desc(copyRevisions.createdAt))
      .limit(20);
    const overrides: CopyOverride[] = rows.map(({ o, u }) => ({
      key: o.key,
      text: o.text,
      original: o.original,
      context: o.context,
      followedFrom: o.followedFrom,
      updatedAt: iso(o.updatedAt),
      updatedBy: summary(u ?? { id: null, username: null, displayName: null, avatarMediaId: null }),
    }));
    const revisions: CopyRevisionSummary[] = revs.map(({ r, u }) => ({
      id: r.id,
      kind: r.kind,
      publishedBy: summary(u ?? { id: null, username: null, displayName: null, avatarMediaId: null }),
      undoOf: r.undoOf,
      changes: r.changes,
      createdAt: iso(r.createdAt),
    }));
    return {
      version: enabled ? version : null,
      enabled,
      overrides,
      revisions,
      catalogBuild: catalog?.build ?? null,
      catalogChecked: checkCatalog,
    };
  }

  async function history(key: string): Promise<CopyHistory> {
    const revs = await db
      .select({ r: copyRevisions, u: userCols })
      .from(copyRevisions)
      .leftJoin(users, eq(users.id, copyRevisions.publishedBy))
      .where(sql`${copyRevisions.changes} @> ${JSON.stringify([{ key }])}::jsonb`)
      .orderBy(desc(copyRevisions.createdAt))
      .limit(20);
    return {
      key,
      entries: revs.flatMap(({ r, u }) =>
        r.changes
          .filter((c) => c.key === key)
          .map((c) => ({
            revisionId: r.id,
            kind: r.kind,
            before: c.before,
            after: c.after,
            publishedBy: summary(u ?? { id: null, username: null, displayName: null, avatarMediaId: null }),
            createdAt: iso(r.createdAt),
          })),
      ),
    };
  }

  function publicState(): CopyState {
    return enabled ? { version, texts: publicTexts } : { version: null, texts: {} };
  }

  if (!enabled) opts.log?.warn('Live text is switched off (COPY_OVERRIDES=off): the code’s own words show everywhere.');
  if (checkCatalog && !catalog && enabled) {
    opts.log?.warn(`No ${CATALOG_FILE} in PUBLIC_DIR: publishing new words is refused until a build with one is deployed.`);
  }

  return {
    enabled,
    catalog,
    checkCatalog,
    tag: () => (enabled && version ? version : '0'),
    publicState,
    load,
    async refreshIfStale() {
      if (!enabled || Date.now() - lastCheck < RECHECK_MS) return;
      lastCheck = Date.now();
      if ((await readVersion()) !== version) await serial(load);
    },
    resolve,
    say(message: string) {
      if (!enabled || texts.size === 0 || !message) return message;
      const { lead, core, trail } = splitEdges(message.normalize('NFC'));
      const found = core ? resolve(core) : undefined;
      return found === undefined ? message : lead + found + trail;
    },
    adminState,
    history,
    publish,
    undo,
    followMoved,
  };
}
