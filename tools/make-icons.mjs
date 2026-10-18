// Draws the LORE emblem (a compass needle on ember) into the PNG icons the PWA and
// native shells need. Pure Node, no image libraries: `node tools/make-icons.mjs`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const EMBER = [212, 70, 29];
const PAPER = [255, 248, 240];
const INK = [42, 22, 12];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
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
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

/**
 * @param size   output pixels
 * @param radius corner radius as a fraction of size (0 = full bleed)
 * @param scale  emblem size as a fraction of the default (maskable icons shrink it)
 */
function draw(size, { radius = 0.22, scale = 1 } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size; // 0..1
          const v = (y + (sy + 0.5) / SS) / size;
          // Rounded-square background.
          const rr = radius;
          const qx = Math.max(Math.abs(u - 0.5) - (0.5 - rr), 0);
          const qy = Math.max(Math.abs(v - 0.5) - (0.5 - rr), 0);
          if (rr > 0 && Math.hypot(qx, qy) > rr) continue;
          let col = EMBER;
          const du = (u - 0.5) / scale;
          const dv = (v - 0.5) / scale;
          const dist = Math.hypot(du, dv);
          // Faint ring.
          if (Math.abs(dist - 0.3) < 0.018) col = mix(EMBER, PAPER, 0.45);
          // Needle: paper pointing north, ink pointing south.
          const top = [0, -0.37], right = [0.105, 0], bottom = [0, 0.37], left = [-0.105, 0];
          if (inTriangle(du, dv, top, right, left)) col = PAPER;
          else if (inTriangle(du, dv, bottom, right, left)) col = INK;
          if (dist < 0.032) col = EMBER;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cover = a / n / 255;
      out[i] = cover ? Math.round(r / (a / 255)) : 0;
      out[i + 1] = cover ? Math.round(g / (a / 255)) : 0;
      out[i + 2] = cover ? Math.round(b / (a / 255)) : 0;
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));

const dir = new URL('../apps/web/public/', import.meta.url);
const write = (name, size, opts) => {
  writeFileSync(new URL(name, dir), png(size, draw(size, opts)));
  console.log(`wrote ${name}`);
};
write('icon-192.png', 192);
write('icon-512.png', 512);
write('icon-maskable-512.png', 512, { radius: 0, scale: 0.78 });
write('apple-touch-icon.png', 180, { radius: 0 });
