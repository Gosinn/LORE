# LORE — Development log

## 2026-10-23 — Crazy theme, notes and reminders (0.3.0)

- **Crazy theme** (owner's idea): random neon per container, re-rolled per visit or with the Roll button.
  Checked in the browser on Welcome, Home and Calendar.
- **Notes to self and reminders**: one quick box on Home and on the Notes page (one-tap times: in 1 hour,
  this evening, tomorrow 9:00, or pick), reminders on Home and in the Calendar, "Remind me" on events,
  export and account deletion included. 5 new API tests (55 total). Checked in the browser: added a
  reminder from Home, saw it on Home, Notes and set an event reminder.
- **Android 0.3.0**: local notifications for reminders (`@capacitor/local-notifications`), LORE status-bar
  icon, tap opens the reminder's event or Notes. Not yet observed on a phone.
- Local dev server needed a restart to pick up migration 0003 (it had restarted on the route change before
  the migration file existed).

## 2026-10-19 — Live, and self-updating

- **Live** at https://lore-g8co.onrender.com (Render free web service, Neon free Postgres). The owner's
  bank blocked Oracle's card check, so the no-card route was used. On Render, LORE configures itself
  (`RENDER=true`); only `DATABASE_URL` is set. `/api/health` now reports the database and photo
  storage in use; live it says `postgres` / `database`.
- Checked from outside (no accounts created on the live server): app, deep links, manifest, sign-in
  required, CORS for the app origin, cross-site writes blocked.
- **Android 0.1.0** built for the live server: signed (verified with `apksigner`), server address
  bundled. Sent to the owner.
- **Live updates (0.2.0):** Capacitor Updater, self-hosted (D23). Server-side flow verified against a
  local production server: update check → 595 KB zip → checksum matches → `unzip -t` clean → address
  written into `index.html` → "up to date" once current. 50 API tests.
- Not verified yet: an update actually landing on a phone.

## 2026-10-18 (later) — Going live and going native

**Owner decisions:** hosting on Oracle Cloud Always Free (free), Android first, deleted accounts keep
their shared contributions anonymised, code goes to a private GitHub repo.

**Built**

- Git repository (first commit: Phase 1 foundation).
- Account deletion (`DELETE /api/me`, password required) and data export (`GET /api/me/export`), with
  the hand-over rules in `apps/api/src/lib/accounts.ts`; migration `0001` makes authors nullable.
  Profile → "Your data" in the app; anonymised posts show "A former member".
- Native support in the API: CORS for app origins, signed short-lived photo links.
- Android: portable JDK 21 + Android SDK 36 in `D:\toolchains` (checksum-verified downloads; SDK
  license accepted with the owner's approval), Capacitor 8 project in `apps/android`, LORE launcher
  icons (legacy, round, adaptive) and splash screens, back button and status bar handling,
  `tools/android.mjs` for dev and signed release builds.
- Oracle deployment kit in `deploy/oracle` (Caddy + app + Postgres 18 + nightly backups, one-time
  `server-setup.sh`, push-to-deploy hook, step-by-step guide). Deploy SSH key generated in
  `D:\LORE-devenv\ssh` (outside the repo).

**Verified**

- 41 API tests pass (auth 8, privacy 14, lifecycle 10, account 9), run file by file.
- Migration 0001 applied to the existing development database; sessions survived.
- In the browser: sign-up, Profile → delete account → back to sign-in, account gone.
- `dist-android/LORE-dev.apk` builds; `aapt2` shows `com.gosinn.lore`, label LORE, target SDK 36.

**Not verified**

- The APK hasn't run on a phone or emulator yet (no emulator image; little free RAM).
- The Oracle kit hasn't run against a real server yet.
- "Download my data" in the Android WebView (blob downloads may need a native share sheet).

**Problems hit**

- The `D:\dev` JDK/Android folders seen at the start had disappeared → fresh portable toolchain.
- `sdkmanager.bat` splits `platforms;android-36` at the `;` → package list file.
- Memory: a 2.4 GB process not started by me left ~1.2 GB allocatable; a full test run crashed with
  "AlignedAlloc failed" → test files run one at a time; Gradle capped at 1 GB, no daemon.
- `cmd.exe` here doesn't search the current folder for programs → `.\gradlew.bat`.
- A second PowerShell edit re-garbled one test file's curly quotes → repaired; edits since use the
  Edit tool or explicit UTF-8.

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
