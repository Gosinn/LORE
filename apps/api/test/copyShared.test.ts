// Live text: the shared pieces (keys, message syntax, override checks, copy()). No database.
import { describe, expect, it } from 'vitest';
import {
  checkOverride,
  COPY_KEY_RE,
  copy,
  copyCore,
  copyKey,
  copyProblemText,
  fillHoles,
  hashText,
  installCopyResolver,
  kindFromOriginal,
  MARKER_RE,
  messageShape,
  normalizeOverride,
  parseMessage,
  placeholderNames,
  splitEdges,
  stripMarkers,
} from '#shared/copy';
import * as shared from '#shared';

describe('keys', () => {
  it('hashes with FNV-1a 32 bit over UTF-16 code units', () => {
    expect(hashText('')).toBe('811c9dc5');
    expect(hashText('a')).toBe('e40c292c');
    expect(hashText('foobar')).toBe('bf9cf968');
    expect(hashText('👨‍👩‍👧')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('Home')).not.toBe(hashText('home'));
  });

  it('splits only ASCII edge whitespace, never NBSP', () => {
    expect(splitEdges('  Hello\n')).toEqual({ lead: '  ', core: 'Hello', trail: '\n' });
    expect(splitEdges(' Hi ')).toEqual({ lead: '', core: ' Hi ', trail: '' });
    expect(splitEdges('   ')).toEqual({ lead: '   ', core: '', trail: '' });
    expect(splitEdges('a b')).toEqual({ lead: '', core: 'a b', trail: '' });
  });

  it('keys hash the NFC core, so edges and composition never change a key', () => {
    expect(copyKey('pages/Home', ' Create ')).toBe(copyKey('pages/Home', 'Create'));
    expect(copyKey('pages/Home', 'Café')).toBe(copyKey('pages/Home', 'Café'));
    expect(copyKey('srv', 'That event could not be found.')).toMatch(COPY_KEY_RE);
    expect(copyKey('shared/vocabulary', 'x')).toMatch(COPY_KEY_RE);
    expect(COPY_KEY_RE.test('pages/Home#1234567')).toBe(false);
    expect(COPY_KEY_RE.test('#12345678')).toBe(false);
    expect(COPY_KEY_RE.test('../x#12345678')).toBe(false);
    expect(copyCore(' Done\n')).toBe('Done');
  });
});

describe('messages', () => {
  it('parses placeholders and allowlisted tags; everything else is literal', () => {
    const r = parseMessage('Read the {Link} before <em>you</em> start.<br/>a < b & {nope x}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message.placeholders).toEqual(['Link']);
    expect(r.message.tags).toBe(true);
    expect(r.message.nodes).toEqual([
      { type: 'text', value: 'Read the ' },
      { type: 'ph', name: 'Link' },
      { type: 'text', value: ' before ' },
      { type: 'tag', tag: 'em', children: [{ type: 'text', value: 'you' }] },
      { type: 'text', value: ' start.' },
      { type: 'br' },
      { type: 'text', value: 'a < b & {nope x}' },
    ]);
    // <script> is not a tag here: plain words.
    const s = parseMessage('<script>alert(1)</script>');
    expect(s.ok && s.message.nodes).toEqual([{ type: 'text', value: '<script>alert(1)</script>' }]);
  });

  it('only counts the names it is given as placeholders', () => {
    const r = parseMessage('Hi {name}, {other}', { names: ['name'] });
    expect(r.ok && r.message.placeholders).toEqual(['name']);
    expect(r.ok && r.message.nodes.at(-1)).toEqual({ type: 'text', value: ', {other}' });
  });

  it('refuses unbalanced tags, and tags where only words may go', () => {
    expect(parseMessage('<em>open')).toEqual({ ok: false, problem: { code: 'unbalanced', tag: 'em' } });
    expect(parseMessage('<em>a</strong>')).toEqual({ ok: false, problem: { code: 'unbalanced', tag: 'em' } });
    expect(parseMessage('stray</b>')).toEqual({ ok: false, problem: { code: 'unbalanced', tag: 'b' } });
    expect(parseMessage('a<br>b', { tags: false })).toEqual({ ok: false, problem: { code: 'tags', tag: 'br' } });
    expect(parseMessage('<em>a</em>', { tags: false }).ok).toBe(false);
    expect(parseMessage('<em><strong>both</strong></em>').ok).toBe(true);
  });

  it('describes what an override must keep', () => {
    expect(messageShape('{n} of {total}, {n} <em>left</em><br/>')).toEqual({ placeholders: ['n', 'n', 'total'], tags: ['br', 'em'] });
    expect(placeholderNames('{a} and {a} and {0}')).toEqual(['0', 'a']);
    expect(kindFromOriginal('plain')).toBe('s');
    expect(kindFromOriginal('a <em>b</em>')).toBe('n');
  });
});

describe('checking an override', () => {
  const ok = (text: string, original = 'Original words', kind: 's' | 'n' = 's') => checkOverride(text, original, kind);

  it('accepts ordinary words, emoji with joiners and non-Latin scripts', () => {
    expect(ok('Fresh words')).toBeNull();
    expect(ok('Family 👨‍👩‍👧 time')).toBeNull();
    expect(ok('می‌خواهم')).toBeNull();
    expect(ok('<script>alert(1)</script>')).toBeNull();
    expect(ok('Go to javascript: later')).toBeNull();
  });

  it('refuses empty, too long, controls, bidi, markers, newlines and URL schemes', () => {
    expect(ok('   ')?.code).toBe('empty');
    expect(ok('x'.repeat(4001))?.code).toBe('too_long');
    expect(ok('x'.repeat(5000), 'y'.repeat(3000))).toBeNull();
    expect(ok('x'.repeat(8001), 'y'.repeat(6000))?.code).toBe('too_long');
    expect(ok('bell\u0007')?.code).toBe('invisible');
    expect(ok('tab\there')?.code).toBe('invisible');
    expect(ok('evil‮txt')?.code).toBe('invisible');
    expect(ok('zero​width')?.code).toBe('invisible');
    expect(ok('mark⁣⁠⁤ed')?.code).toBe('invisible');
    expect(ok('bom﻿')?.code).toBe('invisible');
    expect(ok('half \uD83D surrogate')?.code).toBe('invisible');
    // Hidden text: tag characters spell ASCII invisibly; separators break lines; marks and selectors hide.
    for (const hidden of ['I wish\u{E0049}\u{E0067}', 'a\u2028b', 'a\u2029b', 'x\u061Cy', 'x\u200Fy', 'x\u2065y', 'x\u206Fy', 'x\uFFFBy', 'han\u{E01EF}']) {
      expect(ok(hidden)?.code).toBe('invisible');
    }
    // Emoji presentation selectors stay allowed.
    expect(ok('Sun ☀\uFE0F')).toBeNull();
    expect(ok('two\nlines')?.code).toBe('newline');
    expect(ok('two\nlines', 'one\ntwo')).toBeNull();
    expect(ok('javascript:alert(1)')?.code).toBe('url');
    expect(ok(' DATA:text/html,hi')?.code).toBe('url');
    expect(ok('Data: what we keep', 'Data: what we keep about you')).toBeNull();
  });

  it('keeps the same placeholders, as often as the original', () => {
    expect(ok('Welcome, {name}!', 'Hi {name}')).toBeNull();
    expect(ok('Welcome!', 'Hi {name}')).toEqual({ code: 'placeholders', name: 'name', missing: true });
    expect(ok('{name} {name}', 'Hi {name}')).toEqual({ code: 'placeholders', name: 'name', missing: false });
    // A name the original doesn't have is just words.
    expect(ok('Hi {name} and {friend}', 'Hi {name}')).toBeNull();
    expect(copyProblemText({ code: 'placeholders', name: 'count', missing: true })).toBe('Keep {count} in the text.');
    expect(copyProblemText({ code: 'unbalanced', tag: 'em' })).toBe('Close the <em> you opened.');
  });

  it('allows tags only on page-content texts', () => {
    expect(ok('Now <em>this</em>', 'Now this', 'n')).toBeNull();
    expect(ok('Now <em>this</em>', 'Now this', 's')?.code).toBe('tags');
    expect(ok('Now <em>this', 'Now this', 'n')?.code).toBe('unbalanced');
  });

  it('normalizes what it stores', () => {
    expect(normalizeOverride('  Café\r\nnext  ')).toBe('Café\nnext');
  });
});

describe('markers', () => {
  it('strips whole marker tags and never a lone ZWNJ', () => {
    const marked = `Home⁣⁠‌⁡⁤`;
    expect(stripMarkers(marked)).toBe('Home');
    expect(stripMarkers('می‌خواهم')).toBe('می‌خواهم');
    expect('a⁣⁤b'.replace(MARKER_RE, '')).toBe('ab');
  });
});

describe('copy()', () => {
  it('fills holes like fillLine without a resolver; unknown holes stay', () => {
    expect(copy('Adding photo {n} of {total}…', { n: 2, total: 5 })).toBe('Adding photo 2 of 5…');
    expect(copy('Hi {name}, {missing}', { name: 'Ana' })).toBe('Hi Ana, {missing}');
    expect(fillHoles('{a}{b}{c}', { a: null, b: false, c: 0 })).toBe('0');
    expect(copy.plain('LORE reminder')).toBe('LORE reminder');
    expect(copy.list(['Life', 'Of'])).toEqual(['Life', 'Of']);
    // Values are never read as holes.
    expect(copy('{a} {b}', { a: '{b}', b: 'x' })).toBe('{b} x');
  });

  it('uses the last installed resolver, keeps the edges, and stops when removed', () => {
    const first = installCopyResolver((core) => (core === 'Hello {name}' ? 'Ahoy {name}' : undefined));
    expect(copy(' Hello {name} ', { name: 'Ana' })).toBe(' Ahoy Ana ');
    const second = installCopyResolver(() => 'Second');
    expect(copy('Hello {name}')).toBe('Second');
    second();
    expect(copy('Hello {name}', { name: 'B' })).toBe('Ahoy B');
    first();
    expect(copy('Hello {name}', { name: 'B' })).toBe('Hello B');
  });

  it('is exported from #shared too', () => {
    expect(shared.copy).toBe(copy);
    expect(shared.hashText('a')).toBe('e40c292c');
  });
});
