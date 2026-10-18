import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt (memory-hard, built into Node; no native add-ons to compile on deploy).
// Stored as: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>, so the cost can be raised
// later and old hashes upgraded on the next successful sign-in.

const KEY_LENGTH = 32;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const optionsFor = (N: number, r: number, p: number): ScryptOptions => ({
  N,
  r,
  p,
  maxmem: 256 * N * r + 1024 * 1024,
});

export async function hashPassword(password: string, cost: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, optionsFor(cost, BLOCK_SIZE, PARALLELISM));
  return ['scrypt', cost, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), optionsFor(+n, +r, +p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string, cost: number): boolean {
  const [, n] = stored.split('$');
  return Number(n) !== cost;
}

let dummyHash: Promise<string> | null = null;
/**
 * Spend the same effort when the account doesn't exist, so response timing doesn't
 * reveal which usernames are registered.
 */
export async function burnPasswordCheck(password: string, cost: number): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password', cost);
  await verifyPassword(password, await dummyHash);
}
