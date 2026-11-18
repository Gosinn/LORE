// 12.2 render equality without a second module graph: the same fixture compiled with and without the
// transform renders the same markup when nothing is overridden; overrides change only the words. The
// transformed fixture calls the app's own runtime (lib/copy/runtime.ts), as the build does.
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __tm, copyStore } from '../../src/lib/copy/runtime.ts';
import { keyFor } from '../collect.ts';
import * as copied from './fixtures/Rich.tsx';

const plain = await import('./fixtures/Rich.tsx?nocopy');
/** Published words, as sync.ts applies them after a fetch. */
const setOverrides = (texts: Record<string, string>) => copyStore.apply({ version: Object.keys(texts).length ? 'test' : null, texts });
const render = (C: unknown, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(C as FunctionComponent, props));
const K = (text: string) => keyFor('Rich', text);

afterEach(() => setOverrides({}));

describe('render equality', () => {
  it('renders exactly the same markup with no overrides', () => {
    for (const props of [{}, { busy: true }, { who: 'Bo', n: 1 }]) {
      expect(render(copied.Rich, props)).toBe(render(plain.Rich, props));
    }
    expect(render(copied.Arrow)).toBe(render(plain.Arrow));
  });

  it('keeps the number of children a component sees', () => {
    const count = (html: string) => /data-count="(\d+)"/.exec(html)?.[1];
    expect(count(render(copied.Rich))).toBe(count(render(plain.Rich)));
  });

  it('applies overrides as text, keeping placeholders and tags', () => {
    setOverrides({
      [K('Read the {A} before you start, {who}.')]: '{who}, read the {A} first.',
      [K('No crew')]: 'Alone',
      [K('Send report')]: 'Send it',
      [K('Help & contact ')]: 'Help <em>here</em>',
      [K('Hi {who}, welcome back')]: 'Welcome back, <strong>{who}</strong>',
    });
    const html = render(copied.Rich, { who: 'Bo' });
    expect(html).toContain('<p>Bo, read the <a href="/terms">Terms</a> first.</p>');
    expect(html).toMatch(/<option value=""( selected="")?>Alone<\/option>/);
    expect(html).toContain('<button>Send it</button>');
    expect(html).toContain('aria-label="For Bo">Help <em>here</em></p>');
    expect(render(copied.Arrow, { who: 'Bo' })).toBe('<p class="arrow">Welcome back, <strong>Bo</strong></p>');
  });

  it('asks confirm() the same question, and in the published words with the name filled in', () => {
    vi.stubGlobal('confirm', (message: unknown) => message);
    try {
      const crew = { name: 'The Night Owls' };
      expect(copied.askLeave(crew)).toBe(plain.askLeave(crew));
      setOverrides({ [K('Leave {name}? You can come back if they invite you.')]: 'Walk away from {name}?' });
      expect(copied.askLeave(crew)).toBe('Walk away from The Night Owls?');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores an override that drops or invents a placeholder', () => {
    setOverrides({ [K('Read the {A} before you start, {who}.')]: 'Read the terms.' });
    expect(render(copied.Rich)).toBe(render(plain.Rich));
  });

  it('keeps a placeholder element mounted under a stable key when words move around it', () => {
    const input = createElement('input', { defaultValue: 'x' });
    const key = K('Your name {input} please');
    const before = __tm(key, 'Your name {input} please', { input }, 2) as { key: string }[];
    setOverrides({ [key]: '{input} is your name, please' });
    const after = __tm(key, 'Your name {input} please', { input }, 2) as { key: string }[];
    expect(before.map((n) => n.key)).toContain('p:input');
    expect(after.map((n) => n.key)).toContain('p:input');
    expect(after.findIndex((n) => n.key === 'p:input')).not.toBe(before.findIndex((n) => n.key === 'p:input'));
  });
});
