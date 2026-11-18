// Live text runtime: unit tests (LIVE_TEXT_SPEC 12.4). Node, no DOM: storage is an in-memory fake and each
// test gets a fresh runtime module and store. Run by `npm run test:copy` (apps/web/vite/vitest.config.ts).
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashText } from '#shared/copy';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

type Runtime = typeof import('./runtime.ts');
let rt: Runtime;
let local: MemoryStorage;
let session: MemoryStorage;

const key = (scope: string, text: string) => `${scope}#${hashText(text)}`;
const HOME = key('pages/Home', 'Home');
const HELLO = key('pages/Home', 'Hello {name}!');
const OWNER = 'owner-1';

async function fresh(before?: () => void): Promise<Runtime> {
  delete (globalThis as { __loreCopy?: unknown }).__loreCopy;
  vi.resetModules();
  before?.();
  return import('./runtime.ts');
}

beforeEach(async () => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  rt = await fresh();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MARK = /⁣[‌⁠-⁢]+⁤/;

describe('lookup', () => {
  it('returns the default untouched when nothing is overridden', () => {
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    expect(rt.__tm(HELLO, 'Hello {name}!', { name: 'Ana' })).toBe('Hello Ana!');
  });

  it('shows a published override, and the owner’s draft over it only after the owner gate', () => {
    rt.copyStore.apply({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');

    // Not the owner yet: drafts can't be set and stored drafts aren't read.
    rt.copyStore.setPending(HOME, { text: 'Camp', original: 'Home', context: null });
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');

    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setPending(HOME, { text: 'Camp', original: 'Home', context: null });
    expect(rt.__t(HOME, 'Home')).toBe('Camp');

    // A pending revert shows the default even though an override is published.
    rt.copyStore.setPending(HOME, { text: null, original: 'Home', context: null });
    expect(rt.__t(HOME, 'Home')).toBe('Home');

    rt.copyStore.closeDrafts();
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');
  });

  it('keeps drafts per owner in storage and opens them only for that owner', async () => {
    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setPending(HOME, { text: 'Camp', original: 'Home', context: 'Tab bar' });
    expect(local.getItem(`lore.copy.draft.${OWNER}`)).toContain('Camp');

    rt = await fresh();
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    rt.copyStore.openDrafts('someone-else');
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    rt.copyStore.closeDrafts();
    rt.copyStore.openDrafts(OWNER);
    expect(rt.__t(HOME, 'Home')).toBe('Camp');
  });

  it('re-applies the default’s own edge whitespace around an override', () => {
    rt.copyStore.apply({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    expect(rt.__t(HOME, ' Home\n')).toBe(' Hearth\n');
  });

  it('renders the default when an override doesn’t fit (and lists it as broken)', () => {
    const k = HELLO;
    rt.copyStore.apply({ version: 'v1', texts: { [k]: 'Hi there!', [HOME]: 'Ho<em>me</em>' } });
    expect(rt.__tm(k, 'Hello {name}!', { name: 'Ana' })).toBe('Hello Ana!');
    expect(rt.copyStore.problem(k)?.code).toBe('placeholders');
    // Tags are refused in string positions.
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    expect(rt.copyStore.problem(HOME)?.code).toBe('tags');
  });

  it('ticks on every change', () => {
    const t0 = rt.__copyTick();
    rt.copyStore.apply({ version: 'v1', texts: {} });
    expect(rt.__copyTick()).toBe(t0 + 1);
  });
});

describe('messages', () => {
  const READ = key('pages/Legal', 'Read the {Link} before you start.');

  it('string mode fills placeholders like React shows them', () => {
    expect(rt.__tm(HELLO, 'Hello {name}!', { name: null })).toBe('Hello !');
    expect(rt.__tm(HELLO, 'Hello {name}!', { name: 3 })).toBe('Hello 3!');
  });

  it('node mode returns a string when there is nothing to key', () => {
    expect(rt.__tm(HOME, 'Home', {}, 2)).toBe('Home');
  });

  it('node mode returns a keyed array, never a Fragment, and keeps placeholder keys when words move', () => {
    const link = createElement('a', { href: '/terms' }, 'Terms');
    const out = rt.__tm(READ, 'Read the {Link} before you start.', { Link: link }, 2) as ReactNode[];
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toBe('Read the ');
    const ph = out[1] as ReactElement<{ children: unknown }>;
    expect(isValidElement(ph) && ph.type === Fragment && ph.key === 'p:Link').toBe(true);
    expect(renderToStaticMarkup(createElement('p', null, ...out))).toBe('<p>Read the <a href="/terms">Terms</a> before you start.</p>');

    rt.copyStore.apply({ version: 'v1', texts: { [READ]: 'First the {Link}, <em>then</em> the road.' } });
    const moved = rt.__tm(READ, 'Read the {Link} before you start.', { Link: link }, 2) as ReactNode[];
    const again = moved.find((n) => isValidElement(n) && n.type === Fragment) as ReactElement;
    expect(again.key).toBe('p:Link');
    expect(renderToStaticMarkup(createElement('p', null, ...moved))).toBe(
      '<p>First the <a href="/terms">Terms</a>, <em>then</em> the road.</p>',
    );
  });

  it('keeps tags of the default in node mode and flattens them in string mode', () => {
    const k = key('components/oracle', 'his <em>garden</em>.');
    const nodes = rt.__tm(k, 'his <em>garden</em>.', {}, 2) as ReactNode[];
    expect(renderToStaticMarkup(createElement('p', null, ...nodes))).toBe('<p>his <em>garden</em>.</p>');
  });
});

describe('lists', () => {
  it('reads each word when used, so slices and maps see live words', () => {
    const words = ['Life', 'Of', 'Regular', 'Epics'];
    const keys = words.map((w) => key('components/ui', w));
    const list = rt.__tl(keys, words);
    expect(list.join(' ')).toBe('Life Of Regular Epics');
    rt.copyStore.apply({ version: 'v1', texts: { [keys[3]!]: 'Escapades' } });
    expect(list.slice(2).map((w) => w[0]).join('')).toBe('RE');
    expect([...list][3]).toBe('Escapades');
    expect(list.length).toBe(4);
  });
});

describe('edit markers', () => {
  it('are added only while the owner edits, never with the plain flag, and decode to the key', () => {
    expect(MARK.test(rt.__t(HOME, 'Home'))).toBe(false);
    rt.copyStore.setEditing(true); // not the owner: refused
    expect(rt.copyStore.isEditing()).toBe(false);

    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setEditing(true);
    const marked = rt.__t(HOME, 'Home');
    expect(marked).not.toBe('Home');
    expect(MARK.test(marked)).toBe(true);
    expect(rt.copyStore.decode(marked)).toEqual([{ key: HOME, start: 0, end: 4 }]);
    expect(rt.__t(HOME, 'Home', 1)).toBe('Home');
    expect(rt.stripMarkers(marked)).toBe('Home');

    rt.copyStore.setEditing(false);
    expect(rt.__t(HOME, 'Home')).toBe('Home');
  });

  it('marks each text part of a node message', () => {
    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setEditing(true);
    const READ = key('pages/Legal', 'Read the {Link} now');
    const out = rt.__tm(READ, 'Read the {Link} now', { Link: 'x' }, 2) as ReactNode[];
    expect(out.filter((n) => typeof n === 'string').every((s) => MARK.test(s as string))).toBe(true);
  });

  it('stripping never removes a real ZWNJ or ZWJ', () => {
    const family = 'family 👨‍👩‍👧 and ‌non-joiner';
    expect(rt.stripMarkers(family)).toBe(family);
  });

  it('closing the drafts (sign-out) ends edit mode', () => {
    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setEditing(true);
    rt.copyStore.closeDrafts();
    expect(rt.copyStore.isEditing()).toBe(false);
    expect(rt.__t(HOME, 'Home')).toBe('Home');
  });
});

describe('server messages', () => {
  it('uses the srv key, then words the web code also uses, then the message itself', () => {
    const msg = 'That crew is full.';
    rt.copyStore.apply({ version: 'v1', texts: { [`srv#${hashText(msg)}`]: 'That crew has no more room.' } });
    expect(rt.serverCopy(msg)).toBe('That crew has no more room.');

    const line = 'The stones are asleep.';
    const vk = key('shared/vocabulary', line);
    rt.copyStore.apply({ version: 'v2', texts: { [vk]: 'The stones sleep tonight.' } });
    expect(rt.serverCopy(line)).toBe(line); // the web hasn't used that line yet
    rt.__t(vk, line);
    expect(rt.serverCopy(line)).toBe('The stones sleep tonight.');

    expect(rt.serverCopy('Something else.')).toBe('Something else.');
  });

  it('finds a message the server already sent in published words, for marks and drafts', () => {
    const msg = 'That crew is full.';
    const sk = `srv#${hashText(msg)}`;
    rt.copyStore.apply({ version: 'v1', texts: { [sk]: 'That crew has no more room.' } });
    // The server (app.ts say) sends the published words; they stay as they are.
    expect(rt.serverCopy('That crew has no more room.')).toBe('That crew has no more room.');

    rt.copyStore.openDrafts(OWNER);
    rt.copyStore.setPending(sk, { text: 'The crew is packed.', original: msg, context: null });
    expect(rt.serverCopy('That crew has no more room.')).toBe('The crew is packed.');
    rt.copyStore.setPending(sk, { text: null, original: msg, context: null });
    expect(rt.serverCopy('That crew has no more room.')).toBe(msg);

    // Edit mode marks it with the server key, and the runtime's default for it is the code's.
    rt.copyStore.setPending(sk, null);
    rt.copyStore.setEditing(true);
    const marked = rt.serverCopy('That crew has no more room.');
    expect(rt.copyStore.decode(marked).map((s) => s.key)).toEqual([sk]);
    expect(rt.copyStore.info(sk)?.d).toBe('That crew has no more room.');
    rt.__t(sk, msg);
    expect(rt.copyStore.info(sk)?.d).toBe(msg);
  });
});

describe('cache', () => {
  it('applies cached published words at import, before any render', async () => {
    local.setItem('lore.copy', JSON.stringify({ version: 'v9', texts: { [HOME]: 'Hearth' } }));
    rt = await fresh();
    expect(rt.copyStore.version()).toBe('v9');
    expect(rt.__t(HOME, 'Home')).toBe('Hearth');
  });

  it('survives bad JSON and drops bad entries', async () => {
    local.setItem('lore.copy', '{nope');
    rt = await fresh();
    expect(rt.__t(HOME, 'Home')).toBe('Home');
    expect(local.getItem('lore.copy')).toBeNull();

    local.setItem(
      'lore.copy',
      JSON.stringify({ version: 'v1', texts: { [HOME]: 'Hearth', 'bad key': 'x', [HELLO]: 'evil‮text', 'pages/X#00000000': '' } }),
    );
    rt = await fresh();
    expect([...rt.copyStore.published().keys()]).toEqual([HOME]);
  });

  it('skips the cache in a session that crashed', async () => {
    local.setItem('lore.copy', JSON.stringify({ version: 'v9', texts: { [HOME]: 'Hearth' } }));
    session.setItem('lore.copy.crashed', '1');
    rt = await fresh();
    expect(rt.__t(HOME, 'Home')).toBe('Home');
  });
});

describe('re-render', () => {
  it('__useCopy subscribes components to the words', () => {
    function Tab() {
      rt.__useCopy();
      return createElement('span', null, rt.__t(HOME, 'Home'));
    }
    rt.copyStore.apply({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    expect(renderToStaticMarkup(createElement(Tab))).toBe('<span>Hearth</span>');
  });
});

describe('crash guard', () => {
  it('drops the cache, closes drafts (editor switch off) and reloads once per session', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload }, addEventListener: () => undefined });
    rt = await fresh();
    const { recoverFromCopyCrash } = await import('./guard.tsx');

    expect(recoverFromCopyCrash()).toBe(false); // nothing applied: nothing to drop

    local.setItem('lore.copy', JSON.stringify({ version: 'v1', texts: { [HOME]: 'Hearth' } }));
    rt.copyStore.apply({ version: 'v1', texts: { [HOME]: 'Hearth' } });
    rt.copyStore.openDrafts(OWNER);
    local.setItem('lore.copy.editor', '1');
    expect(recoverFromCopyCrash()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(local.getItem('lore.copy')).toBeNull();
    expect(local.getItem('lore.copy.editor')).toBeNull();
    expect(session.getItem('lore.copy.crashed')).toBe('1');
    expect(rt.copyStore.draftsUser()).toBeNull();

    expect(recoverFromCopyCrash()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
