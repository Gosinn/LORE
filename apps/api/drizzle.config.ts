import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` (run from the repo root) diffs src/db/schema.ts against the
// existing migrations and writes a new SQL migration into apps/api/drizzle.
// Migrations are applied automatically when the server starts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/drizzle',
});
