import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';
import { DatabaseStorage, LocalDiskStorage } from './lib/storage.ts';

const config = loadConfig();
if (config.env === 'production' && !config.databaseUrl) {
  console.warn('DATABASE_URL is not set: using the embedded PGlite database. Use Postgres in production.');
}

const database = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
await database.migrate();

const storage =
  config.mediaStorage === 'database' ? new DatabaseStorage(database.db) : new LocalDiskStorage(config.mediaDir);
const app = await buildApp({ db: database.db, config, storage });

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
app.log.info(`LORE API ready on http://${config.host}:${config.port} (${database.kind})`);
