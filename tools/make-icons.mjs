// Draws the LORE emblem (a compass needle on ember) into every icon the PWA and the
// Android app need. Pure Node, no image libraries: `node tools/make-icons.mjs`.
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const EMBER = [212, 70, 29];
const PAPER = [255, 248, 240];
const PARCHMENT = [244, 238, 227];
const INK = [42, 22, 12];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inTriangle = (px, py, [ax, ay], [bx, by], [cx, cy]) => {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));

/**
 * @param shape  'rounded' | 'square' | 'circle': the background's outline
 * @param bg     background colour, or null for transparent (adaptive icon foreground)
 * @param scale  emblem size relative to the full-bleed icon
 * @param badge  draw an ember disc behind the emblem (for light backgrounds)
 */
function draw(width, height, { shape = 'rounded', radius = 0.22, bg = EMBER, scale = 1, badge = false } = {}) {
  const out = Buffer.alloc(width * height * 4);
  const S = Math.min(width, height);
  const SS = 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const u = (px - width / 2) / S; // -0.5..0.5 on the short side
          const v = (py - height / 2) / S;
          // Background outline.
          if (shape === 'circle' && Math.hypot(u, v) > 0.5) continue;
          if (shape === 'rounded') {
            const qx = Math.max(Math.abs(u) - (0.5 - radius), 0);
            const qy = Math.max(Math.abs(v) - (0.5 - radius), 0);
            if (Math.hypot(qx, qy) > radius) continue;
          }
          let col = bg;
          const du = u / scale;
          const dv = v / scale;
          const dist = Math.hypot(du, dv);
          if (badge && dist < 0.46) col = EMBER;
          const base = badge || bg === EMBER ? EMBER : null;
          if (base && Math.abs(dist - 0.3) < 0.018) col = mix(EMBER, PAPER, 0.45);
          else if (!base && Math.abs(dist - 0.3) < 0.022) col = PAPER;
          const top = [0, -0.37], right = [0.105, 0], bottom = [0, 0.37], left = [-0.105, 0];
          if (inTriangle(du, dv, top, right, left)) col = PAPER;
          else if (inTriangle(du, dv, bottom, right, left)) col = INK;
          if (dist < 0.032) col = base ?? EMBER;
          if (!col) continue; // transparent pixel
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const i = (y * width + x) * 4;
      const n = SS * SS;
      if (a) {
        out[i] = Math.round((r * 255) / a);
        out[i + 1] = Math.round((g * 255) / a);
        out[i + 2] = Math.round((b * 255) / a);
      }
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

function write(url, width, height, opts) {
  writeFileSync(url, png(width, height, draw(width, height, opts)));
}

// --- Web (PWA) -----------------------------------------------------------------
const web = new URL('../apps/web/public/', import.meta.url);
write(new URL('icon-192.png', web), 192, 192);
write(new URL('icon-512.png', web), 512, 512);
write(new URL('icon-maskable-512.png', web), 512, 512, { shape: 'square', scale: 0.78 });
write(new URL('apple-touch-icon.png', web), 180, 180, { shape: 'square' });
console.log('wrote web icons');

// --- Android (only once the Capacitor project exists) ----------------------------
const res = new URL('../apps/android/app/src/main/res/', import.meta.url);
if (existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = new URL(`mipmap-${d}/`, res);
    write(new URL('ic_launcher.png', dir), 48 * k, 48 * k);
    write(new URL('ic_launcher_round.png', dir), 48 * k, 48 * k, { shape: 'circle', scale: 0.92 });
    // Adaptive icon: the launcher masks a 108dp canvas; keep the emblem in the safe zone.
    write(new URL('ic_launcher_foreground.png', dir), 108 * k, 108 * k, { shape: 'square', bg: null, scale: 0.78 });
  }
  const splash = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  const splashOpts = { shape: 'square', bg: PARCHMENT, badge: true, scale: 0.3 };
  for (const [d, [w, h]] of Object.entries(splash)) {
    write(new URL(`drawable-port-${d}/splash.png`, res), w, h, splashOpts);
    write(new URL(`drawable-land-${d}/splash.png`, res), h, w, splashOpts);
  }
  write(new URL('drawable/splash.png', res), 480, 320, splashOpts);
  writeFileSync(
    new URL('values/ic_launcher_background.xml', res),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#D4461D</color>\n</resources>\n',
  );
  console.log('wrote Android icons and splash screens');
}
