// 12.3: "ALL text" stays true. Runs the collector over every web source (plus the shared vocabulary)
// and fails with `file:line "text"` for anything the live-text layer would miss or break:
//   - a literal with letters under an attribute/prop/default name in no list (vite/copyNames.ts);
//   - prose-like words in a position the transform doesn't reach (use copy(), JSX, or // copy:ignore);
//   - a component called as a function or passed as a value; key= reading words; module-level JSX with
//     words; useMemo with non-literal deps; copy() with non-literal arguments; unknown entities.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCatalog, collectWeb, hashText, listServerSources, scanServerMessages, type CopyIssue } from '../collect.ts';

const results = collectWeb({ legal: ['pages/Legal'] });
const vocab = results.find((r) => r.info.scope === 'shared/vocabulary');
const occurrences = results.flatMap((r) => r.analysis.occurrences);
const server = scanServerMessages(listServerSources().map((file) => ({ file, code: readFileSync(file, 'utf8') })));
const { catalog, errors: catalogErrors } = buildCatalog([...occurrences, ...server.occurrences], 'test');
const list = (issues: CopyIssue[]) => issues.map((i) => `${i.at} [${i.kind}] "${i.text}": ${i.message}`);

describe('coverage', () => {
  it('builds without errors (no collisions, no message-syntax clashes)', () => {
    expect(list([...results.flatMap((r) => r.analysis.errors), ...catalogErrors])).toEqual([]);
  });

  it('leaves no web text unclassified', () => {
    const issues = results
      .filter((r) => r !== vocab)
      .flatMap((r) => r.analysis.issues);
    expect(list(issues)).toEqual([]);
  });

  it('reaches every table in the shared vocabulary', () => {
    // vocabulary.ts is also read by the server. Its words outside tables (signLine) are retold by the
    // Loracle's job and stored with the road, like notification titles: server text through copy()
    // (srv# keys from the server scan), not web copy. Everything else must be clean.
    const lines = readFileSync(vocab!.file, 'utf8').split('\n');
    const from = lines.findIndex((l) => l.startsWith('export function signLine(')) + 1;
    const to = from + lines.slice(from).findIndex((l) => l === '}') + 1;
    const inSignLine = (i: CopyIssue) => {
      const line = Number(i.at.split(':').pop());
      return from > 0 && line >= from && line <= to;
    };
    const issues = vocab!.analysis.issues.filter((i) => !(i.kind === 'prose' && inSignLine(i)));
    expect(list(issues)).toEqual([]);
  });

  it('covers the screens', () => {
    const files = new Set(occurrences.map((o) => o.at.replace(/:\d+$/, '')));
    for (const f of ['pages/Home.tsx', 'pages/Legal.tsx', 'pages/Oracle.tsx', 'components/loracle.tsx', 'components/oracle.tsx', 'lib/dates.ts', 'packages/shared/src/vocabulary.ts']) {
      expect(files).toContain(f);
    }
    expect(Object.keys(catalog.keys).length).toBeGreaterThan(900);
  });

  it('never makes crisis lines, emergency numbers or the helpline link editable', () => {
    const texts = new Set(Object.values(catalog.keys).map((e) => e.text));
    for (const t of ['988 Suicide & Crisis Lifeline', 'Samaritans', '116 123', 'https://findahelpline.com', 'web chat']) expect(texts).not.toContain(t);
    expect(Object.values(catalog.keys).some((e) => /^(CRISIS_LINES|EMERGENCY_NUMBERS|FIND_A_HELPLINE)/.test(e.ctx))).toBe(false);
  });

  it('keeps LORACLE_LINES.wishStart plain (it is data too) and flags legal and consent text', () => {
    const wish = Object.values(catalog.keys).find((e) => e.ctx === 'LORACLE_LINES.wishStart');
    expect(wish?.plain).toBe(1);
    expect(Object.values(catalog.keys).filter((e) => e.at.some((a) => a.startsWith('pages/Legal.tsx'))).every((e) => e.legal === 1)).toBe(true);
    expect(Object.values(catalog.keys).find((e) => e.ctx === 'LORACLE_LINES.consentTitle')?.legal).toBe(1);
  });

  it('keeps the editor and the runtime out of the copy layer', () => {
    expect(occurrences.some((o) => /^(lib\/copy|components\/copyEditor)\//.test(o.at))).toBe(false);
  });

  it('collects static server messages, never templated ones', () => {
    expect(server.occurrences.length).toBeGreaterThan(100);
    expect(Object.keys(catalog.keys).filter((k) => k.startsWith('srv#')).length).toBeGreaterThan(80);
    expect(server.occurrences.every((o) => !o.text.includes('${'))).toBe(true);
  });

  it('collects app.ts say() replies, notification titles and the stone signs as server keys', () => {
    for (const t of ['That file is too large.', 'Not found.', '{actor} wants to be friends', 'The stone listens…', 'It asks the roads about {words}']) {
      expect(catalog.keys[`srv#${hashText(t)}`]?.text).toBe(t);
    }
  });
});
