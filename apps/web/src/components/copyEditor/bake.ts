// "Copy for Claude" (LIVE_TEXT_SPEC 13, R2 step 10): the published edits as a note a code session can act
// on, so the words move into the source and the code stays the source of truth. After that deploy the old
// keys show as "Already in the code" in Edited texts and are cleaned up in one tap.
import type { CopyCatalog, CopyOverride } from '#shared';
import { keyScope, SERVER_SCOPE, VOCABULARY_SCOPE } from '#shared/copy';
import { orphansOf } from './orphans.ts';

export interface BakeItem {
  key: string;
  /** Repo paths with line numbers, from the catalog ("apps/web/src/pages/Home.tsx:42"); empty for orphans. */
  places: string[];
  context: string | null;
  original: string;
  now: string;
}

/** A catalog place ("pages/Home.tsx:42") as a path from the repo root. */
export function repoPlace(place: string, key: string): string {
  if (/^(apps|packages)\//.test(place)) return place;
  const scope = keyScope(key);
  if (scope === SERVER_SCOPE) return `apps/api/src/${place}`;
  if (scope === VOCABULARY_SCOPE || place.startsWith('shared/')) return `packages/shared/src/${place.replace(/^shared\//, '')}`;
  return `apps/web/src/${place}`;
}

/**
 * Live edits, and orphans the code lost track of. Orphans already in the code (baked) or followed to their
 * new home by the server are left out: asking again could change another file that holds the same words.
 */
export function bakeItems(overrides: readonly CopyOverride[], catalog: CopyCatalog | null): { live: BakeItem[]; orphans: BakeItem[] } {
  const live: BakeItem[] = [];
  const orphans: BakeItem[] = [];
  const done = new Set(orphansOf(overrides, catalog).filter((x) => x.status !== 'lost').map((x) => x.o.key));
  for (const o of [...overrides].sort((a, b) => a.key.localeCompare(b.key))) {
    const entry = catalog?.keys[o.key];
    const item: BakeItem = {
      key: o.key,
      places: (entry?.at ?? []).map((p) => repoPlace(p, o.key)),
      context: entry?.ctx ?? o.context,
      original: o.original,
      now: o.text,
    };
    if (!catalog || entry) live.push(item);
    else if (!done.has(o.key)) orphans.push(item);
  }
  return { live, orphans };
}

/**
 * JSON for a code session: every invisible or format character (tag characters, variation selectors,
 * separators, bidi and zero-width marks, Hangul fillers) is written as a \u escape, so hidden words can
 * never reach Claude as text it might act on. Same as tools/copy-check.mjs.
 */
export function visibleJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\p{Cf}\p{Zl}\p{Zp}\u007F-\u009F\u034F\u115F\u1160\u17B4\u17B5\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu,
    // One code point, written as its UTF-16 units (a tag character is a surrogate pair: two escapes).
    (c) => c.split('').map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  );
}

/** The clipboard text. JSON inside, so every character (quotes, {placeholders}, <em>) survives exactly. */
export function bakeText(overrides: readonly CopyOverride[], catalog: CopyCatalog | null): string {
  const { live, orphans } = bakeItems(overrides, catalog);
  const lines = [
    `LORE live text: ${live.length} published edit${live.length === 1 ? '' : 's'} to write into the code${catalog?.build ? ` (build ${catalog.build})` : ''}.`,
    'For each: at every place listed, replace the "original" words with the "now" words. Keep {placeholders} and',
    '<em>/<strong>/<br/> exactly as written (in JSX, <em>…</em> becomes a real <em> element). Then run',
    '`npm run copy:check`. After the deploy, Edited texts → Orphans shows them as "Already in the code": clean up.',
    '',
    visibleJson(live),
  ];
  if (orphans.length) {
    lines.push(
      '',
      `Not in this build any more (${orphans.length}): the code changed under these edits. Find the words by "original"`,
      'if they still make sense, otherwise leave them.',
      '',
      visibleJson(orphans),
    );
  }
  return `${lines.join('\n')}\n`;
}
