import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';
import { ownerStartupNote } from './lib/access.ts';
import { DatabaseStorage, LocalDiskStorage } from './lib/storage.ts';
import { openDataWorld } from './lib/world.ts';

const config = loadConfig();
if (config.env === 'production' && !config.databaseUrl) {
  console.warn('DATABASE_URL is not set: using the embedded PGlite database. Use Postgres in production.');
}
if (config.env === 'production' && config.loracle.mode === 'fake') {
  console.warn('LORACLE_MIND=fake is set: the Loracle answers with canned dev quests. Unset it on a live server.');
}

const database = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
await database.migrate();

const storage =
  config.mediaStorage === 'database' ? new DatabaseStorage(database.db) : new LocalDiskStorage(config.mediaDir);
const world = openDataWorld(database.db);
// The Loracle's mind is made inside buildApp (with the app's logger): Claude when a key is set, the
// deterministic dev fake when LORACLE_MIND=fake, none while asleep (casting answers 503 `asleep`).
const app = await buildApp({ db: database.db, config, storage, world, dbKind: database.kind });
// Roads a previous process left in progress were interrupted: retry them once, else let them fade.
// Wishes waiting for the new moon wake here too when the month allows.
await app.wishJobs.sweep({ boot: true });
// Who moderates and edits LORE's words (ADMIN_USERNAMES, or the default owner with its cut-off).
const owner = await ownerStartupNote(database.db, config);
app.log[owner.level](owner.message);

const shutdown = async () => {
  // Closing the app stops the Loracle's jobs first; their rows stay for the next boot's sweep.
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
app.log.info(`LORE API ready on http://${config.host}:${config.port} (${database.kind}; the Loracle is ${config.loracle.mode})`);
