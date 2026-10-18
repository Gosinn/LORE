# LORE

*Life Of Regular Epics.*

**No scrolling. Only rolling.** A social app for planning real-world experiences with your people and
keeping the story of what happened: calendars, crews, an Idea Vault, events, and a shared Lorebook where
everyone adds their side of the story.

- Product spec: [docs/MASTER_BRIEF.md](docs/MASTER_BRIEF.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why it's built that way, and open questions: [docs/DECISIONS.md](docs/DECISIONS.md)
- What's done and what's next: [docs/ROADMAP.md](docs/ROADMAP.md)
- History: [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md)

## Run it locally

Requires Node 22.18+ (Node 24 LTS recommended). Nothing else: development uses an embedded Postgres
(PGlite) stored in `.data/`.

On this machine, first point temp folders and caches at D: (see `CLAUDE.md`):

```powershell
. "D:\LORE APP\tools\env.ps1"
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 4000; Vite proxies `/api` to it.

To fill it with demo data (a crew, plans, ideas and a few chapters), keep `npm run dev` running and, in
a second terminal:

```bash
npm run seed
```

The demo accounts and their password are listed at the top of `apps/api/src/seed.ts` (local
development only).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + web dev server |
| `npm test` | API tests: auth, privacy rules, full Phase 1 lifecycle (in-memory Postgres) |
| `npm run typecheck` | strict TypeScript check of shared, API and web |
| `npm run build` | production build of the web app into `apps/web/dist` |
| `npm start` | production server: API + built web app on one port |
| `npm run db:generate` | new SQL migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | apply migrations (the server also does this on start) |
| `npm run seed` | demo data through the running API |
| `node tools/make-icons.mjs` | regenerate the app icons |

## Deploy

One container runs the API and serves the web app; it needs PostgreSQL.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose up -d
```

Put HTTPS in front of it (Caddy, Traefik or the host's load balancer) and set `TRUST_PROXY=true`.
Session cookies are `Secure` in production, so plain http only works with `COOKIE_SECURE=false` for local
trials. Uploaded photos live in the `/data` volume; use S3-compatible storage once you run more than one
instance (see roadmap).

The Docker image hasn't been built on the development machine yet (Docker would write to the full C:
drive). The production server mode it runs (`npm start`) has been tested.

## Project rules

- No feeds, no streaks, no engagement bait (brief part XXXV). Every list is finite.
- Privacy is enforced in the API (`apps/api/src/lib/access.ts`), never only in the UI.
- Every request body is validated with the shared Zod schemas in `packages/shared`.
- Don't claim a feature works unless it was built and tested; record what wasn't verified.
