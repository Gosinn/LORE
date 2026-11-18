// 12.2: the build transform. Golden snippets, equivalence with oxc's own JSX output over every web
// source, keys, collisions, re-parsing and source maps, and the server-message scan.
import { readFileSync } from 'node:fs';
import { parseSync, transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';
import { analyzeFile, collectWeb, hashText, keyFor, proseLike, scanServerMessages, SERVER_SOURCES, splitEdges } from '../collect.ts';
import { copyKey } from '../../../../packages/shared/src/copy.ts';
import { pruneUnshipped, transformCopy } from '../copyPlugin.ts';
import { cleanJsxAttr, cleanJsxText, decodeEntities } from '../jsxText.ts';

const SCOPE = 'pages/T';
const K = (text: string) => keyFor(SCOPE, text);
const q = JSON.stringify;
const t = (code: string, scope = SCOPE) => transformCopy(code, 'T.tsx', { scope });
const out = (code: string, scope = SCOPE) => t(code, scope).code;
/** Output without the prepended runtime import. */
const body = (code: string, scope = SCOPE) => out(code, scope).replace(/^import \{[^}]*\} from "virtual:lore-copy";/, '');
const tm = (text: string, flags = 2) => `__tm(${q(K(text))}, ${q(text)}, {}, ${flags})`;
const tt = (text: string, d = text, plain = false) => `__t(${q(K(text))}, ${q(d)}${plain ? ', 1' : ''})`;
const ofKind = (code: string, kind: string) => t(code).issues.filter((i) => i.kind === kind);

describe('keys and text', () => {
  it('hashes with FNV-1a 32-bit over UTF-16 code units', () => {
    expect(hashText('')).toBe('811c9dc5');
    expect(hashText('a')).toBe('e40c292c');
    expect(hashText('foobar')).toBe('bf9cf968');
    expect(K('Home')).toMatch(/^pages\/T#[0-9a-f]{8}$/);
  });

  it('makes the same keys as shared/copy.ts (server and runtime)', () => {
    for (const s of ['Home', '  Create ', 'Help & contact ', 'Café open', '{n} people', 'It’s 👨‍👩‍👧']) {
      expect(keyFor(SCOPE, splitEdges(s.normalize('NFC'))[1])).toBe(copyKey(SCOPE, s));
    }
  });

  it('splits only ASCII edge whitespace (never NBSP)', () => {
    expect(splitEdges('  Hi \n')).toEqual(['  ', 'Hi', ' \n']);
    expect(splitEdges('\u00a0Hi\u00a0')).toEqual(['', '\u00a0Hi\u00a0', '']);
    expect(splitEdges('   ')).toEqual(['   ', '', '']);
  });

  it('cleans JSX text like React', () => {
    expect(cleanJsxText('\n  Hello\n  world\n')).toBe('Hello world');
    expect(cleanJsxText(' Create')).toBe(' Create');
    expect(cleanJsxText('a\t b')).toBe('a  b');
    expect(cleanJsxText('\n   \n')).toBe('');
    expect(cleanJsxText('Line one\r\n   line two')).toBe('Line one line two');
    expect(cleanJsxAttr('a\n    b')).toBe('a b');
  });

  it('decodes entities and refuses unknown ones', () => {
    expect(decodeEntities('Help &amp; contact')).toBe('Help & contact');
    expect(decodeEntities('it&#8217;s &#x2014; &nbsp;')).toBe('it\u2019s \u2014 \u00a0');
    expect(decodeEntities('a &foo; b')).toBeNull();
    expect(decodeEntities('Tom & Jerry')).toBe('Tom & Jerry');
  });

  it('gives LF and CRLF sources the same keys', () => {
    const lf = 'export function A() {\n  return <p>\n    Hello there\n    friend\n  </p>;\n}\n';
    const keys = (c: string) => t(c).entries.map((e) => e.key);
    expect(keys(lf.replace(/\n/g, '\r\n'))).toEqual(keys(lf));
  });

  it('keeps keys stable across runs; changing a default changes only its key', () => {
    const a = 'export function A() { return <div><p>One</p><p>Two</p></div>; }';
    const b = a.replace('Two', 'Three');
    const keys = (c: string) => t(c).entries.map((e) => e.key);
    expect(keys(a)).toEqual(keys(a));
    expect(keys(b)[0]).toBe(keys(a)[0]);
    expect(keys(b)[1]).not.toBe(keys(a)[1]);
  });

  it('fails the build on two texts with one key', () => {
    // Find a real FNV-1a collision (a birthday search: fast).
    const seen = new Map<string, string>();
    let pair: [string, string] | null = null;
    for (let i = 0; !pair; i++) {
      const s = `Text number ${i.toString(36)}`;
      const h = hashText(s);
      const prev = seen.get(h);
      if (prev) pair = [prev, s];
      else seen.set(h, s);
    }
    const r = t(`export function A() { return <div><p>${pair[0]}</p><p>${pair[1]}</p></div>; }`);
    expect(r.errors.map((e) => e.kind)).toContain('collision');
  });

  it('flags prose-like literals but not code-shaped ones', () => {
    for (const s of ['Hello there', 'Today', 'just now']) expect(proseLike(s)).toBe(true);
    for (const s of ['btn', 'M0 -13 L3.2 0Z', '/events', 'image/png', '.tabs button', 'https://x.y/a b', 'LORE', 'en-GB']) expect(proseLike(s)).toBe(false);
  });

  it('flags single words a ternary puts together around spaces, not class names', () => {
    const words = ofKind('export function A({ n, list }) { const s = `${n === 1 ? "source" : "sources"} ${list}`; return <i title={s} />; }', 'prose');
    expect(words.map((i) => i.text)).toEqual(['source', 'sources']);
    expect(ofKind('export function A({ on }) { const c = `${on ? "is-on" : "is_off"} ${on}`; return <i className={c} />; }', 'prose')).toEqual([]);
  });
});

describe('JSX children (messages)', () => {
  it('rewrites plain text in node mode', () => {
    expect(body('export function A() { return <h2>The one who almost stayed home</h2>; }')).toBe(
      `export function A() { __useCopy(); return <h2>{${tm('The one who almost stayed home')}}</h2>; }`,
    );
  });

  it('cleans whitespace and newlines like React', () => {
    const code = 'export function A() {\n  return (\n    <p>\n      Hello there,\n      friend.\n    </p>\n  );\n}';
    expect(t(code).entries[0]!.text).toBe('Hello there, friend.');
  });

  it("joins {' '} into the message", () => {
    expect(t("export function A() { return <p>Hello{' '}world</p>; }").entries[0]!.text).toBe('Hello world');
  });

  it('leaves a leading icon outside and the space as a plain child', () => {
    expect(body('export function A() { return <button><Plus size={18} /> Create</button>; }')).toBe(
      `export function A() { __useCopy(); return <button><Plus size={18} />{" "}{${tm('Create')}}</button>; }`,
    );
  });

  it('emits trailing whitespace outside the call', () => {
    expect(body('export function A() { return <p>Go <X /></p>; }')).toContain(`{${tm('Go')}}{" "}<X />`);
  });

  it('decodes entities; NBSP at an edge stays in the text', () => {
    expect(t('export function A() { return <p>Help &amp; contact&nbsp;</p>; }').entries[0]!.text).toBe('Help & contact\u00a0');
    expect(t('export function A() { return <p>It&#8217;s here</p>; }').entries[0]!.text).toBe('It\u2019s here');
  });

  it('leaves text with an unknown entity alone and reports it', () => {
    const r = t('export function A() { return <p>Fish &chips; here</p>; }');
    expect(r.entries).toHaveLength(0);
    expect(r.issues.map((i) => i.kind)).toContain('entity');
  });

  it('makes one message of text around an element, with the element as a value', () => {
    const r = body('export function A() { return <p>Read the <Link to="/terms">Terms</Link> before you start.</p>; }');
    expect(r).toContain(
      `<p>{__tm(${q(K('Read the {Link} before you start.'))}, "Read the {Link} before you start.", { "Link": <Link to="/terms">{${tm('Terms')}}</Link>, }, 2)}</p>`,
    );
  });

  it('names placeholders from identifiers, members, counts and calls', () => {
    const r = t('export function A() { return <p>Hi {user.displayName}, {items.length} new, {countryName(c)} and {who}</p>; }');
    expect(r.entries[0]!.text).toBe('Hi {displayName}, {itemsCount} new, {countryName} and {who}');
    expect(r.entries[0]!.ph).toEqual({ displayName: 'user.displayName', itemsCount: 'items.length', countryName: 'countryName(c)', who: 'who' });
  });

  it('numbers unnamed placeholders and suffixes duplicates', () => {
    expect(t('export function A() { return <p>{a ? b : c} and {n} or {n} then {x + 1}</p>; }').entries[0]!.text).toBe('{0} and {n} or {n2} then {1}');
  });

  it('keeps inline tags as markup in the message, not placeholders', () => {
    const r = t('export function A() { return <p>Stay with his <em>garden</em>. Then <strong>go</strong>.<br />Now.</p>; }');
    expect(r.entries[0]!.text).toBe('Stay with his <em>garden</em>. Then <strong>go</strong>.<br/>Now.');
    expect(r.code).toContain('{}, 2)}');
  });

  it('treats a tag with attributes as an atom', () => {
    expect(t('export function A() { return <p>Say <b className="x">hi</b> now</p>; }').entries[0]!.text).toBe('Say {b} now');
  });

  it('leaves an empty inline tag (a swatch) outside the message', () => {
    const r = t('export function A() { return <span><i /> Shared plans</span>; }');
    expect(r.entries.map((e) => e.text)).toEqual(['Shared plans']);
    expect(r.code).toContain('<i />');
    expect(t('export function A() { return <p>Go<br />now</p>; }').entries[0]!.text).toBe('Go<br/>now');
  });

  it('reports a syntax error at its own line', () => {
    const r = t('export function A() {\n  return 1;\n}\nconst x = <p>open;\n');
    expect(r.errors.map((e) => e.kind)).toEqual(['parse']);
    expect(r.errors[0]!.at).not.toBe('T.tsx:1');
  });

  it('quotes value keys, so Vite define still replaces the value', () => {
    const r = out('export function A() { return <p>LORE {__LORE_VERSION__} · build {__LORE_BUILD__} here</p>; }');
    expect(r).toContain('{ "__LORE_VERSION__": __LORE_VERSION__, "__LORE_BUILD__": __LORE_BUILD__, }');
    expect(r).not.toMatch(/[{,] __LORE_VERSION__[,}]/); // never shorthand
  });

  it('wraps a sequence expression value in parentheses', () => {
    expect(out('function f() { confirm(`Go ${a, b} now`); }')).toContain(`"Go {0} now", { "0": (a, b) }, 0)`);
    expect(out('export function A() { return <p>See {(a, b)} now</p>; }')).toContain('"0": (a, b),');
  });

  it('takes values at the edges into the message, never elements', () => {
    expect(t('export function A() { return <p>{n} people</p>; }').entries[0]!.text).toBe('{n} people');
    expect(t('export function A() { return <p>LORE {v} · build {b}</p>; }').entries[0]!.text).toBe('LORE {v} · build {b}');
    expect(t('export function A() { return <p><Plus /> Create {x && <b>!</b>}</p>; }').entries[0]!.text).toBe('Create');
  });

  it('uses string mode inside <option>', () => {
    expect(body('export function A() { return <select><option value="">No crew</option></select>; }')).toContain(`<option value="">{${tt('No crew')}}</option>`);
    expect(out('export function A() { return <select><option>{n} days</option></select>; }')).toContain(`__tm(${q(K('{n} days'))}, "{n} days", { "n": n, }, 0)`);
    expect(t('export function A() { return <select><option>No crew</option></select>; }').entries[0]!.kind).toBe('s');
  });

  it('refuses an element placeholder in string mode', () => {
    expect(t('export function A() { return <option>Go <b className="x">now</b> please</option>; }').errors.map((e) => e.kind)).toContain('string-element');
  });

  it('counts only literal parts as text', () => {
    const r = t("export function A() { return <span>{realm?.country ? ` (${countryName(realm.country)})` : ''}</span>; }");
    expect(r.entries).toHaveLength(0);
    expect(r.changed).toBe(true); // only the hook
    expect(t('export function A() { return <span>+{n}</span>; }').entries).toHaveLength(0);
  });

  it('ignores JSX comments', () => {
    const r = t('export function A() { return <p>Hello {/* the greeting */} world</p>; }');
    expect(r.entries[0]!.text).toBe('Hello  world');
    expect(r.code).not.toContain('the greeting');
  });

  it('refuses a default that reads as message syntax', () => {
    expect(t("export function A() { return <p>{'{n}'} items: {n}</p>; }").errors.map((e) => e.kind)).toContain('syntax');
  });

  it('rewrites UI expressions in children: ternaries, &&, ??', () => {
    const r = body("export function A() { return <button>{busy ? 'Sending…' : 'Send report'}{x && 'More'}{y ?? 'None'}</button>; }");
    expect(r).toContain(`{busy ? ${tt('Sending…')} : ${tt('Send report')}}`);
    expect(r).toContain(`{x && ${tt('More')}}`);
    expect(r).toContain(`{y ?? ${tt('None')}}`);
  });
});

describe('skipping', () => {
  it('removes data-copy="off" and leaves the subtree alone', () => {
    const r = t('export function A() { return <span data-copy="off" className="x">L<span>O</span>RE</span>; }');
    expect(r.entries).toHaveLength(0);
    expect(r.code).toContain('<span  className="x">L<span>O</span>RE</span>');
  });

  it('leaves <code>, <pre> and <textarea> children, but a textarea placeholder is copy', () => {
    const r = t('export function A() { return <div><code>npm run dev</code><pre>Some text</pre><textarea placeholder="Say it">Draft</textarea></div>; }');
    expect(r.entries.map((e) => e.text)).toEqual(['Say it']);
  });

  it('honours // copy:ignore and {/* copy:ignore */}', () => {
    const r = t(`export function A() {
  // copy:ignore
  const sel = 'a[href], button';
  return <div>{/* copy:ignore */}<p>Keep me</p><p>Change me</p></div>;
}`);
    expect(r.entries.map((e) => e.text)).toEqual(['Change me']);
    expect(r.issues).toHaveLength(0);
  });

  it('marks // copy:plain texts as never marked (flag 1)', () => {
    const r = t(`export function A() {
  // copy:plain
  const start = { label: 'I wish ' };
  return <p>{start.label}</p>;
}`);
    expect(r.code).toContain(tt('I wish', 'I wish ', true));
    expect(r.entries[0]!.plain).toBe(true);
  });
});

describe('attributes and props', () => {
  it('rewrites text DOM attributes', () => {
    const r = body('export function A() { return <input placeholder="Search" title="Find" aria-label="Find people" alt="" />; }');
    expect(r).toContain(`placeholder={${tt('Search')}} title={${tt('Find')}} aria-label={${tt('Find people')}} alt=""`);
  });

  it('rewrites label only on option/optgroup/track; elsewhere it must be classified', () => {
    expect(out('export function A() { return <optgroup label="Crews" />; }')).toContain(`label={${tt('Crews')}}`);
    expect(ofKind('export function A() { return <div label="Crews" />; }', 'name')).toHaveLength(1);
  });

  it('rewrites component text props to strings', () => {
    expect(body('export function A() { return <Section title="Help" more={<Link to="/x">All</Link>}>x</Section>; }')).toContain(`<Section title={${tt('Help')}}`);
    expect(out('export function A() { return <Field label="Name" hint="Shown to friends" htmlFor="n" />; }')).toContain(`hint={${tt('Shown to friends')}} htmlFor="n"`);
  });

  it('reports a literal under a name in no list', () => {
    expect(ofKind('export function A() { return <Thing caption="Hello there" />; }', 'name')).toHaveLength(1);
    expect(ofKind('export function A() { return <Thing caption={x ? "Hello there" : "Bye"} />; }', 'name')).toHaveLength(1);
  });

  it('never touches className, to, href, style or data-*', () => {
    const code = 'export function A() { return <a className={`btn ${x ? "btn-primary" : ""}`} href="/Help Me" to="/x" data-x="Some words" style={{ fontFamily: "Fraunces, serif" }} />; }';
    const r = t(code);
    expect(r.entries).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });

  it('rewrites template literals in text attributes as string messages', () => {
    expect(out('export function A() { return <a aria-label={`Notifications${n ? ` (${n} new)` : ""}`} />; }')).toContain(
      `aria-label={__tm(${q(K('Notifications{0}'))}, "Notifications{0}", { "0": n ? __tm(${q(K('({n} new)'))}, " ({n} new)", { "n": n }, 0) : "" }, 0)}`,
    );
  });

  it('rewrites default values of text props', () => {
    expect(body("export function CommentBox({ placeholder = 'Say something…', size = 'md' }) { return <textarea placeholder={placeholder} />; }")).toContain(
      `placeholder = ${tt('Say something…')}, size = 'md'`,
    );
  });

  it('flags key= reading words', () => {
    expect(ofKind('export function A() { return <ul>{items.map((t) => <li key={t.label}>{t.label}</li>)}</ul>; }', 'key')).toHaveLength(1);
    expect(ofKind("export function A() { return <ul>{['Life', 'Of'].map((word) => <li key={word}>{word}</li>)}</ul>; }", 'key')).toHaveLength(1);
    expect(ofKind('export function A() { return <ul>{items.map((t, i) => <li key={i}>{t.label}</li>)}</ul>; }', 'key')).toHaveLength(0);
  });
});

describe('sinks, objects, tables', () => {
  it('rewrites confirm/alert/prompt messages, templates with placeholders', () => {
    const r = out("function f() { if (confirm('Delete this chapter?')) alert(`Leave ${crew.name}?`); window.confirm('Sure?'); }");
    expect(r).toContain(`confirm(${tt('Delete this chapter?')})`);
    expect(r).toContain(`alert(__tm(${q(K('Leave {name}?'))}, "Leave {name}?", { "name": crew.name }, 0))`);
    expect(r).toContain(`window.confirm(${tt('Sure?')})`);
  });

  it('makes module-level text keys getters and inlines them inside functions', () => {
    const r = body("const NAV = [{ to: '/', label: 'Home', icon: Home }];\nfunction f() { return [{ label: 'Tomorrow morning', at: 9 }]; }");
    expect(r).toContain(`{ to: '/', get label() { return ${tt('Home')}; }, icon: Home }`);
    expect(r).toContain(`{ label: ${tt('Tomorrow morning')}, at: 9 }`);
  });

  it('turns *_LABELS / *_LINES / copy:table consts into getters at any depth, code keys untouched', () => {
    const r = t(`export const INTEREST_LABELS = { nature: { label: 'Wild nature', emoji: '🌋' }, water: 'Hot water' };
// copy:table
const L = { signAsk: 'Will you choose it?', to: '/x' } as const;
// copy:table
const DOW = ['Mon', 'Tue'];`);
    expect(r.code).toContain(`nature: { get label() { return ${tt('Wild nature')}; }, emoji: '🌋' }`);
    expect(r.code).toContain(`get water() { return ${tt('Hot water')}; }`);
    expect(r.code).toContain(`get signAsk() { return ${tt('Will you choose it?')}; }, to: '/x'`);
    expect(r.code).toContain(`const DOW = __tl([${q(K('Mon'))}, ${q(K('Tue'))}], ["Mon", "Tue"]);`);
    expect(r.entries.map((e) => e.ctx)).toEqual(['INTEREST_LABELS.nature.label', 'INTEREST_LABELS.water', 'L.signAsk', 'DOW[0]', 'DOW[1]']);
  });

  it('never makes crisis data editable, though CRISIS_LINES ends in _LINES', () => {
    const r = t("export const CRISIS_LINES = { IS: { name: 'Hjálparsíminn', number: '1717', text: 'web chat' } };\nexport const EMERGENCY_NUMBERS = { US: '911' };");
    expect(r.entries).toHaveLength(0);
    expect(r.changed).toBe(false);
  });

  it('keeps LORACLE_LINES.wishStart plain and flags consent lines as legal', () => {
    const r = t("export const LORACLE_LINES = { wishStart: 'I wish ', consentTitle: 'Before the stone reads your wish', title: 'The Loracle' };", 'shared/vocabulary');
    const by = Object.fromEntries(r.entries.map((e) => [e.ctx, e]));
    expect(by['LORACLE_LINES.wishStart']!.plain).toBe(true);
    expect(r.code).toContain(`__t(${q(keyFor('shared/vocabulary', 'I wish'))}, "I wish ", 1)`);
    expect(by['LORACLE_LINES.consentTitle']!.legal).toBe(true);
    expect(by['LORACLE_LINES.title']!.legal).toBeUndefined();
  });

  it('flags every text in a legal scope', () => {
    const r = transformCopy('export function T() { return <p>We keep your data.</p>; }', 'x.tsx', { scope: 'pages/Legal', legal: ['pages/Legal'] });
    expect(r.entries[0]!.legal).toBe(true);
  });
});

describe('copy()', () => {
  it('rewrites copy, copy.plain and copy.list and drops the import', () => {
    const r = out(`import { copy, fillLine } from '#shared';
function f(n: number) {
  return [copy('Today'), copy('{n} min ago', { n }), copy.plain('LORE reminder'), copy.list(['Life', 'Of'])];
}`);
    expect(r).toContain("import { fillLine } from '#shared';");
    expect(r).toContain(tt('Today'));
    expect(r).toContain(`__tm(${q(K('{n} min ago'))}, "{n} min ago", { n }, 0)`);
    expect(r).toContain(tt('LORE reminder', 'LORE reminder', true));
    expect(r).toContain(`__tl([${q(K('Life'))}, ${q(K('Of'))}], ["Life", "Of"])`);
  });

  it('keeps the import while a copy() call is left (non-literal), and reports it', () => {
    const r = t("import { copy } from '#shared';\nfunction f(x: string) { return [copy(x), copy('Hi')]; }");
    expect(r.code).toContain("import { copy } from '#shared';");
    expect(r.issues.map((i) => i.kind)).toContain('copy-arg');
  });

  it('leaves an unrelated local copy alone', () => {
    const r = t("function f(copy: (s: string) => string) { return copy('Hello'); }");
    expect(r.code).not.toContain('__t(');
  });

  it('warns about copy() at module level', () => {
    expect(t("import { copy } from '#shared';\nconst UPDATED = copy('18 November 2026');").warnings.map((w) => w.kind)).toContain('module-copy');
  });
});

describe('re-render hooks', () => {
  it('injects __useCopy into declarations, arrows (block and expression) and memo wrappers', () => {
    const r = out(`export function A() { return <p>Hi</p>; }
export default function B() { return null ?? <i />; }
const C = () => <p>Yo</p>;
const D = memo(function D() { return <b />; });
const E = forwardRef((p, ref) => { return <span ref={ref} />; });`);
    expect(r).toContain('export function A() { __useCopy(); return');
    expect(r).toContain('export default function B() { __useCopy(); return');
    expect(r).toContain('const C = () => { __useCopy(); return <p>');
    expect(r).toContain('</p>; };');
    expect(r).toContain('const D = memo(function D() { __useCopy(); return');
    expect(r).toContain('const E = forwardRef((p, ref) => { __useCopy(); return');
  });

  it('skips lowercase functions and components without words or JSX', () => {
    const r = out('function row() { return <p>Hi</p>; }\nexport function Sync() { useEffect(() => {}, []); return null; }');
    expect(r).not.toContain('__useCopy();');
  });

  it('adds the copy tick to literal useMemo deps', () => {
    const r = out('export function A() { const a = useMemo(f, [x]); const b = useMemo(g, []); const c = useMemo(h, [y,]); return <p>{a}{b}{c}</p>; }');
    expect(r).toContain('useMemo(f, [x, __copyTick()])');
    expect(r).toContain('useMemo(g, [__copyTick()])');
    expect(r).toContain('useMemo(h, [y, __copyTick()])');
    expect(ofKind('export function A() { const a = useMemo(f, deps); return <p>{a}</p>; }', 'memo-deps')).toHaveLength(1);
  });

  it('imports only the runtime names it uses', () => {
    expect(out('export function A() { return <p>Hi</p>; }')).toMatch(/^import \{ __tm, __useCopy \} from "virtual:lore-copy";/);
    expect(t('const x = 1;').changed).toBe(false);
  });

  it('flags components called as functions or passed as values', () => {
    expect(ofKind('function Row() { return <li />; }\nexport function L() { return <ul>{items.map(Row)}{Row()}</ul>; }', 'pascal')).toHaveLength(2);
    expect(ofKind('function Row() { return <li />; }\nconst R = lazy(Row);\nconst r = { Component: Row };', 'pascal')).toHaveLength(0);
  });

  it('flags module-level JSX with words', () => {
    expect(ofKind('export const routes = [{ element: <p>Not found</p> }];', 'module-jsx')).toHaveLength(1);
  });
});

describe('output', () => {
  const code = readFileSync(new URL('../../src/components/ui.tsx', import.meta.url), 'utf8');
  it('re-parses and maps back to the original lines', async () => {
    const r = transformCopy(code, 'components/ui.tsx', { scope: 'components/ui' });
    expect(parseSync('ui.tsx', r.code, { lang: 'tsx' }).errors).toHaveLength(0);
    const { SourceMapConsumer } = await import('source-map-js').catch(() => ({ SourceMapConsumer: null }));
    if (SourceMapConsumer) {
      const smc = new SourceMapConsumer(r.map as never);
      const lines = r.code.split('\n');
      const line = lines.findIndex((l) => l.includes('"Go home"')) + 1;
      const pos = smc.originalPositionFor({ line, column: lines[line - 1]!.indexOf('__tm') });
      expect(code.split('\n')[pos.line - 1]).toMatch(/Go home|<Link to="\/"/);
    } else {
      expect(r.map.mappings.length).toBeGreaterThan(0);
    }
  });
});

describe('equivalence with oxc (every web source)', () => {
  // Our cleaning and decoding must match what oxc's JSX transform hands React, file by file.
  const sources = collectWeb();
  type N = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const walk = (n: unknown, f: (n: N) => void): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, f));
    const node = n as N;
    if (typeof node.type === 'string') f(node);
    for (const k in node) if (k !== 'type' && node[k] && typeof node[k] === 'object') walk(node[k], f);
  };
  const isStr = (n: N | null | undefined) => n?.type === 'Literal' && typeof n.value === 'string';
  const sortCount = (xs: string[]) => [...xs].sort();

  it.each(sources.map((s) => [s.info.display, s] as const))('%s', async (_name, s) => {
    const code = readFileSync(s.file, 'utf8');
    const lang = s.info.display.endsWith('.tsx') ? 'tsx' : 'ts';
    // Ours, from the source.
    const ours = { children: [] as string[], attrs: [] as string[] };
    walk(parseSync(s.file, code, { lang, astType: 'ts' }).program, (n) => {
      if (n.type === 'JSXText') {
        const v = cleanJsxText(decodeEntities(n.value) ?? n.value);
        if (v) ours.children.push(v);
      } else if ((n.type === 'JSXElement' || n.type === 'JSXFragment') && n.children) {
        for (const c of n.children) if (c.type === 'JSXExpressionContainer' && isStr(c.expression)) ours.children.push(c.expression.value);
      } else if (n.type === 'JSXAttribute' && n.name.name !== 'key' && n.value) {
        if (isStr(n.value)) ours.attrs.push(cleanJsxAttr(decodeEntities(n.value.value) ?? n.value.value));
        else if (n.value.type === 'JSXExpressionContainer' && isStr(n.value.expression)) ours.attrs.push(n.value.expression.value);
      }
    });
    // oxc's, from its compiled output.
    const compiled = await transformWithOxc(code, s.file, { lang, jsx: { runtime: 'automatic' } });
    const theirs = { children: [] as string[], attrs: [] as string[] };
    walk(parseSync('out.js', compiled.code, { lang: 'js' }).program, (n) => {
      if (n.type !== 'CallExpression') return;
      const name = n.callee.type === 'Identifier' ? n.callee.name : '';
      if (!/^_?(jsxs?|jsxDEV|createElement)$/.test(name)) return;
      const props = n.arguments[1];
      if (props?.type === 'ObjectExpression') {
        for (const p of props.properties) {
          if (p.type !== 'Property' || p.computed) continue;
          const k = p.key.name ?? p.key.value;
          if (k === 'children') {
            if (isStr(p.value)) theirs.children.push(p.value.value);
            else if (p.value.type === 'ArrayExpression') for (const e of p.value.elements) if (isStr(e)) theirs.children.push(e.value);
          } else if (k !== 'key' && isStr(p.value)) theirs.attrs.push(p.value.value);
        }
      }
      if (/createElement$/.test(name)) for (const a of n.arguments.slice(2)) if (isStr(a)) theirs.children.push(a.value);
    });
    expect(sortCount(ours.children)).toEqual(sortCount(theirs.children));
    expect(sortCount(ours.attrs)).toEqual(sortCount(theirs.attrs));

    // Every rendered text with words is a catalog default or message part, or skipped on purpose.
    const known = new Set([...s.analysis.occurrences.flatMap((o) => o.parts ?? []), ...s.analysis.skipped]);
    const missing = theirs.children.filter((v) => /[\p{L}\p{N}]/u.test(v) && !known.has(v));
    expect(missing).toEqual([]);
  });
});

describe('server messages (5.6)', () => {
  const scan = (code: string, file = 'D:/LORE APP/apps/api/src/routes/x.ts') => scanServerMessages([{ file, code }]);

  it('collects static messages and fields, and leaves templated ones out', () => {
    const r = scan(`throw badRequest('Pick a day', { day: 'Pick a day first' });
throw new HttpError(409, 'sealed', 'Still sealed.');
throw notFound('Plan');
throw notFound();
throw conflict(\`\${name} is taken\`);
throw new HttpError(503, 'asleep', LORACLE_LINES.asleep);
reply.send({ error: { code: 'rate_limited', message: 'Slow down a little and try again.' } });`);
    expect(r.occurrences.map((o) => o.text)).toEqual(['Pick a day', 'Pick a day first', 'Still sealed.', 'Plan could not be found.', 'That could not be found.', 'Slow down a little and try again.']);
    expect(r.occurrences.every((o) => o.key === `srv#${hashText(o.text)}`)).toBe(true);
    expect(r.notEditable).toHaveLength(1);
  });

  it('collects the error helpers defaults and zod messages', () => {
    const errors = scan("export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);\nexport const notFound = (what = 'That') => 1;", 'D:/LORE APP/apps/api/src/lib/errors.ts');
    expect(errors.occurrences.map((o) => o.text)).toEqual(['Sign in to continue.', 'That could not be found.']);
    const inputs = scan("const A = z.string().min(10, 'Use at least 10 characters');\nconst B = z.literal(true, { error: 'Please agree' });\nconst C = x.refine(f, { message: 'The end must be after the start', path: ['endsAt'] });", 'D:/LORE APP/packages/shared/src/inputs.ts');
    expect(inputs.occurrences.map((o) => o.text)).toEqual(['Use at least 10 characters', 'Please agree', 'The end must be after the start']);
  });

  it('collects server copy() calls (R2)', () => {
    const r = scan("import { copy } from '#shared';\nconst title = copy('{name} invited you to {crew}', { name, crew });");
    expect(r.occurrences.map((o) => o.text)).toEqual(['{name} invited you to {crew}']);
  });
});

// The analysis is also what the catalog is built from.
it('analyzeFile and transformCopy agree', () => {
  const code = 'export function A() { return <p title="Hi">Hello <b>you</b></p>; }';
  const a = analyzeFile(code, { scope: SCOPE, display: 'T.tsx', screen: 'T', legal: false });
  expect(a.s.toString()).toBe(out(code));
  expect(a.occurrences.map((o) => o.key)).toEqual(t(code).entries.map((e) => e.key));
});

it('drops catalog keys no chunk ships, keeping server messages and word lists the server names', () => {
  const e = (ctx: string) => ({ text: ctx, kind: 's' as const, at: ['x.ts:1'], ctx });
  const c = {
    build: 't',
    keys: {
      'pages/A#00000001': e('A › p'),
      'pages/A#00000002': e('A › span'),
      'srv#00000003': e('Server text'),
      'shared/vocabulary#00000004': e('INTEREST_LABELS.nature.label'),
      'shared/vocabulary#00000005': e('LORACLE_LINES.asleep'),
    },
  };
  pruneUnshipped(c, { 'a.js': { type: 'chunk', code: '__t("pages/A#00000001","A › p")' }, 'a.css': { type: 'asset' } }, SERVER_SOURCES);
  // LORACLE_LINES is named by the API (it says those lines); INTEREST_LABELS is used nowhere.
  expect(Object.keys(c.keys)).toEqual(['pages/A#00000001', 'srv#00000003', 'shared/vocabulary#00000005']);
});
