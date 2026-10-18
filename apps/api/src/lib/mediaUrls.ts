import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Photos are private, but an <img> tag can't send a bearer token (native apps) and
// shouldn't depend on cookies. So every media URL the API hands out is signed: it
// carries an expiry and an HMAC, and the file route accepts a valid signature in
// place of a session. Links are only handed to people allowed to see the photo.
//
// Trade-off (as with S3 presigned links): a link someone forwards keeps working
// until it expires. Expiry is rounded to the hour and lands 1–2 hours out, so the
// window is short while a photo's URL still stays stable long enough to be cached.

let secret: Buffer = randomBytes(32);

/** Set from MEDIA_URL_SECRET so links survive restarts (random per process otherwise). */
export function setMediaUrlSecret(value: string | undefined) {
  if (value) secret = Buffer.from(value, 'utf8');
}

const HOUR = 60 * 60;

function expiry(now = Date.now()): number {
  return (Math.floor(now / 1000 / HOUR) + 2) * HOUR;
}

function sign(id: string, exp: number): string {
  return createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
}

export function signedMediaPath(id: string): string {
  const exp = expiry();
  return `/api/media/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyMediaSignature(id: string, exp: unknown, sig: unknown): boolean {
  if (typeof exp !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(id, Number(exp)));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
