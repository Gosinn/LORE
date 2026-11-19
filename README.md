# LORE

*Life Of Regular Epics.*

**No scrolling. Only rolling.** A social app for planning real-world experiences with your people and
keeping the story of what happened: calendars, crews, an Idea Vault, events, and a shared Lorebook where
everyone adds their side of the story.

**The Loracle** is a stone circle in your pocket. *These stones see what you do not.* Tell them what you
wish for ("I wish to become the Lethwei champion of the world") and they draw you a quest: a calling, a
road of waypoints that open one at a time, whom to find, what to carry, and one deed for this week. Each
waypoint can become a plan, an idea in your vault or a reminder, and, once done, a chapter of your lore.
The stone's mind is Claude (Anthropic); wishes are private to the one who cast them.

Every screen wears **one base, the Loracle's own**: carved stone buttons with ember letters, a copper Create,
wells to type into, dark slabs for cards, Cinzel and IM Fell English, so stepping into the Loracle never jumps.
Behind it is **your world**, picked in Profile: a black star sky (the default), a night map, midnight vellum, a
scroll, a treasure map, a mountain range or the northern lights, or the green hills under an engraved sun; one
tap and it stays. Or switch on Auto: a dark world by night and a light one by day, following your phone or the
real sun where you stand. The stone wall itself belongs to the
Loracle alone, and the older looks (the Treasure Map too) are retired, not deleted. On Home,
the door to the Loracle carries one small sign a day: something worth doing near where you stand, if you told
the stones where that is (a new account is asked right after sign-up; location is recommended, never required).

**The Lore Map** (Lorebook → Map) shows your chapters, plans, ideas and Loracle waypoints where they happened or
will happen, in LORE's own night and day look over free OpenStreetMap tiles (OpenFreeMap). Modes: Mine, Crew,
Memories, Adventures. Give a chapter, plan or idea a place from its form and choose how exactly others see it:
**Exact**, **About here** (a circle about 8 km across, rounded on the server) or **Only me**; "Show my places on
maps" hides all of yours from everyone else at once. The map never asks where your phone is. *Not yet looked at
in a browser or on a phone.*

- Product spec: [docs/MASTER_BRIEF.md](docs/MASTER_BRIEF.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why it's built that way, and open questions: [docs/DECISIONS.md](docs/DECISIONS.md)
- What's done and what's next: [docs/ROADMAP.md](docs/ROADMAP.md)
- History: [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md)

## Change LORE's words yourself (owner)

Every word on LORE's screens can be changed from inside the app and published live, no code and no deploy
(D33). Only the owner can (the account `gosinn`, or whoever `ADMIN_USERNAMES` names).

1. **Profile → Help → Edit text.** A quill appears at the bottom right of every screen.
2. **Tap the quill.** Every word you can change gets a dashed outline, and taps stop doing what they normally
   do (links, buttons and tabs wait).
3. **Tap any words**, type the new ones, then **Keep**. Only your screen changes, live as you type. Keep
   `{placeholders}` such as `{displayName}`: they are filled in for each person. Page text may use `<em>`,
   `<strong>` and a line break; buttons, labels and messages stay plain words.
4. A bar shows **N changes not live yet**. Tap **Publish**, look over before → after, then **Publish**.
   Everyone sees the new words on their next tap, or when they bring the app back to the front (web, Android
   and iPhone). Terms, Privacy and the Loracle's consent words ask for a tick ("I've checked these are still
   true") first.
5. Tap the quill again (or **Done**) to use LORE normally. Unpublished changes stay on your device only.

**Texts** (in the editing bar) lists your unpublished and published changes, each text's earlier versions,
orphans (edits whose words changed in the code), the last 20 publishes with **Undo**, **Find** (every text,
including error messages and confirm dialogs that are hard to reach), what is on this screen, and **Copy for
Claude** (your published edits as a note a code session can write into the source). If anything goes wrong,
`COPY_OVERRIDES=off` on the server shows the code's own words everywhere until you remove it.

Not editable on purpose: crisis lines and emergency numbers, the Loracle's prompts to Claude, what Lorers and
the Loracle write, the LORE logotype, the app's name and store texts, and the editor's own words. **Not yet
checked in a browser or on a phone**; the server side is tested and was tried by hand with a local server.

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

### The Loracle's mind

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | The key for Claude (Anthropic API). Server only; never commit it. Without it the stone **sleeps**: the page says so, casting is off, everything else in LORE works. `/api/health` reports `loracle: "awake"`, `"asleep"` or `"fake"`. |
| `LORACLE_MONTHLY_USD` | The owner's monthly spend ceiling across everyone, in US$ (default `150`). Past it, new wishes are written down and read at the new moon; at 1.1× it nothing is weighed until the new moon. Set a Console spend limit a little above that as the real backstop. |
| `LORACLE_MIND=fake` | **Development only.** A deterministic fake mind: no network, no cost, real-looking signs over ~8 s and a canned quest. The `lore-api` entry in `.claude/launch.json` sets it. Never set it on a live server. |

Every call uses Claude Opus 5.5 (`claude-opus-5-5`); a quest is estimated at about US$0.90–2.40
(unverified until the live eval has run). What is sent to Anthropic, and why, is in
[docs/DECISIONS.md](docs/DECISIONS.md) (D31). The live eval, `node tools/loracle-eval.mjs --yes`, spends
real money and is run by the owner, not by CI (`--fake` is a free dry run).

**Not yet verified:** no real Claude call has been made from this repo; real quests, their cost and the
prompts are unproven until the owner sets a key and runs the eval.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + web dev server |
| `npm test` | API tests: auth, privacy rules, full Phase 1 lifecycle, the Loracle with stub minds, live text (in-memory Postgres, no network); then `npm run test:copy` |
| `npm run test:copy` | live text on the web side: the build transform, coverage of every screen's words, the runtime, sync and Copy for Claude |
| `npm run copy:check` | before changing words in the code: lists the owner's live edits the change would orphan (reads the live server's `GET /api/copy`) |
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
  (new Capacitor plugins, Android settings). Profile shows the running version and build. The location
  permission for "Where do you stand?" and the dark splash and ember notification colour (D34) are native
  parts: they arrive only with a new APK (until then the page falls back to typing a town, and the splash
  stays parchment).

## iPhone app

`apps/ios` is the same app for iPhone. `node tools/ios.mjs prepare --api https://…` builds the web app
into it (works on Windows); the build itself runs on a Mac in GitHub's cloud
(`.github/workflows/ios.yml`) and goes to TestFlight and the App Store. It needs an Apple Developer
account first: see [deploy/ios/README.md](deploy/ios/README.md). Until then, iPhones can use the web app
from the home screen (Safari → Share → Add to Home Screen).

## Deploy

**Live:** https://lore-g8co.onrender.com, deployed automatically from `main` on GitHub.

**Free, no card (current):** Render + Neon, see [deploy/render/README.md](deploy/render/README.md). The
only required setting is `DATABASE_URL`; add `ANTHROPIC_API_KEY` (secret) to wake the Loracle.

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
