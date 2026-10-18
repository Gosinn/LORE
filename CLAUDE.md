# LORE: working rules

## NEVER write to C:
C: is nearly full (≈6 GB free). Installs, downloads, caches, temp files and builds go on **D:** only.
- Dot-source the environment first in every PowerShell command that runs node/npm/vite/vitest:
  `. "D:\LORE APP\tools\env.ps1"` (Git Bash: `source "/d/LORE APP/tools/env.sh"`). It redirects
  TEMP/TMP/APPDATA/LOCALAPPDATA to `D:\LORE-devenv` and keeps the npm cache on D:.
- Keep tool output small (large output is saved under %TEMP% on C:): log to `D:\LORE-devenv\*.log` and
  print summaries.
- Don't use Docker, winget or MSI installers locally (they write to C:).

## D: is exFAT
- No symlinks → no npm workspaces. One root `package.json`; shared code is imported as `#shared`
  (subpath import → `packages/shared/src/index.ts`).
- File times before 1980 are rejected; `apps/api/src/db/index.ts` handles this for PGlite.

## Editing files
- Use the Edit/Write tools. Never patch files with Windows PowerShell `Get-Content -Raw` +
  `WriteAllText`: PowerShell 5.1 reads UTF-8 as Windows-1252 and double-encodes every emoji and curly
  quote. If you must script an edit, use `Get-Content -Raw -Encoding UTF8`.

## Commands
- Tests: `npm test` (Vitest, in-memory PGlite, files run serially with `--liftoff-only --no-turbofan`
  because the machine is short on RAM). If memory is very tight, run files one by one:
  `npx vitest run --config apps/api/vitest.config.ts <auth|privacy|lifecycle|account>`.
- Android: `node tools/android.mjs dev` (Wi-Fi test app) or `release --api https://…` (signed APK +
  AAB into `dist-android/`). Toolchain in `D:\toolchains` (JDK 21, Android SDK 36, Gradle home); the
  env scripts set JAVA_HOME/ANDROID_HOME/ANDROID_USER_HOME/GRADLE_USER_HOME. Gradle is capped at 1 GB.
  `cmd.exe` here won't run programs from the current folder without `.\`.
- `sdkmanager.bat` mangles package names with `;` on the command line; use `--package_file`.
- Deploy: `deploy/oracle/README.md`. SSH key `D:\LORE-devenv\ssh\lore_oracle` (outside the repo);
  release signing key `D:\LORE-devenv\keystore` (outside the repo; must be backed up).
- Typecheck: `npm run typecheck`. Build: `npm run build`. Dev: `npm run dev` (or the `lore-api` /
  `lore-web` entries in `.claude/launch.json`). Demo data: `npm run seed` while the API runs.
- Schema change: edit `apps/api/src/db/schema.ts`, then `npm run db:generate`. Never hand-edit
  generated migrations that have shipped.

## Code conventions
- Node runs the API's `.ts` files directly: erasable syntax only (no enums, namespaces or parameter
  properties) and relative imports end in `.ts`.
- Every route: `requireUser(req)`, `parse(SharedSchema, req.body)`, then load the target through a
  `loadVisible*` helper from `lib/access.ts` (404 when hidden), then check the role.
- Visibility rules live only in `lib/access.ts`; list queries go through `lib/queries.ts`.
- API response shapes live in `packages/shared/src/types.ts`; enums and UI labels in `vocabulary.ts`.
- Product rules: no infinite lists, no engagement notifications, private by default (docs/MASTER_BRIEF.md
  part XXXV).

## Docs to keep current
README, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/ROADMAP.md, docs/DEVELOPMENT_LOG.md. Mark
anything not verified as such.

## Owner's instructions
- Web first, then a real (native) app as soon as possible; it must be deployable.
- Own API + Postgres (no Supabase).
- Connecting other apps to LORE goes through the owner's **Cardboard** app
  (https://github.com/Gosinn/Cardboard). It's still in development: do the Cardboard part **last**.
