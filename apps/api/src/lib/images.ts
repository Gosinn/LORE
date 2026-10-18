// Identifies an uploaded image from its bytes (never from the client's claimed type)
// and reads its pixel size from the header, for layout placeholders.

export interface ImageInfo {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  ext: string;
  width: number | null;
  height: number | null;
}

export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length < 16) return null;

  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { mimeType: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
    return { mimeType: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    let width: number | null = null;
    let height: number | null = null;
    if (chunk === 'VP8X' && buf.length >= 30) {
      width = 1 + buf.readUIntLE(24, 3);
      height = 1 + buf.readUIntLE(27, 3);
    } else if (chunk === 'VP8 ' && buf.length >= 30) {
      width = buf.readUInt16LE(26) & 0x3fff;
      height = buf.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >> 14) & 0x3fff);
    }
    return { mimeType: 'image/webp', ext: 'webp', width, height };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg', ...jpegSize(buf) };
  }

  return null;
}

function jpegSize(buf: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    // Start-of-frame markers carry the dimensions (C4, C8 and CC are not frames).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { width: null, height: null };
}
