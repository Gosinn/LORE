# LORE — Development log

## 2026-10-18 — Phase 1 foundation

**Built**

- Spec saved as `docs/MASTER_BRIEF.md`; owner decisions recorded (web first then native, own API +
  Postgres, Cardboard integration last).
- Single-package TypeScript repo: `packages/shared` (vocabulary, Zod inputs, DTO types), `apps/api`
  (Fastify + Drizzle), `apps/web` (React PWA).
- Database schema (18 tables) and the initial migration.
- API: auth, profiles, friends and blocks, crews, events (invites, RSVP, organizers, packing list,
  statuses), personal calendar, Idea Vault (interest, conversion), Lorebook (chapters from events or
  scratch, people, contributions, covers), media upload/serving, discussion threads, notifications, Home.
- Web: welcome/sign-in, Home, Calendar (month/agenda, LORE + personal layers), Create, event form/page,
  Idea Vault/form/page, Lorebook timeline, chapter form/page with composer, crew form/page, profile,
  other people's profiles, friends, notifications. Light and dark themes, PWA manifest and service worker,
  generated app icons, lazy-loaded routes.
- Demo seed (`npm run seed`) that drives the real API.
- Dockerfile + docker-compose for deployment.

**Verified**

- `npm test`: 32 tests (auth 8, privacy 14, lifecycle 10) pass on in-memory PGlite, three runs in a row.
- Lifecycle and privacy suites (24 tests) also pass through the production `pg` driver against a
  Postgres wire-protocol server.
- `npm run typecheck`: clean (strict TS 7).
- Production build; single-server mode serves the app, deep links, service worker, manifest and API, and
  sets `HttpOnly; Secure; SameSite=Lax` cookies.
- In the browser (phone and desktop sizes, both themes): sign-in, Home, Lorebook, chapter page,
  event page, adding a packing-list item, posting to a discussion, creating an event, calendar.

**Not verified**

- The Docker image wasn't built here (Docker's data lives on the full C: drive).
- Photo upload through the browser's file picker (the API path is tested).
- Real Postgres server (only the wire-protocol stand-in).

**Problems hit, and fixes**

- *npm workspaces fail* (`EISDIR` on symlink): D: is exFAT, which has no symlinks → single package +
  `#shared` subpath import.
- *PGlite fails to persist on D:* (`ErrnoError 28`): exFAT rejects file times before 1980 and PGlite
  writes 1970 → retry `utimes` with 1980-01-02 (`db/index.ts`).
- *Test workers crash* (`0xC0000409`, then "Zone allocation failed"): V8 runs out of memory optimising
  PGlite's WebAssembly; only ~2.5 GB RAM free and the page file can't grow on a full C: → tests run with
  `--liftoff-only --no-turbofan`, one file at a time.
- *Garbled emoji and quotes*: files had been patched with Windows PowerShell's `Get-Content -Raw`,
  which reads UTF-8 as Windows-1252 → reversed the double encoding in the 7 affected files, regenerated
  the migration (the crew emoji default was affected). Rule added to `CLAUDE.md`.
- `useEffect(() => window.scrollTo(…))` returned a value that React treated as a cleanup in the preview
  browser → block body.
