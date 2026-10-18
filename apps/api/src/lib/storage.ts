import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { mediaBlobs } from '../db/schema.ts';

/**
 * Where uploaded files live. The `media` table only stores the key. Local disk is
 * used in development and on servers with a disk; the database driver serves hosts
 * whose filesystem is wiped on restart (Render's free tier). An S3-compatible
 * driver slots in here for larger deployments.
 */
export interface MediaStorage {
  put(key: string, data: Readable): Promise<number>;
  get(key: string): Readable;
  delete(key: string): Promise<void>;
}

export class LocalDiskStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Readable): Promise<number> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await pipeline(data, createWriteStream(file, { flags: 'wx' }));
    } catch (err) {
      await rm(file, { force: true });
      throw err;
    }
    return (await stat(file)).size;
  }

  get(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

/** Stores file contents in Postgres (`media_blobs`). Uploads are capped at 15 MB. */
export class DatabaseStorage implements MediaStorage {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async put(key: string, data: Readable): Promise<number> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) chunks.push(Buffer.from(chunk as Uint8Array));
    const bytes = Buffer.concat(chunks);
    await this.db.insert(mediaBlobs).values({ key, data: bytes });
    return bytes.length;
  }

  get(key: string): Readable {
    const db = this.db;
    return Readable.from(
      (async function* () {
        const [row] = await db.select({ data: mediaBlobs.data }).from(mediaBlobs).where(eq(mediaBlobs.key, key)).limit(1);
        if (!row) throw new Error('Missing media blob');
        yield Buffer.from(row.data);
      })(),
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(mediaBlobs).where(eq(mediaBlobs.key, key));
  }
}
