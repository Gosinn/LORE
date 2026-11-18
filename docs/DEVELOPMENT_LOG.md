# LORE — Development log

## 2026-11-18 (late) — One base, the Loracle's kit, over worlds by night and by day (D34)

The owner, on the bright Treasure Map: "when I click Loracle ,my head is sent back like "whoah"", "the buttons
look different", "there has to be a level of consistency in the whole thing. the base", then "let's give the
users some variety" and a day mode ("green lush hills ... and SUN that has the same look as in the gnostic
texts"). He picked from three rounds of candidates (`D:\LORE-devenv\previews\index.html`, outside the repo):
black star sky as the default, stone cards by day too, and the four "When" choices. Built in two parallel
tracks (the kit; the worlds and day and night), then joined and checked together.

**What changed**

- `styles/lore.css` (new, loaded last): the Loracle's kit on every screen outside it (buttons, wells, chips,
  stamps, slabs, sheets, toasts, empty/loading/error states, the tab bar and rail as in the temple, Admin, Legal,
  Welcome, "Where do you stand?"), the world tokens (`--world-bg`, `--world-top`, `--slab`), text on the world
  (shadow plus a 2px halo), day ink on a vellum plate, and the vellum-card hook (not offered). Every rule is
  guarded off while the Loracle is open. Long texts and people lists on Event, Idea, Crew and Chapter pages
  sit on a slab (class names only). The live text editor (`copyEditor.css`) wears the kit too.
- `styles/worlds.css` (new) and `assets/worlds/*.svg` (five SVGs, minified: off-screen stars dropped,
  coordinates to 0.1): each world's art, the one fixed backdrop (`<div class="world">` in index.html), Profile
  → Your world. The night map, midnight vellum and scroll use the exported layer lists as they were meant (the
  night map's 56px grid shows; the noise tiles at their own size), so they differ slightly from the preview.
- `lib/theme.ts`: one look `lore` (`map` retired), seven night worlds, the green hills by day, the four "When"
  choices, the sun's turns on the device; `components/World.tsx` keeps it current; `index.html`'s boot script
  applies it before the first paint. Welcome and "Where do you stand?" stay on the black star sky by night.
- The browser bar follows the world's top edge (AppShell reads `--world-top`); manifest `#030409`; Capacitor
  splash `#030409` and notification colour `#FFB36B`; the Android and iOS splash PNGs redrawn on the dark base
  (`tools/make-icons.mjs`; the app icons came out byte-identical).
- Retired, kept: `map.css` (guarded rules match nothing now), the old Appearance chips in Profile (shown only if
  a look comes back). The Campfire dark-mode block no longer outranks the new tokens (`app.css`).
- The Loracle: no Loracle file and no temple CSS touched (`git diff` clean for `pages/Oracle.tsx`,
  `components/oracle.tsx`, `components/loracle.tsx` and app.css's ORACLE sections). Two things pinned to how
  they were: the page's root colour scheme while the Loracle is open (the desktop scrollbar stays light) and
  the glow outline on a broken text there in the owner's edit mode.

**Checked**

- `npm run typecheck` passes; `vite build` passes (all five world SVGs in the service-worker precache).
- `npm test`: web 186/186 (`theme.test.ts`: sun times against the almanac for Reykjavík and London, midnight
  sun and polar night, the choices, the boot script in a sandbox, the stylesheets' world colours against
  theme.ts); API 275/276. The one failure, `oracle.test.ts` "goes as far as the realm reaches", is about the
  wall clock, not this work: no API file changed, and it passes with the clock moved six hours back.
- Live text: the web keys before (515f3f4) and after: 0 removed, 19 added (the new words in Profile → Your world
  and the world and "When" names). No visible words changed; capitals come from CSS.
- Stone audit: the wall, masonry, rune, crack and moss textures are used only in app.css's ORACLE section (and
  its retired, unused Home teaser). No map-look paper, wax, leather or bookmark styles match while
  `data-theme="lore"`.
- Contrast computed with the WCAG formula (textured backgrounds at the grain's mean opacity), not measured:
  text on slabs 7.1–12.6:1; main letters 5.26:1 inside their glow; text on the world with the halo 5.75–14.2:1
  at the letter's edge; the one miss is 1px outside the letter over the mountain range's moon (2.46:1), which
  sits under the bell on phones.

**Not verified** (nothing of this has been looked at in a browser or on a phone): the before/after check that
the Loracle is unchanged, every screen at 320–375 px, the desktop rail and wide layouts (the portrait art is
cropped to its middle band there), how long the SVG filters take to draw on a mid-range phone, whether the
Android WebView reports the phone's dark mode, and the native splash (needs a new native build).

**Open for the owner** (DECISIONS Q10): Cinzel on the rail (one Loracle rule), the Loracle's scrollbar, a faint
rim on wells for 3:1, the front door by day, vellum cards by day, a day twin per world.

### Review fixes (same night)

A review of the joined work found these; each was checked against the code first.

- **Body text was still the UI sans** outside the Loracle: lore.css's IM Fell rule sat inside `:where()` and
  app.css's plain `body` rule beat it. Now a real-specificity rule (the rail and tab bar keep their own sans).
- **Unread notifications** lost their slab (app.css's `.notification.unread` wash outranked it): the slab face
  is set again, the ember edge kept, the hover tint too.
- **Phones, 320–390 px**: Calendar's Month/Agenda switch and its two chips no longer push the page sideways
  (they wrap); Your world's "When" chips wrap their words instead of being cut off inside the chip row.
- **Bright worlds by night**: on the northern lights, mountain range, treasure map and scroll the halo alone fell
  short of AA (raw contrast down to about 1.1:1 on the aurora, the snow and the moon), so the blocks the day puts
  on a vellum plate sit on a dark feathered plate there; the black star sky's "more" links take the paler glow.
- **Focus by day**: the top bar's ring is the glow (ink was 1.5:1 on the deep blue); a whole slab you press
  (cards, the Loracle door, notifications) draws an ink ring on a vellum band; the note to self shows a ring
  again (a day rule had removed it). Profile's "Say where you stand" is a visible link.
- **Leftovers of another dress**: a chapter's story and quote fields type in IM Fell, as they are read (a
  lore-only token, so retired looks keep Fraunces); a finished event's "Read the chapter" card is a slab (its
  gold face stays for the retired looks, through two variables). The desktop rail's avatar keeps the temple's
  own colours and lettering, so nothing on the rail changes stepping into the Loracle.
- **Two tabs following the sun** answered each other's storage events forever (every tab rewrote the sun cache
  with turns that shifted with the millisecond). Now no tab reacts to that cache, turns are on whole minutes,
  and the cache is written only when it changes. It holds a week of turns (was three days), and near the polar
  night the last half for 48 h past the last turn.
- **Signing out** left the old Lorer's home point on the device: World.tsx read `useMe()`, which `qc.clear()`
  never tells. It now reads the query cache, as the copy gate does.
- **Signed-out starts** (every new install opens on `/`) painted the day world on a light phone while waiting for
  `/auth/me`, then jumped to Welcome's night sky. A `lore.in` hint (kept by World.tsx, read by the boot script)
  pins any start with no one signed in to the front door's world.
- **The live text editor by day**: outlines, the live underline and a draft's tint on text over the bright sky are
  ink again (a draft's tint was hidden by the day plate); its text field shows a pale red edge again when the
  words have a problem.
- **The black star sky's two SVG filters** are bounded to the screen (about 45% and 66% fewer pixels to draw;
  nothing visible changes). The grain layers of the other worlds are left as approved until timed on a phone
  (ROADMAP).
- Not changed: the wells' faint rim (still the owner's call, Q10: the Loracle's own wells have the same rim).
- `apps/api/test/oracle.test.ts` "goes as far as the realm reaches": pinned to a fixed morning (fake `Date`), test
  only. Which three futures are dealt depends on the hour; at 17:16 UTC on 18 November tonight's skies outranked every
  journey in all 24 deals. The engine is unchanged.

Checked: typecheck passes; `npm test` passes, API 276/276 and web 192/192 (`theme.test.ts` adds the week of
turns on whole minutes, the cache not rewritten, the polar edge, the signed-in hint, the storage events with a
stand-in page, and the boot script's front door for signed-out starts); `vite build` passes (main CSS 190.13 kB,
34.97 kB gzip; editor CSS 25.51 kB, 5.81 kB gzip). Live text: `copy:check` 0 keys gone, the same 19 new, issues
unchanged at 11. **Not verified:** none of it in a browser or on a phone (contrast is computed, not measured).

### Checked against the spec, section by section (same night)

- **Sizes the spec asks for** (against the build at 515f3f4, `lt-critic-build.log`): main CSS 131.65 → 190.13 kB
  (26.27 → 34.97 kB gzip, +8.7 kB gzip); the live text editor's CSS 14.47 → 25.51 kB (3.83 → 5.81 kB gzip, its
  own chunk, owner only). The world art, each fetched once and precached (77 entries): black star sky 43.2 kB
  (8.0 kB gzip), green hills 53.7 kB (8.9), mountain range 29.9 kB (7.7), northern lights 13.1 kB (2.8), treasure
  map 12.6 kB (2.0); night map, midnight vellum and scroll are CSS layers inside the main CSS.
- **The native web view's own background** is the dark base too (`backgroundColor: "#030409"` in
  `capacitor.config.json`), so nothing light shows before the first paint; with the next native build.
- **Q10** gains the Welcome reminder scroll (the Loracle's own parchment, left as it is).
- Typecheck, `npm test` (API 276/276, web 192/192) and `vite build` pass again (`w-critic-*.log`); `copy:check`
  0 keys gone, 19 new. **Not verified:** still nothing in a browser or on a phone.

## 2026-11-18 (night) — Live text: the owner changes LORE's words in the app and publishes them (D33)

The owner: "I want the ability to change all text myself manually and then a button to commit in real time.
instead of writing to you every time..". Built from a reviewed spec in three parallel tracks (API and shared;
the build transform and coverage; the runtime and the editor), then joined and checked together. His answers
to the spec's questions: `gosinn` is his live username (so he is the owner by default, with a cut-off of
2026-11-19T00:00Z); Terms and Privacy are editable but flagged; the same words in other files are offered
("Change those too"); "next tap / app to the front" is fast enough; publishing stays one tap.

**How the owner uses it:** Profile → Help → **Edit text** → the quill (bottom right) → tap any words → type →
**Keep** → **Publish** (bar) → **Publish** (sheet). Details in README "Change LORE's words yourself".

**What was built**

- **Shared** (`packages/shared/src/copy.ts`, also `#shared/copy`): keys (`<scope>#<FNV-1a>`), the message
  syntax (`{placeholders}`, `em strong b i u small mark br`), `checkOverride`, edit markers and
  `stripMarkers`, `copy()` with a resolver the server installs. Types in `types.ts`, inputs in `inputs.ts`
  (an `original` must hash to its key), `Me.canEditCopy`.
- **API** (`routes/copy.ts`, `lib/copy.ts`, migration `0009_live_text`: `copy_overrides`, `copy_revisions`
  with `kind` publish/undo/follow and `undo_of`, `copy_state`): public `GET /api/copy?v=` from memory;
  owner-only admin state, per-text history, publish (one transaction and revision, optimistic `baseVersion`,
  409 when stale, 20 an hour) and undo; `x-lore-copy` on every `/api/*` response, exposed to the native
  origins; `COPY_OVERRIDES=off`; in production every key must be in the served `copy-catalog.json`;
  `followMoved()` at boot re-attaches words whose text moved file. One owner rule in `lib/access.ts`
  (`isOwner`/`requireOwner`, used by moderation, `loadMe` and live text; start-up log line). Error messages
  and fields go out through `liveCopy.say()`; the 11 notification titles are `copy()` templates.
- **Build transform** (`apps/web/vite/`): rewrites the words in 40 web files and `vocabulary.ts`, injects
  `__useCopy()` into 137 components and the copy tick into 8 `useMemo`s, scans `apps/api` (and
  `inputs.ts`) for static messages, emits `copy-catalog.json`. Coverage test: every web word reached, no
  unclassified prop names, crisis data never editable. Five word-based React keys became ids or indexes.
- **Runtime and editor** (`apps/web/src/lib/copy/`, `components/copyEditor/`): cached words before the
  first render, refetch on a new version header or when the app comes to the front, drafts only for the
  owner with his switch on, crash guard (root boundary and each top-level route's `errorElement`); the
  quill, outlines, capture-phase taps, the edit sheet with live preview, placeholders and "Change those
  too", the publish bar and sheet (legal tick), Edited texts (unpublished, published with earlier versions,
  orphans, history with undo, find, on this screen, recently shown) and **Copy for Claude**.
- `npm run copy:check` (`tools/copy-check.mjs`): live edits a code change would orphan.

**Fixed while joining the tracks**

- The fixed replies in `app.ts` (`say('Not found.')`, "That file is too large." and two more) were missing
  from the catalog, so they couldn't be published in production: the server scan now reads `say('…')`.
- The stone's signs (`signLine`, written into new roads by the server) were not editable: they are `copy()`
  templates now (`srv#` keys; `vocabulary.ts` imports `./copy.ts`, and the scan accepts that inside
  `packages/shared`).
- The server already sends static messages in the published words, so the web `serverCopy()` couldn't tell
  which text they were: it now also looks them up by published words, so edit mode marks the right key and
  the owner's drafts (including "back to the original") show on server messages. The editor only trusts the
  device's default for a key when it hashes to that key (else the catalog's), so a draft's `original` always
  matches its key.
- `magic-string` is now an explicit devDependency; a comment in `app.ts` had slid above the wrong block; the
  deploy guides now name the switch as it reads ("Edit text").

**Review fixes (same night: all 22 findings confirmed and fixed, two differently than proposed)**

- *Hidden characters:* `COPY_FORBIDDEN` (now written with escapes) also refuses `U+061C`, LRM/RLM,
  `U+2028–2029`, all of `U+2060–206F`, `U+FFF9–FFFB`, tag characters and the variation-selector supplement,
  so a publish can't hide an instruction in `wishStart` (and so in every wish sent to the Loracle). The
  context is checked too and the server prefers the catalog's. "Copy for Claude" and `copy:check` write such
  characters as `\u` escapes (`visibleJson`).
- *Kill switch:* `COPY_OVERRIDES` is read leniently and fails safe; `OFF`, ` off`, `false`, `0` no longer stop
  the boot.
- *Sign-out:* the gate read `useMe()`, whose observer `qc.clear()` strands, so after signing out the quill
  and the owner's drafts stayed for whoever signed in next in that tab. It now reads ['me'] from the query
  cache and keys the editor by owner (`gate.test.ts`).
- *Baked words followed elsewhere:* after "Copy for Claude", `followMoved()` copied the owner's words onto
  another file's identical default (AppShell "Profile" → "Me" turned the Profile page title into "Me"). Baked
  rows are skipped now; "Copy for Claude" no longer re-sends baked or followed orphans.
- *Crash guard:* a lazy page that fails to load after a deploy (stale chunk) is not a live-text crash any more;
  it reloads once (at most once a minute). After a real crash, a publish or undo that met a 409 kept
  failing (the crashed session never took the new version): the editor now fetches and applies explicitly
  (`catchUpCopy`), and a crashed session stops fetching words it won't show.
- *Words that never changed anything:* the 40 Loracle example wishes now come from the editable table on the
  device (the server's list ignored edits); the catalog drops keys no chunk ships (`INTEREST_LABELS`,
  `ORACLE_MODE_LABELS`); `inkedLine` no longer edits a template in code (`MORE.inked`); "source"/"sources"
  in the mark note are editable, and the coverage test now catches such ternaries.
- *Build:* a half-edited file no longer stops `npm run dev` (syntax errors are Vite's to show, with a code
  frame; the coverage test reports the real line). An empty inline tag (the Calendar swatch `<i />`) stays
  outside the message, so rewording can't delete it.
- *Ids:* `ApiError` no longer rewords or marks ids in error fields (`chapterId` on a 409 broke the link in
  edit mode).
- *Editor:* places read as plain words ("Event form › field name", code names as a tooltip); a refused
  change is named in the publish sheet with **Leave it out**; the phone sheet stays above the keyboard and
  scrolls; the Editing pill sits below the top bar (no hint text on phones); the bar and toast step aside
  while an app sheet is open (the quill moves up); pages get the bar's height at the bottom; outlines glow
  on the leather tab bar and rail; tapping words in pinned chrome no longer scrolls the page; the quill's
  label no longer flips with its pressed state.

**Numbers**

- Catalog: 1,142 texts (744 web, 264 vocabulary, 134 server); 294 may hold inline tags, 51 have
  placeholders, 81 legal or consent, 4 plain (never marked). 174 kB (36 kB gzip), not precached; fetched only
  by the editor and the server. After the review fixes: 1,130 (747 web, 248 vocabulary, 135 server; the 16
  unshipped table texts gone), every non-server key present in the built JS, 81 legal or consent.
- Size against `HEAD` (12ede92): JS loaded at start 513 → 546 kB raw, 160.8 → 171.2 kB gzip (+10.3 kB, runtime
  included); all JS except the editor +17.3 kB gzip. The editor chunk (`copy-editor-*`, 39 kB JS + 13 kB CSS,
  15.5 kB gzip) is absent from `sw.js`'s precache list (72 entries, none of them copy files).
- Tests: `npm test` passes 274 API tests in 17 files (live text: 24 in `copy.test.ts`, 16 in
  `copyShared.test.ts`, 5 in `config.test.ts`), then `npm run test:copy` passes 154 in 6 files (transform,
  render equality, coverage, runtime, sync, Copy for Claude). `npm run typecheck` and `npm run build` pass.
- After the review fixes: `npm test` passes 276 API tests in 17 files, then 165 web tests in 8 files (new:
  `gate.test.ts`, `where.test.ts`); typecheck and build pass. Start JS +0.4 kB gzip against the integration
  build; the editor chunk 17.7 kB gzip (was 16.0). Logs: `D:\LORE-devenv\lt-fix-test.log`, `lt-fix-build.log`.
  Not seen in a browser or on a phone: the CSS changes (pill, sheet above the keyboard, bar beside app
  sheets, bottom padding, glow on leather) and the publish sheet's refused-change box are unverified.

**Checked by hand** (local server in production mode, PGlite, fake Loracle, port 4100, built web app):
`GET /api/copy` signed out (`x-lore-copy: 0`, `no-cache`); `gosinn` created today is the owner
(`canEditCopy`), another account gets 404 and signed-out 401; a publish of a tab label and "Not found."
moved every response's header to the new version; `?v=` current answered `unchanged`; the 404 body spoke the
new words; an unknown key was refused (`copy_unknown_key`), `<em>` on a label refused, a stale base 409, a
cross-site cookie PUT 403; undo restored the defaults and wrote history; a restart kept the words and logged
"Owner: gosinn (default; set ADMIN_USERNAMES to change)".

**Not verified:** nothing of this has been looked at in a browser or on a phone yet (the quill, outlines,
tapping inside links and buttons, the sheet above the keyboard, live preview, publishing from the UI, another
device picking the words up, TalkBack/VoiceOver). Not deployed: the live server has none of it, so
`npm run copy:check` has not read real live edits. Left for the owner: the spec's proposed CLAUDE.md line
("Visible words may carry live edits (Live text). Before changing UI text run `npm run copy:check`.").

**Completeness check against the spec (same night).** Every section of the spec walked against the code and
its tests. Fixed: the render-equality tests ran the transformed fixture against a stand-in runtime; they now
run it against the app's own `lib/copy/runtime.ts` (the stand-in is gone), and the fixture gained the
`confirm()` case the spec lists. The edit-marker characters in `copy.ts`, `runtime.ts` and `scanner.ts` were
literal invisible characters in the source; they are `\u` escapes now (an editor or a re-encode could have
dropped them silently). The edit sheet shows what fills each placeholder as text (phones have no hover).
`deploy/oracle/README.md` says how to name the owner and switch live text off there. Deliberately not as
the spec wrote: the gate doesn't follow routes (`router.subscribe`): the scanner's MutationObserver already
sees new screens; `touchstart` is listened to passively so the page still scrolls under the quill (taps are
stopped at `pointerdown`/`mousedown`/`click`). `npm test`: 276 API tests in 17 files, then 166 web tests in 8
files; typecheck and build pass (logs `D:\LORE-devenv\lt-critic-*.log`). Still not seen in a browser.

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
