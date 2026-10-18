import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where uploaded files live. The database only stores the key. Local disk is used
 * in development; an S3-compatible driver slots in here for production scale.
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
