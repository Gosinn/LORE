// Applies pending migrations and exits. The server also migrates on start, so this
// is only needed for deploy pipelines that migrate as a separate step.
import { loadConfig } from '../config.ts';
import { openDatabase } from './index.ts';

const config = loadConfig();
const database = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
await database.migrate();
await database.close();
console.log(`Migrations applied (${database.kind}).`);
