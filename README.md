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
| `node tools/make-icons.mjs` | regenerate the web and Android icons |
| `node tools/android.mjs dev` | Android test app that loads this computer's dev server over Wi-Fi |
| `node tools/android.mjs release --api https://…` | signed Android app (APK + AAB) for a live server |

## Android app

The Android app (`apps/android`, Capacitor) is the same web app bundled inside a native shell.

- **Try it before the server is live:** `node tools/android.mjs dev`, then `npm run dev -- --lan`, and
  install `dist-android/LORE-dev.apk` on a phone on the same Wi-Fi (allow "install unknown apps"; allow
  Node.js through the Windows firewall on private networks when asked).
- **The real app:** `node tools/android.mjs release --api https://lore-g8co.onrender.com` produces a
  signed `LORE-<version>.apk` (to share directly) and `.aab` (for Google Play). The signing key is
  created outside the repo; back it up, since APK updates must be signed with the same key.
- **Live updates:** installed apps pick up every web change deployed to the server by themselves (they
  check on launch and switch at the next background). A new APK is only needed when native parts change
  (new Capacitor plugins, Android settings). Profile shows the running version and build.

## Deploy

**Live:** https://lore-g8co.onrender.com, deployed automatically from `main` on GitHub.

**Free, no card (current):** Render + Neon, see [deploy/render/README.md](deploy/render/README.md). The
only setting is `DATABASE_URL`.

**Free, on Oracle Cloud (more room, needs a card check):** follow
[deploy/oracle/README.md](deploy/oracle/README.md). One small server runs HTTPS (Caddy), LORE, Postgres
and nightly backups; deploying is `git push oracle main`.

**Anywhere else with Docker:** the root `docker-compose.yml` runs LORE + Postgres.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose up -d
```

Put HTTPS in front of it and set `TRUST_PROXY=true`. Session cookies are `Secure` in production, so
plain http only works with `COOKIE_SECURE=false` for local trials. Set `MEDIA_URL_SECRET` so photo links
survive restarts.

Not yet verified: the Docker image hasn't been built on the development machine (Docker would write
to the full C: drive) and the Oracle kit hasn't run against a real server. The production server mode it
runs (`npm start`) has been tested.

## Project rules

- No feeds, no streaks, no engagement bait (brief part XXXV). Every list is finite.
- Privacy is enforced in the API (`apps/api/src/lib/access.ts`), never only in the UI.
- Every request body is validated with the shared Zod schemas in `packages/shared`.
- Don't claim a feature works unless it was built and tested; record what wasn't verified.
