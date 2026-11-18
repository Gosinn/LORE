// "Copy for Claude": unit tests. Run by `npm run test:copy`.
import { describe, expect, it } from 'vitest';
import type { CopyCatalog, CopyOverride } from '#shared';
import { hashText } from '#shared/copy';
import { bakeItems, bakeText, repoPlace } from './bake.ts';

const k = (scope: string, text: string) => `${scope}#${hashText(text)}`;
const o = (key: string, original: string, text: string): CopyOverride => ({
  key,
  text,
  original,
  context: null,
  followedFrom: null,
  updatedAt: '2026-11-18T12:00:00.000Z',
  updatedBy: null,
});

describe('Copy for Claude', () => {
  it('turns catalog places into repo paths', () => {
    expect(repoPlace('pages/Home.tsx:42', 'pages/Home#00000000')).toBe('apps/web/src/pages/Home.tsx:42');
    expect(repoPlace('packages/shared/src/vocabulary.ts:9', 'shared/vocabulary#00000000')).toBe('packages/shared/src/vocabulary.ts:9');
    expect(repoPlace('apps/api/src/routes/crews.ts:7', 'srv#00000000')).toBe('apps/api/src/routes/crews.ts:7');
  });

  it('lists live edits with places and keeps orphans apart, every character intact', () => {
    const home = k('pages/Home', 'The one who almost stayed home');
    const gone = k('pages/Old', 'Gone words');
    const catalog: CopyCatalog = {
      build: 'b1',
      keys: { [home]: { text: 'The one who almost stayed home', kind: 'n', at: ['pages/Home.tsx:42'], ctx: 'Home › h2' } },
    };
    const overrides = [o(home, 'The one who almost stayed home', 'The one who <em>nearly</em> stayed “home”'), o(gone, 'Gone words', 'Still here')];
    const { live, orphans } = bakeItems(overrides, catalog);
    expect(live).toEqual([
      { key: home, places: ['apps/web/src/pages/Home.tsx:42'], context: 'Home › h2', original: 'The one who almost stayed home', now: 'The one who <em>nearly</em> stayed “home”' },
    ]);
    expect(orphans.map((x) => x.key)).toEqual([gone]);
    const text = bakeText(overrides, catalog);
    expect(text).toContain('1 published edit to write into the code (build b1)');
    expect(text).toContain('"now": "The one who <em>nearly</em> stayed “home”"');
    expect(text).toContain('Not in this build any more (1)');
  });

  it('never asks again for edits already in the code or followed to their new home', () => {
    // Baked: AppShell's "Profile" became "Me" in the code. pages/Profile still says "Profile".
    const shellOld = k('components/AppShell', 'Profile');
    const shellNow = k('components/AppShell', 'Me');
    const profile = k('pages/Profile', 'Profile');
    // Followed: the server moved "Old place" words to pages/New.
    const moved = k('pages/Old', 'Same words');
    const follower = k('pages/New', 'Same words');
    const catalog: CopyCatalog = {
      build: 'b2',
      keys: {
        [shellNow]: { text: 'Me', kind: 's', at: ['components/AppShell.tsx:9'] },
        [profile]: { text: 'Profile', kind: 's', at: ['pages/Profile.tsx:30'] },
        [follower]: { text: 'Same words', kind: 's', at: ['pages/New.tsx:3'] },
      },
    };
    const overrides = [
      o(shellOld, 'Profile', 'Me'),
      o(moved, 'Same words', 'Better words'),
      { ...o(follower, 'Same words', 'Better words'), followedFrom: moved },
    ];
    const { live, orphans } = bakeItems(overrides, catalog);
    expect(live.map((x) => x.key)).toEqual([follower]);
    expect(orphans).toEqual([]);
    expect(bakeText(overrides, catalog)).not.toContain('Not in this build any more');
  });

  it('writes hidden characters as escapes, never raw', () => {
    const home = k('pages/Home', 'Wish');
    const catalog: CopyCatalog = { build: null, keys: { [home]: { text: 'Wish', kind: 's' } } };
    // Tag characters spelling "Ig", a line separator, a zero-width joiner in an emoji.
    const text = bakeText([o(home, 'Wish', 'I wish\u{E0049}\u{E0067} a\u2028b 👨\u200D👩')], catalog);
    expect(text).toContain('I wish\\udb40\\udc49\\udb40\\udc67 a\\u2028b 👨\\u200d👩');
    expect(/[\u2028\u200D]|\uDB40/.test(text)).toBe(false);
    expect(JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))[0].now).toBe('I wish\u{E0049}\u{E0067} a\u2028b 👨\u200D👩');
  });
});
