// The Lore Map's own lettering: MapLibre draws every label from signed-distance-field glyphs it fetches from one
// URL template (`glyphs` in the style, `{fontstack}/{range}.pbf`). This draws those files from the fonts the app
// already ships (Cinzel, IM Fell English; @fontsource, SIL OFL 1.1), so the map's names are in LORE's letters, not
// a glyph server's Noto Sans. `npm run map-glyphs`; the output is committed (apps/web/public/map-glyphs).
//
// Pure Node plus opentype.js (reads the WOFF files); the distance field is computed here from the outlines, no
// canvas. The files follow MapLibre's glyphs.proto and node-fontnik's conventions: 24 px glyphs, a 3 px border,
// SDF radius 8 px with the edge at 192/255 (cutoff 0.25), the same as MapLibre's own local glyphs.
//
// Two choices of our own:
// - Baseline: a glyph's `top` is measured from a per-stack line placed so the capitals sit where MapLibre's Noto Sans
//   capitals sit (MapLibre centres every font with one fixed offset, tuned for Noto/Open Sans), so labels stay
//   centred on their points whatever the font's own ascender says.
// - Fill: a code point the LORE font lacks (IM Fell ships Latin-1 only: Ł, ő, ș, Vietnamese; Cinzel has no Greek)
//   is drawn from Noto Serif (OFL; serif, to sit with Cinzel and IM Fell), scaled to the LORE font's cap height, so
//   no Latin name loses a letter. Noto Serif is downloaded once from the official notofonts repo (pinned commit,
//   checked by SHA-256) into a folder outside the repo; pass --fonts <dir> or set LORE_GLYPH_FONTS to choose it.
//
// The stacks have LORE's own names, not the fonts': IM Fell's licence reserves the name "IM FELL", and these files
// mix in Noto glyphs. MapLibre reads "Bold" and "Italic" out of a stack's name for the few glyphs it draws itself.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'apps/web/public/map-glyphs');
const FONTSOURCE = path.join(ROOT, 'node_modules/@fontsource');

/** Ranges of 256 code points: Latin (Basic, Latin-1, Extended A/B, Additional), modifiers, combining marks, Greek,
 * punctuation and currency. Enough for every name:latin; a range not here makes MapLibre draw locally (warns once). */
export const RANGES = [0, 256, 512, 768, 7680, 8192];

const fell = (f) => path.join(FONTSOURCE, 'im-fell-english/files', f);
const cinzel = (f) => path.join(FONTSOURCE, 'cinzel/files', f);

/** Each stack: the LORE font's files (first one that has the code point wins), then the Noto Serif fill. */
export const STACKS = [
  {
    name: 'LORE-Carved-Regular',
    files: [cinzel('cinzel-latin-400-normal.woff'), cinzel('cinzel-latin-ext-400-normal.woff')],
    fill: 'NotoSerif-Regular.ttf',
  },
  {
    name: 'LORE-Carved-Bold',
    files: [cinzel('cinzel-latin-700-normal.woff'), cinzel('cinzel-latin-ext-700-normal.woff')],
    fill: 'NotoSerif-Bold.ttf',
  },
  {
    name: 'LORE-Book-Regular',
    files: [fell('im-fell-english-latin-400-normal.woff')],
    fill: 'NotoSerif-Regular.ttf',
  },
  {
    name: 'LORE-Book-Italic',
    files: [fell('im-fell-english-latin-400-italic.woff')],
    fill: 'NotoSerif-Italic.ttf',
  },
];

// Noto Serif from the Noto project's own repository, pinned to one commit and checked.
const NOTO_COMMIT = '28b15b4b43b7bed62b5cf6e6b0b5ff5846270535';
const NOTO_URL = (file) =>
  `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${NOTO_COMMIT}/fonts/NotoSerif/unhinted/ttf/${file}`;
const NOTO_SHA256 = {
  'NotoSerif-Regular.ttf': 'a15cfbbc1539d707115111d672d590a3d70d4f74b4c0a315956da20ae19a14e1',
  'NotoSerif-Bold.ttf': '24ad531e6b05ddad8c3d89572d2c93eb86a6b74e652ce7ee3c3e171de68e84c3',
  'NotoSerif-Italic.ttf': 'c4b3c971741ecdb40f5a443bce754e8fe91efe761b6ea10c92be7c3597cdadc4',
};

// MapLibre's glyph geometry (node-fontnik, sdf-glyph-foundry; maplibre-gl's GlyphManager uses the same numbers).
const SIZE = 24; // px per em
const BORDER = 3; // px around every bitmap (GLYPH_PBF_BORDER)
const RADIUS = 8; // px of distance the 0..255 scale covers
const CUTOFF = 0.25; // where the edge sits on that scale (192)
// MapLibre's fixed vertical offset puts a line's baseline 17 px below the top of its glyph box plus the glyph's
// `top`. With Noto Sans (ascender 26 px, caps 17.1 px) the capitals' middle sits 0.43 px below the anchor: match it.
const SHAPING_OFFSET = 17;
const NOTO_SANS_CAP_MIDDLE = 26 - 17.14 / 2 - SHAPING_OFFSET;

const FLATTEN_STEP = 0.3; // px: curve pieces
const MAX_PIECE = 0.5; // px: longest straight piece (the seam test looks at each piece's middle)

// ---------------------------------------------------------------------------------------------------------------
// Fonts

function load(file) {
  const buf = readFileSync(file);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function fontsDir() {
  const i = process.argv.indexOf('--fonts');
  if (i > 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  if (process.env.LORE_GLYPH_FONTS) return path.resolve(process.env.LORE_GLYPH_FONTS);
  // This machine keeps downloads on D: (CLAUDE.md); elsewhere, the system's temp folder.
  return process.platform === 'win32' ? 'D:/LORE-devenv/fonts/noto-serif' : path.join(tmpdir(), 'lore-noto-serif');
}

async function fillFont(dir, file) {
  const local = path.join(dir, file);
  if (!existsSync(local)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Downloading ${file} (Noto Serif, OFL) from github.com/notofonts into ${dir}`);
    const res = await fetch(NOTO_URL(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // Checked before it is kept, so a bad download never sits there failing every later run.
    if (createHash('sha256').update(bytes).digest('hex') !== NOTO_SHA256[file]) {
      throw new Error(`${file} from github.com/notofonts is not the pinned Noto Serif file (SHA-256 differs)`);
    }
    writeFileSync(local, bytes);
  }
  if (sha256(local) !== NOTO_SHA256[file]) throw new Error(`${local} is not the pinned Noto Serif file (SHA-256 differs)`);
  return local;
}

/** Height of the capitals in em, from the H's outline (OS/2's figure is missing or rounded in some fonts). */
function capHeight(font) {
  const box = font.charToGlyph('H').getBoundingBox();
  return box.y2 / font.unitsPerEm;
}

function copyrightOf(font) {
  const n = font.names;
  const c = n.copyright ?? n.windows?.copyright ?? n.macintosh?.copyright ?? {};
  return c.en ?? Object.values(c)[0] ?? '';
}

// ---------------------------------------------------------------------------------------------------------------
// Outlines → straight pieces (px, y up)

function piecesOf(glyph, scale) {
  const segs = []; // x0, y0, x1, y1 per piece
  let sx = 0;
  let sy = 0;
  let cx = 0;
  let cy = 0;
  let open = false;
  const line = (x, y) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x - cx, y - cy) / MAX_PIECE));
    let px = cx;
    let py = cy;
    for (let i = 1; i <= n; i++) {
      const nx = i === n ? x : cx + ((x - cx) * i) / n;
      const ny = i === n ? y : cy + ((y - cy) * i) / n;
      if (nx !== px || ny !== py) segs.push(px, py, nx, ny);
      px = nx;
      py = ny;
    }
    cx = x;
    cy = y;
  };
  const close = () => {
    if (open && (cx !== sx || cy !== sy)) line(sx, sy);
    open = false;
  };
  for (const c of glyph.path.commands) {
    const t = c.type;
    if (t === 'M') {
      close();
      sx = cx = c.x * scale;
      sy = cy = c.y * scale;
      open = true;
    } else if (t === 'L') {
      line(c.x * scale, c.y * scale);
    } else if (t === 'Q') {
      const [x0, y0, x1, y1, x2, y2] = [cx, cy, c.x1 * scale, c.y1 * scale, c.x * scale, c.y * scale];
      const n = Math.max(1, Math.ceil((Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1)) / FLATTEN_STEP));
      for (let i = 1; i <= n; i++) {
        const s = i / n;
        const u = 1 - s;
        line(u * u * x0 + 2 * u * s * x1 + s * s * x2, u * u * y0 + 2 * u * s * y1 + s * s * y2);
      }
    } else if (t === 'C') {
      const [x0, y0] = [cx, cy];
      const [x1, y1, x2, y2, x3, y3] = [c.x1, c.y1, c.x2, c.y2, c.x, c.y].map((v) => v * scale);
      const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const n = Math.max(1, Math.ceil(len / FLATTEN_STEP));
      for (let i = 1; i <= n; i++) {
        const s = i / n;
        const u = 1 - s;
        line(
          u * u * u * x0 + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * x3,
          u * u * u * y0 + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * y3,
        );
      }
    } else if (t === 'Z') {
      close();
    }
  }
  close();
  return segs;
}

/** Non-zero winding number of the outline around (x, y): a ray to the right. */
function winding(segs, x, y) {
  let w = 0;
  for (let i = 0; i < segs.length; i += 4) {
    const y0 = segs[i + 1];
    const y1 = segs[i + 3];
    if (y0 <= y !== y1 <= y) {
      const xc = segs[i] + ((y - y0) * (segs[i + 2] - segs[i])) / (y1 - y0);
      if (xc > x) w += y1 > y0 ? 1 : -1;
    }
  }
  return w;
}

/** The pieces on the outside of the filled shape. Variable-font instances (Cinzel) keep overlapping contours; an
 * edge inside another contour is a seam, and measuring to it would draw a faint line through the letter. */
function boundaryOf(segs) {
  const out = [];
  const E = 0.04;
  for (let i = 0; i < segs.length; i += 4) {
    const [x0, y0, x1, y1] = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3]];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const a = winding(segs, mx + nx * E, my + ny * E) !== 0;
    const b = winding(segs, mx - nx * E, my - ny * E) !== 0;
    if (a !== b) out.push(x0, y0, x1, y1);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// One glyph

/**
 * @returns {{ id: number, bitmap?: Uint8Array, width: number, height: number, left: number, top: number, advance: number }}
 */
function drawGlyph(id, glyph, scale, baseline) {
  const advance = Math.max(0, Math.round((glyph.advanceWidth ?? 0) * scale));
  const segs = piecesOf(glyph, scale);
  const empty = { id, width: 0, height: 0, left: 0, top: -baseline, advance };
  if (!segs.length) return empty;

  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    xmin = Math.min(xmin, segs[i]);
    xmax = Math.max(xmax, segs[i]);
    ymin = Math.min(ymin, segs[i + 1]);
    ymax = Math.max(ymax, segs[i + 1]);
  }
  const L = Math.floor(xmin);
  const B = Math.floor(ymin);
  const width = Math.max(1, Math.ceil(xmax) - L);
  const height = Math.max(1, Math.ceil(ymax) - B);
  // Into the bitmap's frame: the box's lower left corner at (BORDER, BORDER). Whole pixels, so nothing moves.
  const dx = BORDER - L;
  const dy = BORDER - B;
  for (let i = 0; i < segs.length; i += 2) {
    segs[i] += dx;
    segs[i + 1] += dy;
  }
  const edge = boundaryOf(segs);
  if (!edge.length) return empty;

  const W = width + 2 * BORDER;
  const H = height + 2 * BORDER;
  const bitmap = new Uint8Array(W * H);
  const n = edge.length / 4;
  const box = new Float64Array(n * 4);
  for (let k = 0; k < n; k++) {
    const i = k * 4;
    box[i] = Math.min(edge[i], edge[i + 2]);
    box[i + 1] = Math.min(edge[i + 1], edge[i + 3]);
    box[i + 2] = Math.max(edge[i], edge[i + 2]);
    box[i + 3] = Math.max(edge[i + 1], edge[i + 3]);
  }
  const far = ((255 / 256 - CUTOFF) * RADIUS + 0.01) ** 2; // past this the value is 0 anyway
  const crossings = [];

  for (let row = 0; row < H; row++) {
    const y = row + 0.5;
    // Inside or out, for the whole row at once: where the outline crosses it, with its direction.
    crossings.length = 0;
    for (let i = 0; i < segs.length; i += 4) {
      const y0 = segs[i + 1];
      const y1 = segs[i + 3];
      if (y0 <= y !== y1 <= y) {
        crossings.push({ x: segs[i] + ((y - y0) * (segs[i + 2] - segs[i])) / (y1 - y0), d: y1 > y0 ? 1 : -1 });
      }
    }
    crossings.sort((a, b) => a.x - b.x);
    let total = 0;
    for (const c of crossings) total += c.d;
    let k = 0;
    let left = 0;
    const out = (H - 1 - row) * W; // bitmaps run top to bottom

    for (let col = 0; col < W; col++) {
      const x = col + 0.5;
      while (k < crossings.length && crossings[k].x <= x) left += crossings[k++].d;
      const inside = total - left !== 0;

      let best = far;
      for (let s = 0; s < n; s++) {
        const b = s * 4;
        const ex = x < box[b] ? box[b] - x : x > box[b + 2] ? x - box[b + 2] : 0;
        const ey = y < box[b + 1] ? box[b + 1] - y : y > box[b + 3] ? y - box[b + 3] : 0;
        if (ex * ex + ey * ey >= best) continue;
        const x0 = edge[b];
        const y0 = edge[b + 1];
        const vx = edge[b + 2] - x0;
        const vy = edge[b + 3] - y0;
        let t = ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x0 + t * vx - x;
        const qy = y0 + t * vy - y;
        const d2 = qx * qx + qy * qy;
        if (d2 < best) best = d2;
      }
      const dist = Math.sqrt(best);
      const v = ((inside ? -dist : dist) / RADIUS + CUTOFF) * 256;
      bitmap[out + col] = 255 - Math.min(255, Math.max(0, Math.round(v)));
    }
  }
  return { id, bitmap, width, height, left: L, top: B + height - baseline, advance };
}

// ---------------------------------------------------------------------------------------------------------------
// glyphs.proto, written by hand: glyphs { repeated fontstack stacks = 1 }, fontstack { name = 1, range = 2,
// repeated glyph glyphs = 3 }, glyph { id = 1, bitmap = 2, width = 3, height = 4, left = 5 (sint32), top = 6
// (sint32), advance = 7 }.

function varint(n, out) {
  if (n < 0 || !Number.isInteger(n)) throw new Error(`varint out of range: ${n}`);
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const key = (no, wire, out) => varint((no << 3) | wire, out);

function field(fieldNo, bytes, out) {
  key(fieldNo, 2, out);
  varint(bytes.length, out);
  for (const b of bytes) out.push(b);
}

function encodeGlyph(g) {
  const out = [];
  key(1, 0, out);
  varint(g.id, out);
  if (g.bitmap) field(2, g.bitmap, out);
  key(3, 0, out);
  varint(g.width, out);
  key(4, 0, out);
  varint(g.height, out);
  key(5, 0, out);
  varint(zigzag(g.left), out);
  key(6, 0, out);
  varint(zigzag(g.top), out);
  key(7, 0, out);
  varint(g.advance, out);
  return out;
}

export function encodeRange(name, range, glyphs) {
  const stack = [];
  field(1, Buffer.from(name, 'utf8'), stack);
  field(2, Buffer.from(range, 'utf8'), stack);
  for (const g of glyphs) field(3, encodeGlyph(g), stack);
  const out = [];
  field(1, stack, out);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------------------------------------------

const isControl = (cp) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0);

async function main() {
  const started = Date.now();
  const dir = fontsDir();

  // Every font is found, downloaded, checked and read before anything is written, and the files are written to a
  // folder beside the committed one that replaces it only at the end: a run that fails (offline, a bad download,
  // a missing @fontsource file) leaves apps/web/public/map-glyphs as it was.
  const fills = new Map();
  for (const stack of STACKS) if (!fills.has(stack.fill)) fills.set(stack.fill, load(await fillFont(dir, stack.fill)));
  const fonts = STACKS.map((stack) => ({ stack, own: stack.files.map(load), fill: fills.get(stack.fill) }));
  const ofl = readFileSync(path.join(FONTSOURCE, 'cinzel/LICENSE'), 'utf8');

  // Outside public/, so a run killed halfway never ships in a build (same drive, so the rename is a move).
  const tmp = path.join(ROOT, 'apps/web/.map-glyphs.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    writeAll(tmp, fonts, ofl);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  rmSync(OUT, { recursive: true, force: true });
  renameSync(tmp, OUT);
  console.log(`in ${((Date.now() - started) / 1000).toFixed(1)} s → ${path.relative(ROOT, OUT)}`);
}

function writeAll(out, fonts, ofl) {
  const notices = new Map(); // copyright line → which stacks use it
  let total = 0;
  let files = 0;

  for (const { stack, own, fill } of fonts) {
    const cap = capHeight(own[0]);
    const baseline = Math.round(SHAPING_OFFSET + NOTO_SANS_CAP_MIDDLE + (cap * SIZE) / 2);
    const faces = [
      ...own.map((font) => ({ font, scale: SIZE / font.unitsPerEm })),
      // The fill is drawn at the LORE font's cap height.
      { font: fill, scale: (SIZE / fill.unitsPerEm) * (cap / capHeight(fill)), fill: true },
    ];
    for (const { font } of faces) {
      const line = copyrightOf(font);
      if (!notices.has(line)) notices.set(line, new Set());
      notices.get(line).add(stack.name);
    }

    const counts = { own: 0, fill: 0 };
    mkdirSync(path.join(out, stack.name), { recursive: true });
    for (const start of RANGES) {
      const end = start + 255;
      const glyphs = [];
      for (let cp = start; cp <= end; cp++) {
        if (isControl(cp)) continue;
        const face = faces.find(({ font }) => font.tables.cmap.glyphIndexMap[cp] > 0);
        if (!face) continue;
        const glyph = face.font.glyphs.get(face.font.tables.cmap.glyphIndexMap[cp]);
        glyphs.push(drawGlyph(cp, glyph, face.scale, baseline));
        counts[face.fill ? 'fill' : 'own']++;
      }
      const file = path.join(out, stack.name, `${start}-${end}.pbf`);
      const bytes = encodeRange(stack.name, `${start}-${end}`, glyphs);
      writeFileSync(file, bytes);
      total += bytes.length;
      files++;
    }
    console.log(`${stack.name}: ${counts.own} glyphs from ${path.basename(stack.files[0]).replace(/-latin.*/, '')}, ${counts.fill} from ${stack.fill.replace('.ttf', '')}; baseline ${baseline} px`);
  }

  const licence = [
    'The Lore Map\'s glyph files (signed distance fields in MapLibre\'s glyphs.proto), drawn by',
    'tools/make-map-glyphs.mjs from these fonts, all under the SIL Open Font License 1.1:',
    '',
    ...[...notices].map(([line, stacks]) => `- ${line}\n  (in ${[...stacks].join(', ')})`),
    '',
    'LORE-Carved-* come from Cinzel, LORE-Book-* from IM Fell English; code points those lack are drawn from',
    'Noto Serif. The stacks carry LORE\'s names, not the fonts\' (IM Fell\'s licence reserves the name "IM FELL").',
    '',
    ofl.replace(/^[\s\S]*?(-{20,}\s*\nSIL OPEN FONT LICENSE)/, '$1'),
  ].join('\n');
  writeFileSync(path.join(out, 'OFL.txt'), licence.endsWith('\n') ? licence : `${licence}\n`);

  console.log(`${files} files, ${(total / 1024).toFixed(0)} KiB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
