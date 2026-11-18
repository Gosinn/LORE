// Live text editor: published edits whose key isn't in this build any more (pure, so "Copy for Claude"
// and its tests can use it without the app around it).
import type { CopyCatalog, CopyOverride } from '#shared';
import { hashText, keyScope } from '#shared/copy';

export interface Orphan {
  o: CopyOverride;
  /** followed: the server moved the words after an update · in-code: the code says this now · lost. */
  status: 'followed' | 'in-code' | 'lost';
  /** followed / in-code: the key that has these words now. */
  to?: string;
}

/** Published edits whose key isn't in this build any more. Needs the catalog. */
export function orphansOf(overrides: readonly CopyOverride[], catalog: CopyCatalog | null): Orphan[] {
  if (!catalog) return [];
  return overrides
    .filter((o) => !catalog.keys[o.key])
    .map((o): Orphan => {
      const follower = overrides.find((x) => x.followedFrom === o.key && catalog.keys[x.key]);
      if (follower) return { o, status: 'followed', to: follower.key };
      const inCode = `${keyScope(o.key)}#${hashText(o.text)}`;
      if (catalog.keys[inCode]) return { o, status: 'in-code', to: inCode };
      return { o, status: 'lost' };
    });
}
