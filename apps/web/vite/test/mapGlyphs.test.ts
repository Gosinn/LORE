// The Lore Map's own letters (apps/web/public/map-glyphs, drawn by tools/make-map-glyphs.mjs): every file decodes
// as MapLibre's glyphs.proto with a protobuf reader written here, holds only its own range, and the names the map
// shows have every letter. Reads the committed files; doesn't run the generator. Part of `npm run test:copy`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../../public/map-glyphs/', import.meta.url);
const STACKS = ['LORE-Carved-Regular', 'LORE-Carved-Bold', 'LORE-Book-Regular', 'LORE-Book-Italic'];
const RANGES = [0, 256, 512, 768, 7680, 8192].map((start) => `${start}-${start + 255}`);
const BORDER = 3;

interface Glyph {
  id: number;
  bitmap?: Uint8Array;
  width: number;
  height: number;
  left: number;
  top: number;
  advance: number;
}
interface Field {
  no: number;
  int?: number;
  bytes?: Uint8Array;
}

function varint(buf: Uint8Array, at: { pos: number }): number {
  let value = 0;
  let scale = 1;
  for (;;) {
    const b = buf[at.pos++];
    if (b === undefined) throw new Error('truncated varint');
    value += (b & 0x7f) * scale;
    if (!(b & 0x80)) return value;
    scale *= 128;
    if (scale > 2 ** 49) throw new Error('varint too long');
  }
}

/** One message's fields; only the wire types glyphs.proto uses (varint, length-delimited). */
function fieldsOf(buf: Uint8Array): Field[] {
  const at = { pos: 0 };
  const out: Field[] = [];
  while (at.pos < buf.length) {
    const key = varint(buf, at);
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) out.push({ no, int: varint(buf, at) });
    else if (wire === 2) {
      const len = varint(buf, at);
      if (at.pos + len > buf.length) throw new Error('truncated field');
      out.push({ no, bytes: buf.subarray(at.pos, at.pos + len) });
      at.pos += len;
    } else throw new Error(`wire type ${wire} in field ${no}`);
  }
  return out;
}

const unzigzag = (n: number) => (n % 2 ? -(n + 1) / 2 : n / 2);
const text = (f: Field) => new TextDecoder('utf-8', { fatal: true }).decode(f.bytes);

function decodeGlyph(buf: Uint8Array): Glyph {
  const g: Partial<Glyph> = {};
  const seen = new Set<number>();
  for (const f of fieldsOf(buf)) {
    if (seen.has(f.no)) throw new Error(`glyph field ${f.no} twice`);
    seen.add(f.no);
    if (f.no === 1 && f.int !== undefined) g.id = f.int;
    else if (f.no === 2 && f.bytes) g.bitmap = f.bytes;
    else if (f.no === 3 && f.int !== undefined) g.width = f.int;
    else if (f.no === 4 && f.int !== undefined) g.height = f.int;
    else if (f.no === 5 && f.int !== undefined) g.left = unzigzag(f.int);
    else if (f.no === 6 && f.int !== undefined) g.top = unzigzag(f.int);
    else if (f.no === 7 && f.int !== undefined) g.advance = f.int;
    else throw new Error(`unexpected glyph field ${f.no}`);
  }
  for (const k of ['id', 'width', 'height', 'left', 'top', 'advance'] as const) {
    if (g[k] === undefined) throw new Error(`glyph without ${k}`);
  }
  return g as Glyph;
}

function decodeFile(buf: Uint8Array) {
  const top = fieldsOf(buf);
  const stack = top[0];
  if (top.length !== 1 || stack?.no !== 1 || !stack.bytes) throw new Error('expected exactly one fontstack');
  let name: string | undefined;
  let range: string | undefined;
  const glyphs: Glyph[] = [];
  for (const f of fieldsOf(stack.bytes)) {
    if (f.no === 1 && f.bytes) name = text(f);
    else if (f.no === 2 && f.bytes) range = text(f);
    else if (f.no === 3 && f.bytes) glyphs.push(decodeGlyph(f.bytes));
    else throw new Error(`unexpected fontstack field ${f.no}`);
  }
  return { name, range, glyphs };
}

const files = new Map<string, Glyph[]>();
function glyphsOf(stack: string, range: string): Glyph[] {
  const key = `${stack}/${range}`;
  if (!files.has(key)) files.set(key, decodeFile(readFileSync(new URL(`${key}.pbf`, DIR))).glyphs);
  return files.get(key)!;
}
function glyphFor(stack: string, ch: string): Glyph | undefined {
  const cp = ch.codePointAt(0)!;
  const start = Math.floor(cp / 256) * 256;
  return glyphsOf(stack, `${start}-${start + 255}`).find((g) => g.id === cp);
}
const drawn = (g: Glyph | undefined) => !!g && g.width > 0 && g.height > 0 && !!g.bitmap;

describe('map glyphs', () => {
  it('has exactly the four stacks, each with every range and nothing else', () => {
    const dirs = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.sort()).toEqual([...STACKS].sort());
    for (const stack of STACKS) {
      expect(readdirSync(new URL(`${stack}/`, DIR)).sort()).toEqual(RANGES.map((r) => `${r}.pbf`).sort());
    }
  });

  it('decodes every file as glyphs.proto, each glyph in its own range with a bitmap the size MapLibre expects', () => {
    for (const stack of STACKS) {
      for (const range of RANGES) {
        const file = decodeFile(readFileSync(new URL(`${stack}/${range}.pbf`, DIR)));
        expect(file.name).toBe(stack);
        expect(file.range).toBe(range);
        const [start = NaN, end = NaN] = range.split('-').map(Number);
        let last = -1;
        for (const g of file.glyphs) {
          expect(g.id).toBeGreaterThanOrEqual(start);
          expect(g.id).toBeLessThanOrEqual(end);
          expect(g.id).toBeGreaterThan(last); // sorted, no repeats
          last = g.id;
          if (g.width > 0 && g.height > 0) {
            expect(g.bitmap?.length).toBe((g.width + 2 * BORDER) * (g.height + 2 * BORDER));
            expect(g.width).toBeLessThan(80);
            expect(g.height).toBeLessThan(80);
          } else {
            expect(g.bitmap).toBeUndefined();
          }
          expect(g.advance).toBeLessThan(100);
        }
        files.set(`${stack}/${range}`, file.glyphs);
      }
      // Latin-1 is always full.
      expect(glyphsOf(stack, '0-255').length).toBeGreaterThan(180);
    }
  });

  it('draws the Icelandic letters in every stack', () => {
    for (const stack of STACKS) {
      for (const ch of 'þðæöÞÐÆÖ') {
        const g = glyphFor(stack, ch);
        expect(drawn(g), `${stack} ${ch}`).toBe(true);
        // A real distance field: solid inside (past the 192 edge), empty far outside.
        expect(Math.max(...g!.bitmap!)).toBeGreaterThanOrEqual(192);
        expect(Math.min(...g!.bitmap!)).toBe(0);
        expect(g!.advance).toBeGreaterThan(5);
      }
    }
  });

  it('has every letter of European and Vietnamese place names, and a space', () => {
    const names =
      'Seyðisfjörður Þórsmörk Ærøskøbing Łódź Kraków Brașov Târgu Mureș Şanlıurfa Gdańsk Čeština Ūdens ' +
      'Ålesund Göteborg Mərdəkan Ōsaka Hà Nội Đà Nẵng Hồ Chí Minh Sankt-Peterburg Oʻzbekiston Kyïv «Œ» — ’';
    for (const stack of STACKS) {
      for (const ch of new Set(names.replace(/ /g, ''))) expect(drawn(glyphFor(stack, ch)), `${stack} ${ch}`).toBe(true);
      const space = glyphFor(stack, ' ');
      expect(space?.advance).toBeGreaterThan(3);
      expect(drawn(space)).toBe(false);
    }
  });

  it('sits capitals where MapLibre expects them, in every stack', () => {
    // MapLibre's shaping puts a glyph's top edge 17 px above the line's middle minus `top`: an H's top of -10..-8
    // centres the capitals on the label's point, as with Noto Sans.
    for (const stack of STACKS) {
      const h = glyphFor(stack, 'H')!;
      expect(h.top).toBeGreaterThanOrEqual(-10);
      expect(h.top).toBeLessThanOrEqual(-8);
    }
  });

  it('carries the fonts\' licence', () => {
    const licence = new URL('OFL.txt', DIR);
    expect(existsSync(licence)).toBe(true);
    const body = readFileSync(licence, 'utf8');
    expect(body).toContain('SIL OPEN FONT LICENSE');
    for (const who of ['Cinzel', 'Igino Marini', 'Noto']) expect(body).toContain(who);
  });
});
