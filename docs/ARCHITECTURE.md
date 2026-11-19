# LORE — Architecture

This covers the technical deliverables requested in the brief (part XXXVII): stack, architecture, database
schema, authentication, privacy model, navigation, development environment and folder structure. Product
intent lives in [MASTER_BRIEF.md](MASTER_BRIEF.md); the reasoning behind individual choices is in
[DECISIONS.md](DECISIONS.md).

## 1. Stack, and why

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for API, web and (later) native shells; types shared end to end. |
| Web client | **React 19 + Vite 8**, installable **PWA** | Mobile-first, works in any phone browser today, installs to the home screen, and the same code becomes the native app. |
| Native apps (next) | **Capacitor** around the web client | The owner wants web first, then a real app as soon as possible. Capacitor reuses 100% of the web UI and produces real iOS/Android apps; the JDK and Android SDK are already on `D:\dev`. |
| Routing / data | React Router 8, TanStack Query 5 | Standard, well-supported; Query handles caching and refetch after writes. |
| API | **Node 22.18+ / 24 + Fastify 5** | Fast, typed, small. Node runs the `.ts` sources directly (type stripping), so the API has no build step. |
| Validation | **Zod 4**, shared by client and server | Every request body and query is parsed on the server; the same schemas drive form errors. |
| Database | **PostgreSQL** via **Drizzle ORM** | Relational data with real constraints (the brief is a graph of people, crews, events and chapters). Drizzle gives typed queries and generated SQL migrations. |
| Dev & test database | **PGlite** (Postgres compiled to WebAssembly) | Real Postgres with nothing to install: persisted to `.data/pglite` in development, in-memory per test file. |
| Media | Object storage behind a `MediaStorage` interface | Local disk now; an S3-compatible driver slots in for production scale. The database stores only keys. |
| Deploy | One Docker image (API + built web app) + Postgres | Runs on any container host or VPS; `docker-compose.yml` included. |

Rejected for now: Supabase (owner chose own API + Postgres), React Native/Expo (slower path to "web first"),
a separate SPA host (one server is simpler to deploy and keeps cookies same-origin).

## 2. Application architecture

```
 Browser / installed PWA  ──┐                         ┌──> PostgreSQL  (prod: DATABASE_URL)
 Capacitor iOS/Android ─────┤  HTTPS  ┌───────────┐   │    PGlite      (dev: .data/pglite, tests: memory)
 (next)                     ├────────>│  Fastify  │───┤
 Cardboard (last, via OIDC  │  /api/* │   API     │   └──> MediaStorage (dev: .data/media, prod: S3-compatible)
 and docks)  ───────────────┘         │  + static │
                                      │  web app  │
                                      └───────────┘
```

Inside the API every request goes through the same pipeline:

1. **`onRequest` hook** (`apps/api/src/app.ts`): blocks cross-site writes, then resolves the session (cookie
   or bearer token) to `req.userId`.
2. **Route handler** (`apps/api/src/routes/*.ts`): `requireUser(req)`, then `parse(Schema, req.body)` with a
   shared Zod schema.
3. **Access check** (`apps/api/src/lib/access.ts`): loads the target with a visibility predicate
   (`loadVisibleEvent`, `loadVisibleChapter`, …), which returns 404 for anything the viewer may not see,
   then checks the role needed for the action (organizer, crew admin, chapter person, author).
4. **Write**, inside a transaction when several rows change together.
5. **Notify** (`lib/notify.ts`) the people the change matters to.
6. **Respond** with a DTO from `packages/shared/src/types.ts`, built by the shared read queries in
   `lib/queries.ts` (which apply the same visibility predicates).

The Lore Engine lifecycle from the brief maps onto real transitions:

```
 Idea ──(I'm in)──> gathering interest ──(Make it happen)──> Event (planning)
   │                                                            │ RSVP, packing list, discussion
   │                                                            ▼
   │                                                 confirmed → happens
   │                                                            │ "Create Lore chapter"
   ▼                                                            ▼
 completed <──────────── event completed <──────────── Chapter (snapshot of event facts)
                                                            │ stories, quotes, photos from everyone
                                                            ▼
                                                   Lorebook, Home "Recent lore", "On this day"
```

None of the steps is mandatory: chapters can be written with no event (including years later), ideas can
stay ideas, events can end without a chapter.

**The Oracle** feeds the front of that lifecycle with futures nobody thought of yet:

```
 lib/world.ts (WorldData)                      routes/oracle.ts                    lib/oracle.ts (pure)
 Wikidata places ─┐                           gathers, per reading:               templates → candidates
 Open-Meteo ──────┼─ world_cache ──> realm ──> free time, crews, ideas, ──> generateFutures ──> deal 3
 NOAA Kp ─────────┤   (stale on                memories, recent places          (seeded)      (mode)
 Nominatim ───────┘    failure)                                                         │
                                                         oracle_readings <──────────────┘
                                                                │ choose → events (+lat/lon)
                                                                │ save   → ideas (only_me)
```

`WorldData` is injected through `AppContext`; tests pass a fake world, so they never touch the network.

Since D31 the web app no longer shows the Futures above on `/oracle`; their routes, tables and
`lib/oracle.ts` stay for exports and for **the daily sign** (D32): `GET /oracle/sign` deals one mixed reading
a day around the Lorer's home (within `min(radius_km, 250)` km), kept in `oracle_readings` with
`mode = 'sign'`. It never counts toward the three readings a day, `GET /oracle` never returns it, and it reads
back as `'mixed'`; Home's Loracle door shows its first open future still ahead (or the one chosen today) and
answers it with the usual `POST /oracle/readings/:id/futures/:index/choose | dismiss` (choose refuses a moment
that has passed, and a plan's description names the place but not its distance from home). While nothing in
it is answered, it is dealt again when the Lorer says where they stand (`oracle_settings.home_set_at`, by
the app's clock; consent, reach and the rest don't count) or once every moment in it has passed: at most
three deals in the Lorer's day. A replaced sign is emptied (`futures = []`), not deleted, so it still counts.
`GET /oracle/sign` is limited to 30 a minute per Lorer. `GET /oracle/reverse` (`world.reverse`, Nominatim reverse at town level, point
rounded to two decimals) names the town at the device's location for "Where do you stand?"
(`/welcome/where`). **The Loracle** (wishes) replaced the Futures on `/oracle`:

```
 web /oracle ──POST /api/loracle/wishes──> routes/loracle.ts
                                             1. care floor (lib/loracle/care.ts, no model) ──> care screen, nothing stored
                                             2. asleep? consent? realm? same wish today? hidden limits? far past the moon?
                                             3. mind.weigh (Claude, effort low) ──> care | riddle | reroute | silent
                                             4. quest: wishes + wish_roads (queued) ──202──> web polls GET /wishes/:id
                                                │      (past LORACLE_MONTHLY_USD: status `moon`, read at the new moon)
                                                ▼
 lib/loracle/jobs.ts  (≤3 at once, one per Lorer, run_id guard, heartbeat, boot + lazy sweeps)
     mind.cast ── two research passes with web search/fetch (streamed; signs → road.signs)
              ── ledger.ts (code: only URLs the tools returned, dated, merged)
              ── compose (structured output, effort high) ── checks.ts (+ one repair) ── draw.ts marks
     ──> road `ready` + wish_waypoints ──> drawPins (Nominatim) ──> road `drawn` (the scroll is sealed)
     every model request ──> loracle_spend (cost, tokens, no text)
```

- `AppContext.mind` is the `LoracleMind` (`lib/loracle/types.ts`): `claudeMind` (`mind.ts`, `client.ts`,
  `prompts.ts`, `schema.ts`) when `ANTHROPIC_API_KEY` is set, `fakeMind` (`fake.ts`) when
  `LORACLE_MIND=fake`, and undefined while the stone sleeps (`buildApp` makes it with the app's logger via
  `mindFor`; `/api/health` reports `loracle`). Tests inject stub minds and a fake world, so they never
  touch the network.
- Money is counted per request, always: when a job or a weighing loses a race to an abort, it waits a moment
  for the mind's own error, which carries what was already paid (`lateSpend`); a stream cut off part-way
  (`CutOff` in `client.ts`) is counted from what had arrived. The app's error serializer
  (`lib/safeLog.ts`) never logs a failed query's bound values.
- What reaches Anthropic is listed in D31. The weighing, the ledger's dossiers, the forge and note ids stay
  on the server; views are built field by field in `routes/loracle.ts`, and **sealed waypoints are sent
  without their trial, keeper, earns, steps, ink and links**. Visibility is owner-only
  (`wishVisible`, `loadVisibleWish/Road/Waypoint` in `lib/access.ts`; the quest log is
  `wishSummaries` in `lib/queries.ts`).
- Deeds reuse the existing models: a plan is a private all-day `events` row with the Lorer as organizer, the
  vault is an `only_me` idea, "my week" is a `notes` reminder, "write the chapter" is a private chapter
  linked back through `PUT /loracle/waypoints/:id/link`.
- **Not verified against the live API** (no key has been used): the prompts, structured output with
  fallbacks, the `_20260209` web tools' options and the real cost. See `tools/loracle-eval.mjs`.

### Live text: the copy layer (D33)

The owner rewords any screen from inside the app and publishes it; nobody needs a deploy.

```
 build (Vite, web only)                     every client (main bundle)                  server
 apps/web/vite/copyPlugin.ts (enforce pre)  lib/copy/runtime.ts  (virtual:lore-copy)    routes/copy.ts + lib/copy.ts
   rewrites static words in apps/web/src      __t / __tm / __tl: draft > published >      GET  /api/copy        public, from memory
   and vocabulary.ts into lookups:            default; __useCopy re-renders              GET  /api/admin/copy  owner
   <h2>Hi</h2> -> {__tm("pages/X#1a2b..",     lib/copy/sync.ts: cache, refetch when      GET  /api/admin/copy/history?key=
   "Hi", {}, 2)}; tables become getters;        x-lore-copy differs, on focus/resume     PUT  /api/admin/copy  publish
   __useCopy() into every component           lib/copy/gate.tsx: owner + switch ->       POST /api/admin/copy/undo
   scans apps/api for static messages           drafts + lazy editor chunk              x-lore-copy on every /api/* response
   emits dist/copy-catalog.json (every key)   components/copyEditor/* (copy-editor-*,    copy_overrides / copy_revisions /
                                                not precached, owner only)                 copy_state; catalog read at boot
```

- **Keys** are `<scope>#<FNV-1a of the default>`: `pages/Home#…`, `shared/vocabulary#…`, or `srv#…` for server
  messages (`packages/shared/src/copy.ts`: one `hashText`, message parser, `checkOverride`, `copy()` for
  plugin, runtime and server). Changing a default in code changes its key, so an old edit becomes an
  **orphan** (shown to the owner, never silently re-applied); the same words moved to another file are
  re-attached at boot by `followMoved()` (one automatic `follow` revision).
- **What the plugin rewrites**: JSX text (a whole element's children are one message, inline `em/strong/…`
  kept as tags, other elements and expressions become `{placeholders}`), text attributes and props
  (`copyNames.ts` classifies every name; the coverage test fails on an unknown one), `confirm/alert/prompt`,
  template literals in those places, module tables named `*_LABELS`/`*_LINES` or marked `// copy:table`, and
  `copy('…')` calls from `#shared`. Skipped: `lib/copy/**`, `components/copyEditor/**`, `<code>/<pre>/<textarea>`,
  `data-copy="off"` (the logotype), `// copy:ignore` and the crisis data (`CRISIS_LINES`, `EMERGENCY_NUMBERS`,
  `FIND_A_HELPLINE`, by name).
- **Rendering is text only.** An override becomes React text, an allowlisted string attribute, or
  `createElement` for `em strong b i u small mark br`; no HTML parsing, no URLs. An override whose
  placeholders, tags or characters don't fit its default renders the default (and the editor lists it).
  Node-mode messages return keyed arrays (`p:<name>` per placeholder), so reordered words never remount an
  `<input>` inside them.
- **Server words.** `app.ts`'s error handler says every message and field through `liveCopy.say()`
  (`srv#` key, then `shared/vocabulary#`); notification titles and the stone's signs (`signLine`) are
  `copy('{actor} wants to be friends', { actor })` templates resolved by the server at creation time (rows
  already stored keep their words). Only static messages found by the build's scan are keys, so no Lorer's
  data can end up in the public `GET /api/copy`. The web `serverCopy()` maps an incoming message back to its
  key (by its own hash, by published words, or by a default the web uses) for edit marks and drafts.
- **Edit mode** (owner only): `__t/__tm` append an invisible marker (`U+2063`, base-4 digits in
  `U+200C U+2060–2062`, `U+2064`) so `scanner.ts` can outline marked text and a capture-phase tap opens the
  editor. `api.ts` strips markers from every outgoing JSON string and form field, always.
- **Staying current with no timers**: every API response carries `x-lore-copy: <version|0>` (exposed to the
  native origins); `sync.ts` fetches `/api/copy?v=` once when it differs (1 s debounce), and on tab
  visible / window focus / Capacitor resume. The cache (`localStorage['lore.copy']`) applies before the first
  render. A render crash with live words applied drops the cache and reloads once (`guard.tsx`; also each
  top-level route's `errorElement`).
- **Who publishes**: `isOwner`/`requireOwner` in `lib/access.ts` (also moderation and `Me.isAdmin` /
  `Me.canEditCopy`): `ADMIN_USERNAMES` when set; unset, the account `gosinn` created before
  2026-11-19T00:00Z (`OWNER_DEFAULT` in config.ts; no cut-off for local development on the embedded
  database). Admin routes: 401 signed out, 404 for everyone else. Publishing: one transaction, one revision,
  optimistic `baseVersion` (409 when stale), 30 writes a minute and 20 publishes an hour; in production every
  key must be in the served build's catalog (`<PUBLIC_DIR>/copy-catalog.json`). `COPY_OVERRIDES=off` is the
  kill switch (read leniently: anything but unset/empty/`on`/`true`/`1`/`yes` is off).
- **Hidden characters** never get in: `COPY_FORBIDDEN` (shared) refuses controls, bidi and zero-width
  marks, separators, `U+2060–206F`, tag characters and the variation-selector supplement in an edit and
  in its context; "Copy for Claude" and `copy:check` print any that reach them as `\u` escapes.
- **The catalog lists what ships**: `generateBundle` drops keys no chunk carries (a word-list table no
  screen uses), except `srv#` keys and word-list tables the API names itself.
- **Moved or baked**: `followMoved()` skips an orphan whose words are now the code's own text in its file
  (baked through "Copy for Claude"), so it never copies them onto another file's identical default.
- **The crash guard ignores stale page code** (a lazy page chunk the new service worker dropped after a
  deploy): that reloads once (at most once a minute) and keeps live text on.
- `npm run copy:check` compares the keys at `HEAD` with the working tree and lists live edits a code change
  would orphan.

### The look: one base, many worlds (D34)

Every screen wears the Loracle's own kit (stone buttons, wells, slabs, stamps; Cinzel and IM Fell English) over
a **world**, the page's background, picked per device. Nothing here touches the API or the database.

- **What `<html>` carries**: `data-theme="lore"` (the one look; retired looks keep their CSS, D32/D34),
  `data-world` (the world on screen, from the one list `WORLDS` in `lib/theme.ts`: dark ones and light ones)
  and `data-daylight` (that world's tone: `day` on a light world, else `night`). `data-cards="vellum"` is a
  prepared, unused hook for light cards by day.
- **What a Lorer picks** (Profile → Your world): one world, always (Auto off, the default), or Auto: a dark
  world by night and a light one by day, by the phone's light/dark or the sun (D34's note of 2026-11-19).
- **Who sets it**: `index.html`'s boot script before the first paint (the hint `lore.boot` that `applyLook()`
  leaves, so the script lists no worlds; the phone's light/dark, the sun's cached answer; Welcome, and any
  start with no one signed in on the device, pinned to the default world by night), then `lib/theme.ts`
  (`applyLook()`, a small store with `useLook()`), kept current by
  `components/World.tsx`: the phone's switch, the app coming to the front, other tabs' choices (never their
  sun cache or boot hint, which every tab writes), and a timer at the next sunrise or sunset. "Follow the sun" reads the
  Loracle's home point once from `GET /loracle` (rounded to 0.1° and kept in `lore.sun`); the sun's position is
  NOAA's equations, on the device. The cache for the boot script (`lore.sunNow`) holds the answer and the next
  14 turns (about a week; near the polar night, the last half for 48 h past the last turn), on whole minutes,
  and is rewritten only when it changes. World.tsx reads who is signed in from the query cache (as the copy
  gate does: `qc.clear()` doesn't tell a `useMe()` observer) and keeps the `lore.in` hint and the home point in
  step with it. Choices live in `localStorage` (`lore.auto`, `lore.world`, `lore.nightWorld`, `lore.dayWorld`,
  `lore.daylight` (Auto's driver), `lore.sun`, `lore.sunNow`, `lore.boot`, `lore.in`), every access in
  try/catch.
- **The stylesheets, in this order** (main.tsx): `app.css` (base tokens, components, the temple), `map.css`
  (retired; its rules are guarded by `data-theme='map'` except the shared compass rose, trail, Welcome and
  Home door), `worlds.css` (each world's art as `--world-art` on any `[data-world]` element, the backdrop,
  Profile's picker), `lore.css` (the kit and the world tokens `--world-bg`, `--world-top`, `--slab`; text on
  the world; day ink; last, so it wins without specificity).
- **The guard**: every kit rule starts with `:where(html[data-theme='lore'] body:not(:has(.oracle-page)))`.
  While the Loracle is open none of it applies, the backdrop is hidden and body's temple wall shows. Where
  app.css outranks a zero-specificity rule (its plain `body` font, `.notification.unread`), lore.css uses the
  guard without `:where()` or repeats the property on a matching compound selector.
- **Text on the world**: the legibility shadow plus a 2px halo; by day ink on a vellum plate; at night on the
  four bright worlds (northern lights, mountain range, treasure map, scroll) the same blocks sit on a dark
  feathered plate (`--plate-night`).
- **The backdrop** is one element, `<div class="world" aria-hidden="true">` in `index.html` outside React:
  `position: fixed; z-index: -1; height: 100lvh; contain: strict; will-change: transform`, so scrolling and
  the phone's toolbars never resize or repaint it. Body's `--bg` (the world's base colour) is the canvas under it.
- **The browser bar** wears the world's top edge (`WORLDS[].bar` in theme.ts = `--world-top` in lore.css; AppShell
  reads `--world-top` on navigation, theme.ts on a world change); stone (`#24211e`) inside the Loracle.
- **Tests** (`apps/web/vite/test/theme.test.ts`, outside `src` so its names aren't live-text words): the sun
  against almanac times, the choices, the boot script run in a sandbox, and the stylesheets' world colours
  against theme.ts.

### The Lore Map (D35)

Chapters, plans and ideas can have a place; `/lorebook/map` shows the ones the viewer may see.

- **Data**: `GET /api/map?mode=mine|crew|memories|adventures&crew=<id>` (`routes/map.ts`) answers
  `MapResponse { features: MapFeature[], hidden }` from `mapFeatures` in `lib/queries.ts`: one query per kind
  (chapters, plans, ideas, Loracle waypoints), each through its visibility predicate and `placeShown`, nearest in
  time first, at most `MAP_CAP` (400) in all; home (where you stand, `oracle_settings`) first and extra. A crew
  you aren't an active member of is a 404. Canceled plans and archived ideas never show; a plan whose chapter
  is on the same map shows once, as the chapter; a waypoint made a plan or kept as an idea whose pin this
  viewer gets shows as that (the same visibility and `placeShown` rules). Memories: plans over (an all-day plan
  at the end of its last day) or marked done; Adventures: the rest.
- **Who gets which point**: `placeFor(access, …)` in `lib/access.ts` is the only way coordinates leave the
  server (item routes, the map, the export); `placeAccess` (SQL) says `own` / `shared` / `none` per row
  (`none`: the author's "Show my places on maps" is off, or a block either way). `approximatePoint` rounds to
  `PLACE_GRID_DEG` (0.05°) of latitude and a whole number of equal longitude steps per row, so a point always
  rounds to the same node. Writing goes through `lib/places.ts` (`placeColumns`, `carriedPlace`). A point is
  carried into a new item (idea → plan, plan → chapter) only when its author makes it (`own` access): who gets a
  point keys on `created_by`, so another owner's copy would escape the author's blocks, switch and audience.
  An idea's `locationName` goes out only with its point (`ideaSummaries`); a plan's or chapter's is their
  "Where" and always shows. `sharesPlaces` tells whether a plan's point moving reached anyone (its author's
  switch). An Oracle plan or vault idea with a point has its story's and signs' distances from home left out
  (`withoutDistance` in `lib/oracle.ts`).
- **Inputs**: `place: { name, lat, lon, precision? } | null` on the create and update inputs of chapters,
  plans and ideas (`PlaceInput`): an object sets name, point and precision (an empty name is stored as none);
  `null` clears the point and the name (a `locationName` in the same request stays); left out changes nothing. `PATCH /me { showPlaces }`.
- **Web**: `pages/LoreMap.tsx` (modes, crew picker, the item sheet, "Places on this map" as an accessible list,
  "Your places" with the switch), `lib/map.ts` (`useLoreMap`, `useShowPlaces`), `lib/mapStyle.ts` (the night
  and day styles on the OpenMapTiles schema, pins, circles and clusters drawn on a canvas in the kit's
  colours), `styles/map-page.css`. MapLibre GL is a chunk of its own loaded only by this page, with its worker
  started from a `blob:` copy; neither is precached, and tiles (`tiles.openfreemap.org`) never are, so offline
  the frame says the map needs a connection (Try again, and again by itself on `online`); without WebGL2 it
  shrinks to a line pointing at the list. About here circles are 4 km in radius (they hold the whole grid
  cell), one per spot; a tap on a spot, or on a cluster that never parts (past `clusterMaxZoom` 13), lists
  every place there in one sheet. The kit's `Sheet` (`components/ui.tsx`) moves focus in, keeps Tab inside and
  gives focus back on close, like the Loracle's `ScrollSheet`.
  `components/PlacePicker.tsx` is the Place row in the chapter, plan and idea forms: search with
  `GET /oracle/geocode` (town-level names), pick, Exact / About here (~5 km) / Only me, Remove place. An editor
  who isn't the author reads words that name the author and isn't offered Only me.
- **Tests**: `apps/api/test/map.test.ts` (validation, defaults, precision by every route, the switch, blocks,
  parity with the item routes, modes, crew 404, waypoints and home, the cap, points that travel only with their
  author, idea names, all-day and done plans, export and deletion), and `oracle.test.ts` (no distance from home
  beside a chosen or saved place). The page and the picker have no tests and haven't been seen in a browser.

## 3. Database schema

Defined in `apps/api/src/db/schema.ts`; SQL migrations in `apps/api/drizzle/` are generated from it
(`npm run db:generate`) and applied automatically on server start.

| Table | Purpose | Notable columns / rules |
|---|---|---|
| `users` | Accounts | `username` and `email` unique, lowercase; `password_hash` (scrypt); `avatar_media_id`; `show_places` ("Show my places on maps", default on) |
| `sessions` | Sign-in sessions | id = SHA-256 of the token (token itself never stored); sliding expiry |
| `friendships` | Friend requests and friendships | one row per pair (unique on least/greatest ids); `pending` / `accepted` |
| `blocks` | Blocks | blocking deletes any friendship between the two |
| `crews` | Groups | `emoji`, `members_can_invite` |
| `crew_members` | Membership | role `owner` / `admin` / `member`; status `invited` / `active` |
| `ideas` | Idea Vault | status lifecycle; audience `only_me` / `friends` / `crew`; where/when/budget notes; a place: `location_name`, `lat`/`lon` (both or neither), `place_precision` (default `approximate`) |
| `idea_interest` | "I'm in" on an idea | |
| `events` | The LORE calendar | UTC instants + IANA `time_zone`; audience `participants` / `friends` / `crew`; `idea_id` link; `capacity`; `lat`/`lon` + `place_precision` (default `exact`) |
| `event_participants` | Invitations and RSVPs | role `organizer` / `participant`; rsvp `invited` / `going` / `maybe` / `declined` |
| `event_checklist_items` | Packing list | assignee |
| `personal_entries` | Private calendar | never joined into any shared query |
| `chapters` | Lorebook chapters | `occurred_on` date (+ optional `ended_on`); `event_id` unique (one chapter per event); own copy of title/date/place; `lat`/`lon` (both or neither) + `place_precision` (default `approximate`); audience `only_me` / `participants` / `crew`; cover photo |
| `chapter_people` | Who a chapter is about | personal Lorebooks reference the same chapter, never copies |
| `contributions` | Each person's piece of a chapter | `story` / `quote` (speaker user or name, context) / `photo` (media) |
| `media` | Uploaded files | `storage_key`; scoped to at most one of chapter / event / crew (none = profile picture) |
| `comments` | Discussion threads | exactly one of event / idea / chapter |
| `notifications` | In-app notifications | title rendered at creation, `href` to open |
| `notes` | Notes to self and reminders | private to the owner; `remind_at` makes it a reminder; optional `event_id` |
| `oracle_settings` | The Oracle / Loracle: the stone's questions | private; home label (town-level) + rounded coordinates + `home_country` (ISO-2), `loracle_reach_km` (the Loracle's reach; null = ANYWHERE), `time_zone`, `loracle_context` (age band, money, time, body, tongues, passport, callings), `loracle_consent_at`, `home_set_at` (when the home was last said, for the daily sign); `radius_km` and `interests[]` are the old Futures' |
| `wishes` | The Loracle: a Lorer's wish | private to the Lorer, cascades with the account; `text`, `text_key` (same wish today), snapshot of `context` and `realm`, local `day`, status `listening` / `moon` / `revealed` / `faded` / `silent` / `fulfilled` / `released`; `weighing` and `ledger` are server-only |
| `wish_roads` | The quest drawn for a wish (one per wish in phase A) | status `queued` → `searching` → `drawing` → `sealing` → `ready` → `drawn` (or `faded` / `silent`); `signs[]` for the wait; `quest` (JSON scroll); `run_id` + `heartbeat_at` guard the job; `attempts`, `failure`, `retried_on` (one "Try again" a day), `this_week_reminder_id` |
| `wish_waypoints` | The waypoints of a road | position, kind, emblem, when/at, place/town/country + pin (`precision`), clue, trial, keeper, earns, steps, mystery; `seal_broken_at`, `inked_at`/`inked_on`/`note`; links to the event, idea, chapter and reminder that came of it (set null when those go) |
| `loracle_spend` | One row per model request | stage, outcome, model, tokens, searches, fetches, `cost_micros`, `road_id` (no foreign key: a burn never refunds the hidden limit); **no text**; user and wish set null on delete so the month's spend survives burns and account deletion |
| `oracle_readings` | The Oracle: what the stones showed | private; local `day` (for the 3-a-day limit), `mode`, `futures` (JSON, with each future's status and resulting event/idea). `mode = 'sign'` is Home's daily sign (D32): never counted, never returned by `GET /oracle` |
| `copy_overrides` | Live text: the owner's published words (D33) | key `<scope>#<hash>` (primary key), `text` (1 to 8,000 characters), `original` (the default it replaces), `context`, `followed_from` (set when a deploy moved the words), `updated_by` (set null when the account goes). Public through `GET /api/copy`; never personal data |
| `copy_revisions` | Every publish, undo and automatic follow | `kind` `publish` / `undo` / `follow`, `published_by` (null = automatic or deleted account), `undo_of`, `changes` (JSON: key, before, after, original, context) |
| `copy_state` | One row: the published version | `version` = the latest revision id (optimistic publishing, the `x-lore-copy` header) |
| `world_cache` | Cached open-data answers | places, weather, Kp, place search, town at a point (two decimals); stale data is used when a service is down |

Integrity is enforced in the database too: enums, `CHECK` constraints (audiences per table, end after start,
one comment target, photo contributions need media), unique indexes, and foreign keys with explicit delete
rules. **Deletion rule** (brief part XXVIII): a person's own data cascades (sessions, friendships, their
contributions, their media); shared records others rely on (crews, events, ideas, chapters) survive with
their creator set to null.

Places (the Lore Map, D35) are columns on the chapter, plan or idea they describe; a shared places table can
come later. `0010_places.sql` also sets the points plans already had (never shown to anyone before) to Only me.
Built for later connections without speculative tables: traditions, achievements,
quotes as their own archive, and capsules each become a table that references the existing `events`,
`chapters` and `users` rows. Nothing has to be duplicated.

## 4. Authentication

- **Accounts**: username + email + password. Passwords are hashed with **scrypt** (N=2¹⁷, r=8, p=1;
  memory-hard, built into Node, no native add-on to compile). The hash records its parameters, so the cost
  can be raised later and old hashes upgrade on the next sign-in.
- **Sessions**: a random 256-bit token. Browsers receive it in an `HttpOnly; Secure; SameSite=Lax`
  cookie; native apps send `X-Lore-Client: native` at sign-in to receive it in the body and then use
  `Authorization: Bearer`. The server stores only its SHA-256, so a database leak doesn't leak sessions.
  Sessions slide forward while in use (default 60 days) and sign-out deletes them server-side.
- **CSRF**: cookie-authenticated writes must come from an allowed origin (`WEB_ORIGINS` or same origin);
  `SameSite=Lax` adds a second layer. Bearer requests are exempt because other sites can't attach them.
- **Abuse**: sign-in and registration are rate-limited per IP; failed sign-ins for unknown accounts burn
  the same hashing time, and wrong-password and unknown-user errors are identical.
- **Native apps**: the Android app runs at origin `https://localhost`. The API answers CORS for the
  configured app origins (`NATIVE_ORIGINS`), never with credentials; the app authenticates with its
  bearer token. Photos are loaded through signed links that expire within two hours (see DECISIONS D20).
- **Leaving**: `DELETE /api/me` (password required) deletes the account; shared contributions stay,
  anonymised; `GET /api/me/export` returns everything the person added, as JSON (DECISIONS D18).
- **Later**: email verification and password reset need an email provider. "Sign in with Cardboard" (OIDC
  with PKCE) is planned for the end of the roadmap and will add a `user_identities` table linking external
  subjects to accounts.

## 5. Privacy and permissions model

Private by default, enforced on the server. `lib/access.ts` holds the visibility predicates as SQL, and
every list and every single-item load uses them, so the UI never decides who sees what.

**Who can see it (audiences)**

| Content | Options (default first) | Who that means |
|---|---|---|
| Event | `participants` (default without a crew), `crew` (default with a crew), `friends` | Participants = everyone invited, whatever they answered. Crew = active members. Friends = the creator's friends. |
| Idea | `only_me` (default), `crew` (default in a crew), `friends` | |
| Chapter | `participants` (default), `crew`, `only_me` | `only_me` is a private journal entry, hidden even from people listed in it. |
| Personal calendar entry | owner only | Never part of any shared query. |
| Photo | follows what it was uploaded to | Every file request re-checks access; there are no public file URLs. |

**What you can do (roles)**

| Action | Allowed for |
|---|---|
| Edit event, change status, invite, manage participants | event organizers (an event always keeps at least one) |
| RSVP | anyone who can see the event; joining a friends/crew event adds you as a participant |
| Packing list | anyone taking part; removing items: its creator or an organizer |
| Edit or delete idea, make it happen | creator, or an admin of its crew |
| Edit chapter, add people, set cover | chapter organizers (creator + event organizers when drafted from an event) |
| Contribute to a chapter | the people in it |
| Edit a contribution | its author only. Delete: author or chapter organizer (moderation) |
| Delete a chapter | its creator, and only while nobody else has contributed |
| Invite to crew | owner/admin, or any member if `members_can_invite` |
| Change crew roles | owner. Remove members: owner/admin (admins can't remove admins) |
| Invite anyone to anything, add people to a chapter | only people you can reach: friends or people you share a crew with, never across a block |

Hidden things return **404, not 403**, so their existence isn't revealed. Blocking removes friendships,
hides each person from the other's search and profile, and stops requests and invitations.

**Places** (D35) ride on the item's visibility and add one more filter: who gets the point. Exact: whoever
sees the item. About here: the author exactly, everyone else a point rounded on the server (about 5 km).
Only me: the author alone. Nobody else gets any point while the author's "Show my places on maps" is off, or
across a block. A point is never copied into an item someone else owns. A plan's or chapter's place name is its
"Where" and shows to whoever sees the item; an idea's goes only with its point. `placeFor` in `lib/access.ts` is the only way coordinates leave the server. The map never uses
the device's location; where you stand is shown only to you.

Photos are resized on the device before upload, which also strips EXIF metadata such as GPS location.
The server identifies file types from their bytes, not from what the client claims.

Where the Lorer stands (D32) is asked for once, after sign-up, and only with their yes: the device's point is
rounded to two decimals (about a kilometre) before it leaves the phone, the server rounds again before asking
Nominatim, and it is stored only as the private home in `oracle_settings`. Android declares
`ACCESS_COARSE_LOCATION`, and `ACCESS_FINE_LOCATION` only up to API 30 (`maxSdkVersion`): Capacitor's WebView
asks for both and accepts a coarse-only answer only on Android 12+, so without fine, "Allow" ends as denied on
Android 7 to 11, which have no approximate choice. iOS has `NSLocationWhenInUseUsageDescription` and
`NSLocationDefaultAccuracyReduced` (the prompt defaults to Approximate). All of it takes effect in the next
native build (not verified on a device). On the phone's back button, a page with no history behind it (such
as "Where do you stand?" right after sign-up, which replaced Welcome) leaves the app.

## 6. Navigation

Five primary destinations (brief part II), as a bottom tab bar on phones and a side rail on wide screens:

| Tab | Screen | Contextual routes from here |
|---|---|---|
| Home | `/`: the Loracle door (today's sign near where you stand, or "Where do you stand?"), needs your answer, coming up, still being planned, write it down, crews, ideas worth doing, on this day, recent lore. Finite, and ends with "That's everything." | events, ideas, chapters, crews, Idea Vault, `/oracle`, `/welcome/where` |
| Calendar | `/calendar`: month and agenda views; LORE and personal layers | new event on a day, personal entries |
| Create | `/create`: plan something, save an idea, write a chapter, start a crew | forms |
| Lorebook | `/lorebook`: timeline by year, crew and year filters, search; Book \| Map switch to `/lorebook/map` (the Lore Map: Mine, Crew, Memories, Adventures) | chapters, plans, ideas, quests |
| Profile | `/profile`: picture, bio, friends, crews, my lore, settings (Your world: any world, or Auto by night and by day) | `/friends`, `/u/:username` |

Outside the tabs: `/welcome` (sign in, create account) and `/welcome/where` ("Where do you stand?", the step a
new account takes before Home: device location, recommended and rounded to about a kilometre, or a town by
name, or Later). The notifications bell sits in the top bar everywhere. Crews (`/crews/:id`) are workspaces holding the crew
calendar, Idea Vault and Lorebook, reached from Home, Profile and anything tagged with the crew. Only
built features are shown; nothing in the UI points at future phases.

## 7. Development environment

See the README for commands. Constraints specific to this machine are in `CLAUDE.md`:

- Everything lives on **D:** (C: is nearly full). Dot-source `tools/env.ps1` (PowerShell) or source
  `tools/env.sh` (Git Bash) first to redirect temp and cache folders to `D:\LORE-devenv`.
- D: is **exFAT**, which has no symlinks, so there are no npm workspaces: one root `package.json`, one
  `node_modules`, and shared code is imported as `#shared` (a Node subpath import).
- exFAT can't store file dates before 1980; `db/index.ts` works around PGlite stamping 1970 dates.
- Tests run PGlite on V8's baseline compiler (`--liftoff-only --no-turbofan`), one file at a time,
  because optimising its WebAssembly needs more memory than this machine has free.

## 8. Folder structure

```
LORE APP/
├─ package.json            scripts, all dependencies, "#shared" import alias
├─ tsconfig.base.json      strict TypeScript settings shared by every part
├─ Dockerfile, docker-compose.yml, .env.example
├─ capacitor.config.json   Android app settings (app id, web build location)
├─ CLAUDE.md               working rules for this repo
├─ deploy/oracle/          free hosting: compose (Caddy + app + Postgres + backups), setup script, guide
├─ docs/                   MASTER_BRIEF, ARCHITECTURE, DECISIONS, ROADMAP, DEVELOPMENT_LOG
├─ tools/                  env.ps1 / env.sh, dev.mjs (runs API + web), android.mjs (builds the app), make-icons.mjs, loracle-eval.mjs (live eval; costs money, owner only), copy-check.mjs (live edits a change would orphan)
├─ apps/android/           Capacitor Android project (generated, plus icons, splash and signing setup)
├─ packages/shared/src/    vocabulary.ts (enums + labels), inputs.ts (Zod schemas), types.ts (DTOs), copy.ts (live text: keys, messages, checks, copy(); also `#shared/copy`)
├─ apps/api/
│  ├─ src/
│  │  ├─ server.ts         entry point: config → database → migrate → listen
│  │  ├─ app.ts            Fastify setup, auth hook, CSRF guard, error handler, static web app
│  │  ├─ config.ts         environment parsing
│  │  ├─ context.ts        AppContext, requireUser
│  │  ├─ auth/             password.ts (scrypt), sessions.ts
│  │  ├─ db/               schema.ts, index.ts (Postgres or PGlite), migrate-cli.ts
│  │  ├─ lib/              access.ts (privacy, the owner), queries.ts (read models), notify.ts, storage.ts, images.ts, world.ts, oracle.ts, copy.ts (live text), …
│  │  │  └─ loracle/       the Loracle's mind and jobs: types, client, mind, prompts, schema, ledger, checks, draw, cost, fake, jobs
│  │  ├─ routes/           auth, users, friends, crews, events, personal, ideas, chapters, media, comments, notifications, home, oracle, loracle, copy
│  │  └─ seed.ts           demo data through the HTTP API
│  ├─ drizzle/             generated SQL migrations
│  └─ test/                auth, privacy and full-lifecycle tests (Vitest, in-memory Postgres)
└─ apps/web/
   ├─ index.html, vite.config.ts (PWA manifest and service worker; the copy plugin; the editor chunk kept out of the precache)
   ├─ vite/                live text's build side: copyPlugin.ts, collect.ts, jsxText.ts, copyNames.ts, tests (`npm run test:copy`)
   ├─ public/              favicon and app icons
   └─ src/
      ├─ main.tsx, router.tsx
      ├─ lib/              api.ts, queries.ts (data hooks), dates.ts, images.ts, theme.ts (the look, worlds, day and night, the sun)
      │  └─ copy/          live text runtime: runtime.ts, sync.ts, cache.ts, gate.tsx (owner + switch), guard.tsx (crash guard)
      ├─ components/       AppShell, World (keeps the world in step; renders nothing), ui, cards, pickers, CommentThread, compass (CompassRose)
      │  └─ copyEditor/    the owner's editor (own chunk): quill, outlines, edit sheet, publish bar, Edited texts, Copy for Claude
      ├─ assets/worlds/    the world art (SVG, minified from the approved export)
      ├─ pages/            one file per screen (WhereYouStand: the location step after sign-up)
      └─ styles/
         ├─ app.css        base tokens, the retired looks (Paper, Campfire, Match device, Crazy; kept, D32),
         │                 the components and the Loracle's stone and scrolls
         ├─ map.css        the Treasure Map (retired, D34; kept). Guarded rules match nothing; the compass
         │                 rose, trail, Welcome and Home door pieces are still shared
         ├─ worlds.css     the worlds' art, the one fixed backdrop, Profile → Your world (D34)
         ├─ lore.css       the one base: the Loracle's kit on every screen, world tokens, day ink (D34; last)
         └─ sign.css       Home's daily sign on the Loracle door, and "Where do you stand?"
```
