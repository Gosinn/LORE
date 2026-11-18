# LORE — Development log

## 2026-11-18 (evening) — The Treasure Map, the daily sign and "Where do you stand?" (D32)

The owner asked to retire the older themes (not delete them), make the new look present everywhere, keep
stone for the Loracle only, and keep Home's little suggestion, near the Lorer if they allow it, with location
recommended when the account is set up. Built in two parallel passes, then joined and checked together.

**The look**

- **Retired, kept.** `lib/theme.ts` offers `THEMES = ['map']`; Paper, Campfire, Match device and Crazy sit in
  `RETIRED_THEMES` with their CSS untouched (app.css only gained "RETIRED" comments and one `:not()` so the
  dark block never meets the map). A stored retired choice loads as the map and is not overwritten
  (`applyTheme` no longer saves; `chooseTheme` does). `stopCrazy` now clears its paint. Profile → Appearance
  lists `THEMES`: one pressed "Treasure Map" chip and a line saying the older looks are rolled up in the archive.
- **`styles/map.css` (new, after app.css):** the tokens (AA contrast by the WCAG formula, not yet measured on
  screenshots) and the shared pieces: neatline vellum cards, vermilion-wax primary buttons, outlined danger,
  map-label chips with a tick when selected, stamped pills, index tabs, calendar-leaf date tiles, inked
  tick-boxes, dotted ledger rows and section trails, brass medallion avatars and crew emoji, a swallowtail
  pennant on CrewPage/CrewForm, dashed "uncharted" ideas, the Lorebook trail with an X at each year, mounted
  chapter photos (taped on desktop), margin-note quotes, paper-slip comments, a wax-seal sheet handle, Cinzel
  calendar with a hand-drawn today ring and diamond/round dots. The tab bar is a leather strap with brass
  stitching, a glowing X under the active tab and a brass compass for Create; the desktop rail is the map
  case's spine with a parchment bookmark for the current page. Cinzel and IM Fell English now load from
  `main.tsx`. map.css is 43.7 kB unminified (about 10 kB gzipped), over the spec's ~20 kB guideline, because the
  guard is written out on every selector.
- **Stone stays in the Loracle.** Every map rule carries the guard
  `:where(html[data-theme='map'] body:not(:has(.oracle-page)))`; the temple pins radius, shadows and avatar
  colours back. The three ways in (Home's door, the Create tile, the rail link) cross-fade with a view
  transition (off for reduced motion). The browser's theme-color is paper on map screens and stone in the
  temple. The Create menu's Loracle tile is a small dusk sky with the fire's glow. The Loracle's own files
  (`pages/Oracle.tsx`, `components/oracle.tsx`, `components/loracle.tsx`, the ORACLE section of app.css) are
  untouched, apart from one comment in that section naming which variables are shared and which are stone;
  `components/oracle.tsx` still imports Cinzel and IM Fell itself, a harmless duplicate of
  `main.tsx`'s imports (one copy in the build).
- **Native/PWA colours:** `index.html` (`data-theme="map"`, theme-color `#efe3c8`), the manifest, the splash
  (`#efe3c8`) and the reminder notification icon (`#A3301A`). The splash and icon colours only change in a newly
  built APK/AAB.
- **Home and Welcome:** Home's stone teaser is now the Loracle door, the torn edge of the map with dusk and the
  stones' silhouette (no rune band; its old CSS is kept); the page ends with a `CompassRose`
  (`components/compass.tsx`). Welcome has a faint compass rose behind it and a dotted trail ending in an X.
- **Left for the owner (DECISIONS Q9):** "Here be dragons" on Not Found, a "Lore maker" kicker on Profile,
  "Provisions" for the packing list.

**The daily sign on Home** (`GET /oracle/sign`, `OracleSign` in `types.ts`, `styles/sign.css`)

- No home yet: the door asks "Where do you stand?" and links to `/welcome/where`.
- Otherwise the first ask of the Lorer's day deals one mixed reading from the Futures engine around their home,
  kept as an `oracle_readings` row with `mode = 'sign'`. It never counts toward the three
  readings a day, never appears in `GET /oracle`, and reads back as `'mixed'`. It looks within
  `min(radius_km, 250)` km, never the Loracle's ANYWHERE reach. The door shows the first open future (or the
  one chosen today) with when and where ("Tomorrow · 22:30 · Old Light, 52 km"): "Choose it" makes a plan
  only the Lorer sees (`crewId: null`) and opens it; "Not this one" shows the next, until there is none.
- Saying where you stand again before answering deals it again (see the review fixes below for what counts);
  a failing weather or places service stores nothing and is asked again next time; two requests at once share
  one dealing. `POST /oracle/readings`
  now shares the gathering code (`draw()`) with the sign; its behaviour is unchanged.
- `PUT /oracle/settings` now clears `home_country` when the home moves (a moved home kept its old country).
- While the sign is being dealt, or when nothing is near, the door is the plain way into the circle.

**"Where do you stand?"** (`pages/WhereYouStand.tsx`, route `/welcome/where`)

- A new account goes here before Home (a `?next=` inside the app is kept). "Allow location (recommended)"
  rounds the point to two decimals (about a kilometre) on the device; or a town by name (`/oracle/geocode`);
  or Later. It saves the Loracle's home (`PUT /loracle/settings` with the time zone).
- The town at the point comes from the new `GET /oracle/reverse` (`world.reverse`: Nominatim reverse at town
  level, cached 30 days, the point rounded to two decimals on the server too). With no town named the home is
  "Near me".
- **Fix found while joining the two passes:** the Loracle looked up a country-less home by its *label*, so a
  "Near me" home could have been renamed to a far-away "Near me" and given the wrong country. `realmOf`
  (`routes/loracle.ts`) now asks for the town at the home's own point first, and accepts a match by name only
  within 100 km of it; otherwise it asks where the Lorer stands, as before.
- Native: `ACCESS_COARSE_LOCATION` (and optional `uses-feature`s) in the Android manifest,
  `NSLocationWhenInUseUsageDescription` in iOS `Info.plist`. Both need a new native build; a live update
  doesn't carry them. Until then "Allow location" is refused and the page falls back to the town search.

**Review fixes (same evening)**

- **Android 7 to 11 could never allow location.** Capacitor's WebView asks for coarse *and* fine and accepts
  coarse alone only on Android 12+; without fine declared, "Allow" ended as "denied". The manifest now
  declares `ACCESS_FINE_LOCATION` with `maxSdkVersion="30"` (Android 11 and older have no approximate
  choice); 12+ stays coarse-only, and the page still rounds to ~1 km. iOS gained
  `NSLocationDefaultAccuracyReduced` (the prompt defaults to Approximate). Not verified on a device.
- **The daily sign offered moments that had passed**, and "Choose it" made plans in the past. Only moments
  still ahead are shown now; choose refuses a passed one ("That moment has passed."); an unanswered sign whose
  moments have all passed is dealt again.
- **The sign was dealt again by unrelated writes** (consent, reach and context all
  bumped `updated_at`; the first home's `updated_at` also came from the database clock while the sign's came
  from the app's). New column `oracle_settings.home_set_at` (migration `0008_sign_home_set_at`), set by the
  app's clock only when a home is saved (`PUT /loracle/settings`, `PUT /oracle/settings`); the sign compares
  with it. Interests no longer re-deal it (nothing in the web app edits them now).
- **The engine could be driven without limit** (alternate a home move and `GET /oracle/sign`). The sign is now
  dealt at most three times in a Lorer's day (a replaced sign is emptied, `futures = []`, not deleted, so it
  still counts), and `GET /oracle/sign` is limited to 30 a minute per Lorer.
- **A chosen sign's plan told invitees the home's distance** ("Where: X, 52 km from home." next to the place's
  coordinates). The description now names the place only.
- **Privacy Policy:** says the device's location may be read (rounded on the device, only after the device
  asks), that each day's sign is kept with the readings and is in the download, and that Nominatim also gets
  the rounded point. deploy/ios/README.md's Coarse Location answer and a Play Data safety note (ROADMAP)
  match it.
- **Map look, accessibility:** focus on text fields is now a 2px vermilion ring (it was only a change of hue,
  1.4:1), including the Lorebook and Friends searches, which had none (`label.input:focus-within`); every
  other native control is vermilion (`accent-color`), and the report sheet's "Also block" is an inked
  tick-box. "Where do you stand?" announces search results and the location note through live regions that are
  always in the page; town results stay usable while the location prompt is open, and a 30 s watchdog ends a
  prompt the browser never answers. "Not this one" on Home moves focus to the next sign's line (or the plain
  door) instead of dropping it.
- **Map look, layout:** a calendar day shows at most four marks (they spilled into neighbouring days at 360 px:
  up to three plans, then your own entries and reminders); the today ring no longer reaches into the dots'
  gap. Long words in the door break instead of hiding under the sky. Chapter pages (story, accounts, quotes)
  are plain paper without the graticule, as spec 7.1 says. Welcome's and "Where do you stand?"'s titles speak
  in IM Fell, like the greeting. The voice font falls back to Fraunces (latin-ext) for letters IM Fell lacks
  ("Łukasz"), via a map-only `--font-voice`; `--font-scroll`, which the Loracle uses, is unchanged.
- **Native back button:** with no history behind the page (as on "Where do you stand?" right after sign-up)
  it now leaves the app instead of doing nothing.
- **Bringing an old look back:** the browser bar follows the look's `--bg` (not a fixed paper colour), and
  `lib/theme.ts` and D32 now say to drop `data-theme="map"` from `index.html` too.
- **Left as is:** the desktop rail's Loracle icon stays Sparkles (the rail shows inside the Loracle, which must
  look as it did); added to DECISIONS Q9 for the owner.

**Checks**

- `npm run typecheck`: passes (shared, api, web).
- `npm test`: 15 files, 231 tests passed (`oracle.test.ts` 38, with 10 for the daily sign, including local
  midnight in Honolulu, the deal cap, passed moments and unrelated settings writes, and 1 for
  `/oracle/reverse`; `loracle.test.ts` gained the "Near me" realm test).
- `npm run build`: passes. One CSS file, 131.7 kB (26.3 kB gzipped); 14 woff2 files, as before; "Where do you
  stand?" is its own lazy chunk (5.0 kB). map.css is 43.7 kB unminified.
- Stone audit (the spec's `rg` for stone tokens and components): hits only in `styles/app.css` lines
  1552–5010 (the ORACLE section and the retired teaser), `pages/Oracle.tsx` and `components/loracle.tsx`; none in
  `map.css`, `sign.css`, Home or Welcome. `git diff` shows no change to the Loracle's files, and app.css's diff is
  comments plus the one `:not([data-theme='map'])`.
- **Not verified (nothing was opened in a browser or on a phone):** the before/after screenshots proving the
  Loracle unchanged, the wordmark needle centred in the O, the compass Create button, the today ring at 320 px,
  þ ð æ ö in Cinzel and IM Fell, the door with and without a sign at 320 px, the Where-you-stand page,
  Nominatim's reverse answer on the live server, location on Android and iOS, the splash and notification
  colours, status-bar icons, and scrolling on the test phone (spec 8.2 to 8.7).

## 2026-11-18 (later still) — The Loracle: review fixes

A review of phase A found holes in safety, money and the owner's wishes. Fixed:

- **Care first, one floor.** The care phrases now live in one list (`lib/loracle/care.ts`), the union of the
  route's and the mind's ("I wish I were dead", "I wish I could just disappear", "no reason to live", "cut
  myself", the Icelandic phrases …), checked before the stone's sleep, consent, realm or any limit.
- **A forged "taken offer" no longer slips past the weighing.** The stone seals its reroute offer
  (`offerToken`, an HMAC over the Lorer, their day and the offer's words); only a sealed offer is told to
  the mind as taken up, and an offer still weighed as harm is silence, never a quest.
- **Money is always counted.** A cast or weighing cut off by a burn, a timeout, shutdown or a closed
  connection now waits a moment for what the mind already paid for and records it; a stream cut off part-way
  is counted from what had arrived; spend is recorded before the scroll is written. Spend rows carry the
  road (`loracle_spend.road_id`, no foreign key) so burning never refunds the hidden limit, and the limit
  counts roads that were paid for (drawn, faded or burned), once each.
- **Bounds on the weighing:** attempts are counted in memory too (care and cut-off weighings included);
  far past the monthly ceiling (×1.1) nothing is weighed and the stone answers "sleeps until the new moon"
  with nothing stored. "Try again" is once a day per road (`wish_roads.retried_on`), rate-limited, needs
  consent and respects the hidden limit.
- **"Stop sending wishes" stops them:** running jobs stop, roads still waiting (queued, being drawn, for the
  new moon) fade, a road is only ever claimed while consent stands, and the new moon wakes only wishes whose
  Lorer still consents.
- **Reach: ANYWHERE by default.** The Loracle has its own reach (`oracle_settings.loracle_reach_km`, null =
  anywhere) instead of the old Futures' 80 km radius. "How far will you go?" and "What calls to you?" now sit
  on the page under the examples, not inside the fold.
- **Only the town leaves the server.** Geocoding labels are town-level (a street or house result becomes its
  town; a street without a town is dropped; cache key v3), the mind is told only the town and country, and
  the consent and privacy text now name the time zone.
- **The page:** the wish field comes first, then "Where do you stand?" (first visit), then the reminder scroll
  below the well. The header's subline is hidden over the care screen and while the stone sleeps. The quest
  page shows the sleeping stone instead of a wait that never ends; one fog line during the back-off; the
  Home card and Create menu (a flame, not sparkles) fit the stone.
- **The mind:** errors that arrive inside a stream are classified by `.type` (overloaded → the 30 s
  back-off); a streamed answer finished by a fallback model is read across the boundary; the scouts are told
  to write their dossier once, at the end (Opus 5.5 returns notes between tool calls as thinking); a scout
  that brings back nothing is logged with its stop reason; the 64K compose rerun is skipped when the job
  could not see it through. The mind is made inside `buildApp` so its lines reach the app's log.
- **Logs and export:** a failed query is logged without its bound values (`lib/safeLog.ts`); the export now
  includes what the weighing read about the Lorer (tags, the wish beneath, binds, companion, clock).
- **Copy:** search signs keep proper nouns and drop operators and dates; "Ask them to …" verbs; the fake
  quests no longer send anyone to a library; several lines rewritten in the stone's voice.
- Migration 0007 adds the three columns (0006 is left as it was, so a dev database that already ran it
  migrates cleanly; checked on a copy of the local dev database). **Checked:** 219 tests (15 files) pass; typecheck; production
  build. Smoke test with the fake mind on a fresh PGlite, port 4100 (fetch, no browser), 44/44: gates, cast,
  scroll and deeds, town-level geocoding of a street search, reach defaults to ANYWHERE, a forged reroute
  weighed as new, the sealed offer cast, care for "I wish I could just disappear", "Stop sending wishes"
  fading a road mid-draw (cast and Try again then 403), a hard kill and a restart after the road went quiet
  (the boot sweep drew it, 2 attempts), no wish text in the log. The data was deleted afterwards.
- **Not verified:** everything in the entry below that needs the live API or a browser still does.

## 2026-11-18 (late night) — The Loracle: tell the stones what you wish for (phase A)

- **Wishes first, wishes only.** The Loracle (`/oracle`) now opens on "These stones see what you do not" and a
  carved field prefilled "I wish ". The stone draws a **quest** for the wish: a calling, a road of waypoints
  (the first two open, the rest sealed until the one before is inked or the seal is broken), whom to find,
  what each step earns, provisions, one rule, a deed for this week, what is still in the fog, and where the
  stone looked. The tourist Futures (aurora nights, hot springs, museums, weekend journeys) are gone from the
  page, the Home teaser and Create; their API routes, tables and `lib/oracle.ts` stay untouched so exports
  still hold old readings.
- **The stone's questions** (private, `oracle_settings`): Where do you stand? (required; only the town line
  and country leave the server), How far will you go? (the stepped slider to ANYWHERE), What calls to you?
  (new quest-shaped callings), and the "What the stone should know" fold (age band, money, time, body,
  tongues, passport).
- **The mind** is Claude Opus 5.5 through Anthropic's API (D31): a weighing (care / riddle / reroute /
  quest / silent), two research passes with web search and web fetch, a ledger in code that keeps only
  URLs the tools returned, a structured compose, code checks with one repair, then pins from Nominatim.
  Care comes first: a floor of unmistakable phrases answers with a crisis line before any model is asked.
  13–17 age band → teen-safe roads. `@anthropic-ai/sdk` 1.10.0 added.
- **Deeds:** break the seal, make it a plan (a private all-day event, you as organizer), keep it in the
  vault (only-me idea), put it in my week (a reminder at 18:00 by default), I did this (ink + note), write
  the chapter, the wish came true, let it go, burn. "Stop sending wishes" on the Loracle and in Profile →
  Your data.
- **Limits, never shown as numbers** (D30 still holds): about 10 casts in a rolling 24 h per Lorer and a
  generous cap on weighings (40), answered "the stone rests"; the owner's monthly ceiling
  `LORACLE_MONTHLY_USD` (default 150) writes the wish down for the new moon. Wishes waiting for the moon
  count toward the per-Lorer limit.
- **Asleep and dreaming:** without `ANTHROPIC_API_KEY` the stone sleeps (casting off, `/api/health` says
  `loracle: "asleep"`). `LORACLE_MIND=fake` (dev only; set for the `lore-api` launch entry) runs a
  deterministic fake mind: real-looking signs over ~8 s and a canned quest ("The Ninth Limb" for the Lethwei
  wish, "The Unwalked Road" otherwise), no network, no cost.
- **Integration fixes:** geocoding now asks Nominatim for address details and returns the ISO-2 country
  (new cache key), so new realms carry their country; the owner-only loaders moved to `lib/access.ts` and
  the quest log to `lib/queries.ts`; phone reminder syncing no longer cancels the "Tell me when it's sealed"
  notice; the fake mind treats "I wanna be happy" as a riddle; `.env.example` and `docker-compose.yml`
  carry the new variables.
- Migration 0006. **Checked:** 201 tests (15 files) pass; typecheck; production build. Smoke test with
  the fake mind on a fresh PGlite (curl, no browser): register → consent and realm gates → cast the Lethwei
  wish (202) → sealed in ~8 s → scroll with 5 waypoints (0–1 open, 2–4 sealed without trial or keeper) →
  ink on a sealed one refused (409) → break seal → plan (201, private event on the waypoint's month) →
  vault → This week reminder, moved → I did this → duplicate cast returns the same scroll → riddle →
  answer → second quest → let go / take up / came true → export (no weighing, forge, dossiers or note ids)
  → burn (plans and reminders stay) → stop sending → hard kill mid-draw and restart: the boot sweep
  retried the road and drew it. No wish text in the server log.
- **Not verified:** no real Claude call has been made (no key on this machine; the live eval
  `tools/loracle-eval.mjs` is written, not run), so the prompts, the quality of real quests, cost per quest
  (estimated ~US$0.90–2.40), the SDK's `fallbacks` with structured output and the 20260209 web tools are all
  unproven against the live API. Nothing was looked at in a browser: the page look, motion, the 360 px
  layout, contrast and the notifications. The crisis lines and emergency numbers, the Icelandic care
  phrases and the consent and privacy wording about Anthropic must be checked by a person before release.

## 2026-11-18 (night, later) — No limit on adventure; the Oracle in stone and scroll

- **How far: no limit.** The realm now goes 10 km … 1,000 km … 10,000 km … **No limit** (anywhere on
  Earth, `NO_LIMIT_KM` = 20,000). Past 300 km places come from an index of notable places worldwide
  (one Wikidata query per kind of place, shared by every home, cached 30 days, with back-off on 429s);
  the ≤300 km search is unchanged.
- **Journeys:** past 250 km a place is a weekend (one night) or a long weekend (two nights) with road
  hours; past 1,500 km it's **A Far Shore**: fly out Saturday, a week away, passport and visas. With No
  limit, far shores get extra weight. Same-day futures keep their near caps (aurora, dawn, springs).
- **Look:** the whole Oracle is carved stone and old parchment: stone altar for the controls, carved
  mode stones, rune counter for readings left, scroll rods, wax seals, inked tick-box for the crew,
  stone top bar and tab bar on the Oracle, sepia/wax emoji; reduced motion respected.
- Checked: 99 tests; typecheck; build; in the browser at phone width (look, slider at No limit, a live
  reading from Reykjavík offering "A Far Shore: White Desert", 5,408 km). **Not yet verified:** the
  notable-places index on the live server's first run (the mountains query takes ~30 s), crazy theme
  and the native status bar on a device.

## 2026-11-18 (night) — Getting back into an account

- `npm run account:recover`: find an account by username, email or name and set a new password straight
  in the database (hidden prompts; hashed with the live server's settings; signs out everywhere). For the
  owner, and for answering forgot-password messages until LORE can send emails.
- 3 tests (find exact/close matches, reset + sign-out + sign-in). Tried on a copy of the demo database
  with piped input: new password verifies, old one doesn't. **Not yet tried** typing into a real
  PowerShell window (hidden typing) or against the live database.
- **Change password** (Profile → Settings): current password + new one twice; this device stays signed
  in, all others are signed out (`POST /api/me/password`). 3 tests (92 total, all passing). Typecheck and
  build clean; the sheet itself not yet clicked through in a browser.

## 2026-11-18 (evening) — Ready for strangers: report, moderate, Terms, Privacy, Help (0.5.0)

- Report (with optional block) on messages, chapter stories, chapters, plans, ideas and profiles;
  Moderation screen for `ADMIN_USERNAMES` (dismiss / take down / suspend / lift); Home banner for
  moderators; suspended accounts can't sign in.
- Terms of Use and Privacy Policy (public pages), Terms checkbox at sign-up, Help & contact page with a
  contact form (also for people who aren't signed in). Export includes reports and messages; messages
  are deleted with the account.
- Migration 0005. 11 new tests (86 total, all passing). Checked in the browser: reporting a story, the
  moderation screen, dismissing, Privacy and Help pages, the sign-up form with the checkbox.
- Owner's answers: paid download, code private, iPhone available for TestFlight.
- Not done: forgot-password emails (needs an email service).

## 2026-11-18 (later) — Stone and scrolls, the reminder, iPhone

- The Oracle now looks like an ancient magic stone (granite, glowing SVG runes, a window onto the night)
  with each future on a parchment scroll; Cinzel and IM Fell English fonts (OFL). Checked in the browser
  at phone width. Deployed (live update for installed apps).
- The owner's friendly reminder as an original fable (D27), on the Oracle (can be rolled up) and the
  welcome page. The welcome page placement wasn't looked at in the browser (signed-in session).
- The owner's Android phone is out of action; iPhone path started (D28): `apps/ios` generated with
  Capacitor + SPM on Windows, iOS icon (opaque 1024 px) and splash, `tools/ios.mjs prepare` (checked:
  server address bundled, live updates configured), cloud build workflow to TestFlight (not run: no Apple
  account yet), owner's guide in deploy/ios/README.md.

## 2026-11-18 — The Oracle (0.4.0)

- **The Oracle** (owner's "expand" vision, D26): set a realm (town search via Nominatim, or "Use my
  location" on the web, rounded to ~1 km), a radius and interests; read the stones up to three times a
  day for three possible futures. The engine is pure and seeded; it reads Wikidata places, Open-Meteo
  weather (night/dawn cloud), NOAA Kp, the moon, your free time, crews, ideas and old chapters.
- *Choose this destiny* makes a real plan (events now have `lat`/`lon` for the coming Lore Map), *Save
  to vault* makes a private idea, *Not this path* dismisses. Export includes the realm and readings.
- Migration 0004 (`oracle_settings`, `oracle_readings`, `world_cache`, `events.lat/lon`).
- 20 new tests (engine: conditions, modes, busy time, realm radius, recency, ideas/memories; API:
  settings, privacy, choose/save/dismiss, daily limit, export). 75 in total, all passing.
- Checked in the browser against the real services from a local server: Reykjavík realm → aurora night at
  Ægissíðufoss (Kp 2.3, 43% cloud), a hot soak, a museum wildcard on a rainy Monday; chose the aurora and
  got a real plan with the crew. Fixed from that run: snow vs rain wording, distance shown once, hot soaks
  within 90 km, English place names.
- Local dev hit a full commit limit (Windows page file on the nearly full C:): the 128 MB scrypt check for
  the demo login failed until the Vite dev server was stopped. Tested via a production build instead.
- Not yet verified: the Oracle on the owner's phone (it should arrive by live update).

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
