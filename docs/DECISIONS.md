# LORE — Decisions

Decisions already taken (with the reason), then the questions that are the product owner's to answer.
Newest first within each list.

## Taken

**D35 · The Lore Map: places with a chosen precision, on OpenFreeMap, and never tracking.** The roadmap's
"Lore Map ⬜ next" (MASTER_BRIEF PART XVI, "accessible through the Lorebook"; Phase 3 "exact/approximate/hidden
locations"); the owner: "the journey must go on". Built 2026-11-19 in three parallel tracks (API, map page,
pickers), then joined.
- **A place is three columns on the item, not a places table.** Chapters, plans (events) and ideas each get
  `lat`, `lon` and `place_precision` (ideas also `location_name`; the place's name is the item's
  `locationName`); `users.show_places`. One migration (`0010_places.sql`), checks that lat and lon are set
  together. A shared places table (one "Grótta lighthouse" for many chapters) can come later without losing
  anything; for now a place belongs to what it describes and is deleted with it.
- **Precision, per item, decided on the server** (`lib/access.ts` `placeFor`, and `placeShown` for the map's
  SQL, the same rule): `exact` (everyone who can see the item gets the point), `approximate` (the author gets
  the point; everyone else gets it rounded on the server to 0.05° of latitude and an equal-length longitude
  step, about 5 km, drawn as a circle about 8 km across so it holds every spot that rounds to its centre; the
  exact digits never leave the server for them, in no route, map or export), `only_me` (only the author gets
  coordinates). Defaults: chapters and ideas About here, plans Exact
  (a meeting point is meant to be found). "Author" means whoever created the item: a co-organiser who edits
  it gets the shared view, so the picker sends `place` only when it was changed, and only a newly picked
  place can change an About here point someone else set. The picker's words for such an editor name the
  author ("Only whoever made this sees the spot"), and Only me isn't offered to them.
- **A place's name**: a plan's or chapter's is its existing "Where" text, which everyone who sees the item
  reads whatever the precision (said so in the picker and the Privacy policy). An idea's (new with places, set
  only with a point) goes only where its point or circle goes: a hamlet's name can say more than the circle.
- **"Show my places on maps"** (default on; on the map page): off, nobody else gets the coordinates of
  anything you created, anywhere; your own map still shows them. Blocked people never get each other's points,
  either way. A place is only ever on the map of someone who can already open the item (the same visibility
  predicates; no new path).
- **A point travels with what an item becomes only with its author** (idea → plan, plan → chapter, by the
  same person; a saved future or a vault waypoint → idea), never more widely shared than before or than the new
  item's default. Made by someone else, the new item gets the name but no point: who gets a point is decided by
  the item's `created_by`, so a copy owned by another would slip past the author's blocks, their switch and the
  first item's audience (found in review: a crew plan's point reached someone its author had blocked).
- **No distance from home beside a point.** The Oracle's stories and signs say how far a place is from home
  ("45 km away", "about 3 h each way"); a plan or idea made from one carries the place's point, and a distance
  beside a point draws a ring around where the Lorer lives (two or three find it). Those sentences and signs
  stay on the reading only (`lib/oracle.ts` `withoutDistance`). Plans made before places existed keep their
  text, and their points (never shown to anyone before) start as Only me (`0010_places.sql`); the organiser
  can share them.
- **A plan's point moving notifies** its people only when what they get of it changed (an Only me point, an
  About here one moving inside its circle, or any point while its author's switch is off, moves silently). No other notification is new (no engagement
  notifications).
- **Account deletion** keeps no point only that person could have: Only me points are cleared, About here ones
  are stored rounded, exact ones stay with the shared item; with the switch off, or any block either way (blocks
  go with the account, and a former member's point reaches everyone who sees the item), every point is cleared.
  Names stay, like the rest of the shared record.
- **The map** (`/lorebook/map`, the Lorebook's Book | Map switch): modes Mine, Crew, Memories, Adventures;
  at most 400 pins, nearest in time first, with "N more aren't shown" (no infinite lists). Memories are
  chapters and plans that are over (an all-day plan lasts to the end of its last day) or marked done.
  Places at one spot (the same town picked twice, About here places rounded to one node) are one circle, and
  a tap lists them all; a cluster that never parts lists its places instead of zooming in on a pile. Loracle waypoints
  reach only the wish's owner; where you stand only you. The map never uses the device's location.
- **OpenFreeMap tiles** (`https://tiles.openfreemap.org/planet`, OpenMapTiles schema; at first glyphs from the
  same host, now LORE's own, below): free, no key, no sign-up, commercial use allowed, attribution only (checked 2026-11-19 by reading
  their site; the URLs answered 200). The device loads tiles straight from them, so they see the viewer's IP
  address and the area viewed; said so in the Privacy policy and the App Privacy notes. Tiles are never
  cached by the service worker. MapLibre GL (BSD) draws them with LORE's own night and day styles
  (`lib/mapStyle.ts`); its 300 kB (gzip) chunk loads only with the map and isn't precached either (it needs a
  connection for the tiles anyway): offline, the map says it needs a connection and tries again when one
  is back. No Content-Security-Policy exists today; one added later needs `worker-src blob:` and the tile host.
- **The map's letters are LORE's own** (the owner, 2026-11-19: "accurate BUT also in OUR OWN STYLE. ORIGINAL").
  MapLibre draws labels from glyph files (signed distance fields, `glyphs.proto`); the app serves its own in
  `apps/web/public/map-glyphs` (24 files, 2.5 MB), made by `npm run map-glyphs` (`tools/make-map-glyphs.mjs`:
  opentype.js reads the fonts, the distance fields are computed from the outlines; same output every run) from
  the fonts the app already ships: Cinzel as `LORE-Carved-Regular` and `LORE-Carved-Bold`, IM Fell English as
  `LORE-Book-Regular` and `LORE-Book-Italic`. Ranges 0-1023, 7680-7935 and 8192-8447: Latin with every
  extension, modifier letters, combining marks, Greek, punctuation. A letter the font lacks (IM Fell is Latin-1
  only: Ł, ő, ș, Vietnamese; Cinzel has no Greek) is drawn from Noto Serif at the font's cap height, so no Latin
  name loses a letter (serif, to sit with Cinzel and IM Fell); the script downloads Noto Serif from the Noto
  project's own repository (pinned commit, SHA-256 checked) into a folder outside the repo. The stacks carry
  LORE's names, not the fonts', because IM Fell's licence reserves the name "IM FELL" and the files mix in Noto;
  all three are SIL OFL, notices in `map-glyphs/OFL.txt`. The capitals sit where MapLibre's Noto Sans capitals
  sit (MapLibre centres every font with one fixed offset), so labels stay centred on their points. A character
  outside these ranges is drawn by MapLibre itself in the browser's sans-serif (it warns once in the console).
  The glyphs aren't precached by the service worker (the browser's HTTP cache keeps them), and the Android live
  update leaves them out (`routes/appUpdates.ts`; they would add about 1.3 MB to every update, more than doubling
  it, and the map needs a connection for its tiles anyway): the native app fetches them from the server, which
  serves them with the web app and already answers the app's origin with CORS. So the style's URL template is
  `serverFile('/map-glyphs/{fontstack}/{range}.pbf')` (`lib/api.ts`: the server in the native app, this page's
  origin on the web and in development), joined as a string because `new URL()` would escape the braces. Not
  verified on a phone.
- **Not verified**: nothing of the map or the pickers has been looked at in a browser or on a phone; tiles in
  the Android and iOS web views, and iOS starting MapLibre's worker from a `blob:` URL, are untested. LORE's own
  map letters have only been decoded and laid out in tests and a test render, not seen on the map.

**D34 · One base everywhere, the Loracle's own kit; the variety is the world behind it, by night and by
day.** Replaces D32's look; D32's retire rule stands. The owner (2026-11-18, docs/OWNER_VOICE.md "The look"):
"the new base theme doesnt roll with the Loracle vibe at all. when I click Loracle ,my head is sent back like
"whoah"", "the buttons look different, and the text changes", "there has to be a level of consistency in the
whole thing. the base. which is the UI itself. shape..", and "let's give the users some variety". He reviewed
three rounds of candidates; the approved page is `D:\LORE-devenv\previews\index.html` (outside the repo).
- **The base is the Loracle's kit, on every screen** (`apps/web/src/styles/lore.css`, loaded last). What you
  press is carved stone: the main action with ember letters, Create in copper (the round `+`), the second
  choice with carve letters, quiet ones as letters only, danger with pale red letters. "You are here" (rail,
  tab, chip, the selected day) is the raised block with glow letters, never a bookmark or a red edge. What
  you type into is a well; cards, lists, sheets and forms are slabs; marks are stamps; tick-boxes are wells.
  Cinzel for what you press, labels, heads and titles; IM Fell English for names, body and quotes (the
  calendar's numbers use Cinzel's lining figures). The tab bar and rail copy the temple's own values, so
  stepping into the Loracle doesn't move a thing. Every kit rule starts with
  `:where(html[data-theme='lore'] body:not(:has(.oracle-page)))`: it never applies while the Loracle is open
  and adds no specificity. The stone *wall* (masonry, torches, header stone, rune bands, cracks, moss) stays
  in the Loracle only; stone *buttons* are the shared kit. For AA a few values differ from the preview: main
  letters `#ffdeb8` in a 0.5 glow (preview `#ffd2a1`, 0.7), danger `#ffbfb4`, second buttons in the lightest
  carve, and text on the world gets a tight 2px halo in front of the preview's shadow. The rail keeps the
  temple rail's own sans (Q10).
- **Worlds: seven by night, one by day.** Each Lorer picks in Profile → Your world (native radios, live
  thumbnails, one tap applies). Black star sky (default for everyone who hasn't picked), Night map, Midnight
  vellum, Scroll, Treasure map (a real one: islands, rhumb lines, the X), Mountain range, Northern lights; by
  day the green hills under the engraved gnostic sun. The art is the approved export as is: SVGs minified into
  `apps/web/src/assets/worlds/` (precached by the PWA and part of the live-update bundle), the three
  layer-list worlds in `styles/worlds.css`. The choice is kept on the device (`lore.world`, `lore.daylight`),
  not on the account: no database change (a migration would have collided with live text's numbering;
  ROADMAP has "sync across devices").
- **When it's day** *(replaced 2026-11-19 by Auto, see the note at the end of D34)*: Follow my phone (light/dark, the default), Follow the sun where I stand (sunrise and
  sunset worked out on the device from the Loracle's home point rounded to 0.1°; nothing asked of a server;
  without a home point the phone decides; midnight sun and polar night handled), Always night, Always day.
  Card dress by day is the owner's pick: the same dark stone slabs as at night. Light vellum slabs are ready
  (`data-cards="vellum"` in lore.css) but not offered. Text that sits on the bright sky turns to ink on a soft
  vellum plate.
- **How it's wired.** `<html data-theme="lore" data-world="<id>" data-daylight="night|day">`, set by
  `lib/theme.ts` and, before the first paint, by a small script in `index.html` (a test keeps its table and
  keys equal to theme.ts, and the stylesheets' world colours equal to theme.ts). The backdrop is one element,
  `<div class="world">` in index.html outside React: fixed, `z-index: -1`, `100lvh`, on its own layer, never
  `background-attachment: fixed`, hidden inside the Loracle so the temple wall shows. `components/World.tsx`
  (renders nothing) follows the phone's switch, the app coming to the front and the sun's turns. The browser
  bar wears the world's top edge (`--world-top`), the manifest, the native splash and the native web view's
  own background (Capacitor `backgroundColor`) the dark base `#030409`, the reminder notifications the glow `#FFB36B` (native: with the next native build, which syncs the config).
- **The front door**: Welcome and "Where do you stand?" always wear the black star sky by night, with the
  compass rose the owner likes (spec: "keep the compass rose, on the default world"). So does any start before
  someone is signed in on the device (a `lore.in` hint kept by World.tsx): a new install opens on `/` and waits
  for `/auth/me` before landing on Welcome, and must not flash the day world first. Cost: the first start after
  this change shows the night sky to an already signed-in Lorer until `/auth/me` answers, once.
- **The Treasure Map is retired, not deleted** (D32's rule): `map` joins `RETIRED_THEMES`, a stored `map` wears
  the new base, `map.css` still loads but its guarded rules match nothing; its shared pieces (compass rose,
  trail, Welcome, the Home door) stay and lore.css builds on them. The live text editor wears the kit too.
- **The Loracle is unchanged**: no Loracle file and no temple CSS was edited. Two things the guard can't
  reach are pinned by hand: the page's root colour scheme stays light while the Loracle is open (the desktop
  scrollbar), and in the owner's edit mode a broken text keeps its glow outline there.
- Contrast was computed with the WCAG formula (textured backgrounds at the grain's mean), not measured on
  screenshots. On the brightest spots of four worlds (scroll, treasure map, mountain snow and moon, aurora)
  the halo alone fell short of AA (down to about 1.1:1 raw), so at night on those four the blocks the day puts
  on a vellum plate sit on a dark feathered plate (`rgb(6 7 12 / .7)`; worst cases about 5:1). The darker
  worlds keep the preview's bare halo; on the black star sky the "more" links take the paler glow (4.9:1).
  The black star sky's two SVG filters are bounded to the screen (fewer pixels to draw, nothing visible
  changes). **Nothing of this has been looked at in a browser or on a phone yet.**
- **Note, 2026-11-19: what you pick is what you see; Auto only when you choose it.** The owner: "make the day
  night thing simpler. becuase I cant just choose the gnostic day one , i have to coose "day mode". let's make
  more light ones then, but ONLY if the user chooses auto mode , then whatever they choose, that will be.."
  - **Every world is one tap**, dark or light, in one radio group under "Dark" and "Light" (Profile → Your
    world); the world tapped is the world shown, always. **Auto** (a switch, off by default) is the only thing
    that changes the world by itself: with it on, the dark worlds pick the world "By night", the light ones
    the world "By day", and "When" is Follow my phone or Follow the sun where I stand. Always night and Always
    day are gone (a fixed world is that). Turning Auto on puts the picked world in its own half's slot;
    turning it off keeps the world on screen as the picked one, so the switch doesn't jump.
  - **`data-daylight` is the tone of the world on screen**: `day` on a light world (the day-mode text rules,
    ink on a vellum plate, apply to any light world), `night` on a dark one. `data-theme` and `data-world` are
    unchanged.
  - **One list of worlds**: `WORLDS` in `lib/theme.ts` (`id`, `label`, `tone`, `bar`; `label` because the
    live-text transform reads that key as words, so the owner can reword a world's name). Profile, the
    store and the tests read it. A world = its art, a block in `worlds.css`, a block in `lore.css` (a light one
    after the green hills' block, which also holds `[data-daylight='day']`) and one line in `WORLDS`.
  - **The first paint needs no list**: `applyLook()` leaves `lore.boot` (`{ when, night: [id, bar], day: [id,
    bar] }`) and index.html wears that, with the sun's cache as before. Only the first start after this update
    reads the old keys, with the old seven worlds frozen in index.html. A test runs the boot script against
    theme.ts for every world with Auto off and every night/day pair with Auto on, on a dark and a light phone.
  - **Defaults and the old choices.** New: the black star sky, Auto off. Kept before (no `lore.auto`): Follow
    my phone or the sun → Auto on with the same driver, the kept night world and the green hills; Always night
    → that night world; Always day → the green hills; a night world with nothing said about the day → that
    world (it wasn't a choice of Auto). Written the new way (`lore.auto`, `lore.world`, `lore.nightWorld`,
    `lore.dayWorld`, `lore.daylight` = the driver) on the next start.
  - The status bar's icons follow the world's `bar` (light icons on a dark top edge: every world today), so a
    light world with a pale sky would get dark icons. Live text: "Always night" and "Always day" leave the
    catalog; "Auto", its one line, "Dark" and "Light" are new; no existing words changed.
  - **Not verified** in a browser or on a phone.

**D33 · Live text: the owner rewords LORE in the app and publishes it.** The owner (2026-11-18): "I want the
ability to change all text myself manually and then a button to commit in real time. instead of writing to you
every time.." How, and why:
- **A build-time transform, not hand-wrapped strings.** `apps/web/vite/copyPlugin.ts` rewrites every static
  word (about 1,130 texts: 747 in web code, 248 in the vocabulary, 135 server messages) into a lookup and
  writes `copy-catalog.json`. Hand-wrapping a thousand strings, and remembering it for every new one, would not
  hold; an i18n library wants hand-written keys and a third-party editor (against "own API + Postgres");
  wrapper elements would add spans that break layouts. `copy()` stays as the escape hatch for text the
  transform can't see (lib files, `switch` returns, the server). A coverage test keeps "all text" true.
- **Keys are file + hash of the default** (`pages/Home#1a2b3c4d`). Keys by path would keep overriding a
  default that changed in code; keys by text alone would make every "Cancel" one text. A changed default
  orphans its edit (shown to the owner, never silently re-applied); the same words moved to another file
  follow by themselves after the deploy. The editor offers "Change those too" for the same words in other
  files (owner's answer: offer, don't force).
- **Invisible markers find the text you tap**, only in the owner's edit mode (`U+2063 … U+2064`, never
  `U+200B`/`U+200D`), and `api.ts` strips them from everything it sends, always.
- **`GET /api/copy` is public** (Welcome, Terms and Support are shown signed out). It holds only code words and
  the owner's words: only static server messages found in the code are keys, so no Lorer's name or title can
  end up in it. Every API response carries the version (`x-lore-copy`); clients refetch when it differs or the
  app comes to the front. No polling, no WebSocket, no timer on the server (the Neon database can sleep).
  Owner's answer: "next tap / app to the front" is fast enough.
- **The owner by default, with a cut-off.** With `ADMIN_USERNAMES` unset the owner is the account `gosinn`
  created before 2026-11-19T00:00Z (the owner confirmed `gosinn` is his live username). A `gosinn` made later
  (a fresh database, a deleted and re-taken name, a fork) is nobody. Set, `ADMIN_USERNAMES` means exactly those
  people; set but empty means nobody. Moderation and live text share the rule (`lib/access.ts`); split them
  (`COPY_EDITORS`) if other moderators arrive.
- **Publishing is one tap on the confirm sheet, no password asked again** (owner: "no waddling, time is
  precious"). Guarded instead by history and undo, 20 publishes an hour, the catalog check in production and
  the `COPY_OVERRIDES=off` kill switch.
- **Terms, Privacy and the Loracle's consent words are editable, flagged**: a banner in the editor and a
  required "I've checked these are still true" tick when publishing (owner's answer). Material changes to the
  Terms should still go through code, with re-consent.
- **Not editable**: the Loracle's prompts and checks (coupled to the safety validators and tests; a careless
  edit could weaken the care screen), crisis lines, emergency numbers and the helpline link (a typo could send
  someone in danger to a wrong number; the sentences around them are editable), what Lorers and the Loracle
  write, build and store texts, and the editor's own words.
- **Text only, never HTML.** Overrides render as React text, allowlisted string attributes, or
  `createElement` for a few inline tags.
- **No hidden characters, anywhere words travel** (review, same night). An edit may not hold anything
  invisible that could carry words of its own: controls, bidi and zero-width marks, line/paragraph
  separators, `U+2060–206F`, interlinear annotations, tag characters (`U+E0000–E007F`, invisible ASCII) or the
  variation-selector supplement. Otherwise one publish could slip a hidden instruction into every Lorer's
  wish (the editable `wishStart` prefills it) and so into the Loracle's prompts. The stored context is checked
  the same way and the server prefers the catalog's. "Copy for Claude" and `copy:check` write any such
  character as a `\u` escape, so a code session never reads hidden text. Cost: the England, Scotland and
  Wales flag emoji (built from tags) can't be used in edits.
- **The kill switch fails safe** (review). `COPY_OVERRIDES` is typed in an emergency, so it is read
  leniently: unset, empty, `on`, `true`, `1`, `yes` keep live text on; anything else (`OFF`, ` off`, `false`,
  `0`) switches it off. It never stops the server from starting.
- If the React Compiler is ever adopted, its memoized JSX would not see copy changes: feed `__copyTick()` into
  it, as the transform already does for `useMemo` deps.

**D32 · One look, the Treasure Map; the older looks are retired, not deleted.** *(The look is replaced by D34
the same day and the Treasure Map is retired too; the retire rule below still holds.)* The owner (2026-11-18):
"retire all the older themes. dont delete them, just retire them ... i might change my mind in the future but
probably not", "make the new theme more present throughout the app", "but keep the stone look for the
Loracle only". So LORE wears one look, `map` ("Treasure Map", `styles/map.css`): map paper with a faint
graticule, iron-gall ink, vermilion route-ink for what you do, verdigris for places and confirmed plans, brass
for lore and memory, wax seals; the tab bar and rail are a leather map case with brass stitching, and Create
is a brass compass. Paper, Campfire, Match device and Crazy keep their CSS and code; their names sit in
`RETIRED_THEMES` (`lib/theme.ts`), and moving a name back into `THEMES` offers it again. A stored retired
choice is left in place (it wears the map), so people get their old pick back if it returns. Stone stays
inside the Loracle: every map rule is guarded off while `.oracle-page` is in the document, and the temple
pins its radius, shadows and avatar colours, so the Loracle looks as it did. Home's stone teaser became the
torn edge of the map (`.loracle-door`: dusk and the stones as a silhouette, no stone texture; the teaser's CSS
in app.css is kept, unused). To bring an old look back, besides `THEMES`: drop `data-theme="map"` and the
paper theme-color from `index.html` (or set them from a small inline script that reads `lore.theme`), or each
start flashes the map first; the browser bar already follows the look's `--bg` (AppShell).

**The daily sign on Home, and "Where do you stand?" at sign-up** (same day, same owner request: "some little
suggestion is cool .. ofc it should be relative to the user's location.. if allowed ofc.. which should be
recommended by the app when user sets up his account"). The door carries one small future a day near where
the Lorer stands (`GET /oracle/sign`), dealt by the old Futures engine and kept as an `oracle_readings` row
with `mode = 'sign'`: it never counts toward the day's three readings, never shows in `GET /oracle`, stays
within 250 km whatever the Loracle's reach, and is answered with the existing choose / dismiss endpoints
(choosing makes a plan only the Lorer can see; its description names the place, never how far it is from
home, since the plan is shared with whoever they invite). Only moments still ahead are offered, and a passed
one can't be chosen. An unanswered sign is dealt again when the Lorer says where they stand, or once all its
moments have passed, at most three deals in their day: each deal is a full draw of the world's places and
weather. A new account goes to `/welcome/where` before Home: "Allow
location (recommended)" (rounded to two decimals, about a kilometre, before it leaves the device), or a town by
name, or Later. It saves the same home the Loracle uses. The town at a point comes from `GET /oracle/reverse`
(Nominatim reverse, town level); when none is named the home is "Near me", and the Loracle names it from its
own point later, never from a far place that happens to share the label. Android asks for coarse location
(and fine only on Android 11 and older, which have no approximate choice and where the WebView needs it), and
iOS has a "when in use" reason and asks for reduced accuracy by default; both need a new native build. Nothing of this has been looked at in a browser
or on a phone yet. Contrast figures were computed with the WCAG formula, not measured on screenshots.

**D31 · The Loracle is wish-first, and its mind is Claude.** The owner (2026-11-18): the Lorer must first
"tell the stones WHAT YOU WANT", and the Loracle is for proper quests, never day trips ("you wouldn't
consult magic stones just to go to Vök baths"). So `/oracle` is wishes only: the Lorer writes "I wish …"
and the stone draws a quest (calling, waypoints opened one at a time, whom to find, provisions, one rule,
a deed for this week). The deterministic Futures (D26) are gone from the app; their routes, tables and
`lib/oracle.ts` stay so exports keep old readings.
- **Mind:** Claude Opus 5.5 (`claude-opus-5-5`) through Anthropic's API with our own key on the server,
  for every call: adaptive thinking, an explicit effort per stage (weigh low, research medium, compose
  medium, repair medium; compose was high until the first live roads ran past the job budget, 2026-11-19), server-side fallbacks, web search and web fetch (`_20260209`) for the research,
  structured output for the weighing and the scroll. No prefill, no forced tool choice. Refusals become
  silence; `pause_turn` is continued. Code, not the model, writes the wait's signs, keeps only URLs the
  tools returned, checks the scroll (banned phrases, made-up people, unsafe roads) and asks for one repair.
- **What is sent to Anthropic:** the wish text; the realm's town line and country (never coordinates);
  how far the Lorer will travel; their callings and the fold's answers (age band, money, time, body,
  tongues, passport); today's date and time zone; an anonymous per-Lorer id (salted hash) as
  `metadata.user_id`. Never the name, username, email, plans, chapters or friends. Only after the Lorer
  agrees on the consent sheet; "Stop sending wishes" takes it back: running jobs stop, every road still
  waiting fades, and a road is only claimed while consent stands. Of the realm only the town and country
  leave the server (geocoding labels are town-level). The research notes and the model's working stay on
  the server; the export holds what the weighing read about the Lorer (tags, the wish beneath, binds,
  companion, clock) but not its search plans. Logs never hold the wish or the scroll, and a failed query is
  logged without its bound values.
- **Care before anything:** unmistakable self-harm phrases (one list, `lib/loracle/care.ts`) answer with a
  crisis line for the realm's country before the stone's sleep, consent, realm or any limit is checked and
  before any model is asked (nothing stored), and the weighing can route to care too. A reroute offer is
  sealed by the server; only a sealed offer is told to the mind as taken up, and one still weighed as harm
  is silence. LORE is 13+:
  the 13–17 age band gets teen-safe roads. People are named only when a public source shows them publicly
  teaching, guiding or hosting the thing.
- **Cost:** estimated (unverified) at ~US$0.90–2.40 a quest, typically ~US$1.40, and ~US$0.03–0.05 for a
  weighing alone. Spend is recorded per request (`loracle_spend`, no text). Bounds, all hidden and
  answered in-world (D30): about 10 roads per Lorer per rolling 24 h (every road paid for counts once,
  drawn, faded or burned) and 40 weighings (attempts, care included; "the stone rests"); one free "Try
  again" per road a day; the owner's monthly ceiling `LORACLE_MONTHLY_USD` (default 150), past which
  wishes are written down for the new moon (and still count toward the Lorer's limit), and at 1.1× which
  nothing is weighed until the new moon. Money already spent is always recorded, even when a job is cut
  off. The Console spend limit is the real backstop. Without `ANTHROPIC_API_KEY` the stone sleeps;
  everything else works.
- **Reach:** the Loracle's own `loracle_reach_km`, ANYWHERE unless the Lorer chooses less (D30); the old
  Futures' radius is never a quest's reach.
- **Fake mind for development:** `LORACLE_MIND=fake` (never on unless set) walks the same job and phases
  with canned quests and no network or cost, so the UI and the flow can be built and checked without a
  key. Tests inject their own minds.
- **Phase A only:** one road per wish, private to the Lorer. Ask deeper, Ask again, a dawn lane, batches
  and crew quests are not built. *(Built since: see the note on phases B and C below.)*
- **Note, 2026-11-19: phases B and C are built** (spec v3 §1.7, §1.9, §2.5–2.8, §3.1, §3.5–3.7; where the
  shipped phase A code differed from the spec, the code won). **Nothing of it has been seen in a browser or on
  a phone, and no real Claude call was made for it** (tests and the smoke run use stub and fake minds and a
  fake batches client). One migration, `0011_loracle_b_c.sql`.
  - **Ask again ("Two roads").** Another road for the same wish, drawn from the ledger the first road found
    (no new scouts; the whole ledger is now kept on the wish, and a phase A ledger is rebuilt from its
    dossiers and the pages its road cites, or the scouts go out again if too little survives). It counts as
    a cast toward the hidden limits. Roads sit as carved tabs ("Two roads", "First road", "Second road"…).
    There is no "keep this road" button: the road inked furthest (ties: the first) is the one the quest keeps,
    for its "3 of 6 inked", the quest log and the Epic. "Try again" retries the newest faded road, whichever
    it is, always at once.
  - **Ask the stone about this.** A deeper ask on an open (or inked) waypoint with an optional question (200
    characters): an answer, a new sign, three real steps, a keeper, words to say, one new unknown and its own
    sources, pinned to the waypoint as a small scroll. One at a time per waypoint (409 `in_progress`); a
    hidden cap of 30 a day (409 `rest`, like casts); past the owner's monthly ceiling it answers 409 `moon`
    rather than waiting for the new moon ("Ask again" too). Its findings stay with the ask
    (`wish_asks.found`), never merged into the wish's ledger, so two asks finishing together can't clash.
    `SCOUT_PROMPT` is unchanged byte for byte (phase A's cache and eval hold); the deeper role is written into
    the scout's user turn. Only the Lorer who cast the wish asks, and only they ever see asks.
  - **The dawn lane.** Past the stone's soft budget for a day (`LORACLE_CASTS_NOW` 3 casts and
    `LORACLE_DEEPER_NOW` 10 asks per Lorer per local day, or `LORACLE_DAILY_BUDGET_USD` US$10 across everyone
    per UTC day), work is written down and read before the Lorer's next 06:00 through Message Batches at half
    price. The client sees only the lane and the moon ("It will be read before dawn"), never a count or a
    budget; nothing is refused for it (D30). The soft budget only moves work to dawn: phase A's hidden limits
    and the new-moon ceiling are unchanged. There is no `dawn` wish status: the wish stays `listening` and its
    road has `lane: 'dawn'` (the quest log reads the first road's `lane`); asks do have a `dawn` status.
    **The lane is on only with `LORACLE_TICK_SECRET`, the key and a mind**; until the owner sets the secret,
    everything is drawn at once, as in phase A.
  - **The hourly tick.** GitHub Actions (`.github/workflows/loracle-tick.yml`, :17 every hour; quiet without
    its secrets) calls `POST /api/loracle/tick` with `Authorization: Bearer <secret>`, compared in constant
    time; no secret, or a wrong one, is a 404. Boot and `GET /loracle` tick lazily. A tick collects ended
    batches (one batch per stage), keeps promises (anything due within 3 hours goes to the live lane), and
    sends what waits, at most 5 begun dawn items per Lorer (the rest roll a day). A refused or invalid batch
    request, or three failed tries, hands the whole item to the live lane at once, which picks up from the
    ledger already built. No cron in the server: Render's free instance sleeps.
  - **Show to a crew.** One crew at a time, one the Lorer is an active member of (404 otherwise); "Keep it
    to myself again" undoes it. Visibility lives in `lib/access.ts` (`wishVisible`): the Lorer, plus active
    members of that crew while the Lorer is still in it, never across a block. Crew members read the scroll
    read-only: never the Lorer's realm, notes, links, reminders or asks. Every deed stays the Lorer's: a crew
    member gets 403 `not_yours`, a stranger 404 (D8). They also never get what the stone drew from the
    Lorer's own answers and life: the road's signs (the scouts' searches), its dawn promise, This week and the
    provisions; and they get the map points only while the Lorer's "Show my places on maps" is on (D35).
  - **Walk with you.** A crew member can walk any open waypoint (409 `own`, `sealed`, `inked` otherwise).
    When the Lorer makes that waypoint a plan, its walkers are invited (`event_invite`, the one notification:
    a real invitation, D17); making it a plan again invites those who joined since. Changing the crew or
    going back to "Only me" lets every walker go. No notification for being shown a quest or for a walk.
  - **The Epic** (`/oracle/quest/:id/epic`, `GET /loracle/wishes/:id/epic`, 409 `not_fulfilled` before): the
    road walked furthest as a map, every inked line leading to its chapter (only chapters the viewer may
    see), who walked each waypoint. For the Lorer and the crew it is shown to.
  - **Reports (D29).** `quest` is a report target; the snapshot keeps each road's title, calling and waypoint
    names, and, when a crew member reports it, starts with the wish in the Lorer's own words (what the crew
    reads first; spec §2.8 lists only the title, calling and names). A moderator's "remove" un-shares the quest
    (and lets its walkers go) and it can never be shown to a crew again (`wishes.sharing_removed_at`; 409
    `removed`); it is never burned. A Lorer reporting their own quest is reporting the stone's words, so no
    account is its subject.
  - **Words (D33).** Every new word is in `LORACLE_LINES` (81 new keys, none removed). Two existing lines
    became less true and were left as they are for the owner to reword: "Only you can see your wishes and
    your scrolls." on `/oracle` (a new line after it now says "Show one to a crew, and that crew can read
    it.") and the consent sheet's "private to you". The Privacy Policy got new paragraphs only (what crews
    see, deeper questions and batches at Anthropic, keeping a quest to yourself again); its "Last updated"
    date was not changed.
  - **Hardened after review (2026-11-19, the same day; tests only, nothing seen in a browser, no real Claude
    call).**
    - Care first for asks too: a question at the care floor gets the care screen (200 `{ route: 'care' }`),
      and nothing is stored or sent; both minds and the dawn lane refuse one as well.
    - A deeper answer keeps the road's safety rules: X4 (no solo travel abroad before 18), X5 and X6 are
      safety faults that earn the repair, and an answer that keeps one is never shown (the ask fails: the live
      lane retries or fades it).
    - "Ask again" is told each earlier road's waypoints in order, and a road that repeats an earlier title,
      or its places in the same order, is sent back for repair (H18).
    - Walkers are asked along only to a plan the Lorer organizes and that is still open, through the same
      invitation rule as any plan (friends or a shared crew, never across a block). A waypoint linked to
      someone else's event stays theirs.
    - A block between the Lorer and a walker hides the walker from everyone and ends their walks (either
      way). Leaving or being removed from a crew lets go for good: the leaver's quests shown to it are theirs
      alone again (a rejoin shows nothing), and their walks on its quests end. The download lists walks only
      on quests still shown to you.
    - The dawn lane: nothing is sent for a Lorer who took consent back, even mid-tick; an item within 5 hours
      of its promise is left to the promise keeper (drawn live once, never paid for twice); new items are
      begun only while the month's room under the ceiling, less what batches still out may cost (the 30-day
      mean of a dawn item, else US$0.50), holds another; batches and items are claimed in the database, so
      two processes ticking at once (a deploy) send and count everything once; a burned wish's batch still
      counts toward its Lorer's hidden limit; a batch create is sent without SDK retries (no stray paid
      batch); and every batch read is deleted at Anthropic (`client.beta.messages.batches.delete`).
      Whether deleting also ends what Anthropic keeps under its own retention is **not verified**.
    - One open ask per waypoint is a unique index (`wish_asks_one_open`): a double tap is a 409.

**D30 · No limits on adventure.** The owner: "We only get one chance at life... putting a limit on
adventure is not the way to go." The Oracle's realm goes to **No limit** (anywhere on Earth). Technical
limits (Wikidata load, API cost) are solved behind the scenes (indexes, caching, back-off), never shown
as a ceiling. Applies to future features too.

**D29 · Safety for going public (App Store guideline 1.2).** Anyone can report a person, plan, idea,
chapter, story or message they can see (and block the person in the same step); the report keeps a
snapshot of what it said. Moderators are configured by username (`ADMIN_USERNAMES`), not stored in the
database, so only whoever controls the server can appoint them. They can dismiss, take content down, or
suspend the account (suspended accounts are signed out everywhere and can't sign in); one decision settles
all open reports about the same thing. Moderators see reported content even when it's private: the
Privacy Policy says so. New accounts must agree to the Terms (`terms_accepted_at`). Public pages (Terms,
Privacy, Help & contact) open without an account. The contact form stores messages for moderators to
answer by email; they're deleted with the account. Owner's answers (2026-11-18): **paid download** on the
App Store, the code stays private, the owner tests on their iPhone via TestFlight.

**D28 · iPhone next, built in the cloud.** The owner's Android phone stopped working and they chose to
go public on the App Store and sell LORE (2026-11-18). The iOS app is the same Capacitor app
(`apps/ios`, Swift Package Manager, so the project can be generated and synced on Windows). Builds run on
GitHub-hosted Macs with an App Store Connect API key (automatic signing), straight to TestFlight: no Mac
needed. Live updates work as on Android (D23; Apple allows updating web content that doesn't change the
app's purpose). The icon is generated opaque (App Store rule). `ITSAppUsesNonExemptEncryption` is false:
LORE only uses standard HTTPS. Before review LORE needs reporting and moderation (guideline 1.2), terms, a
privacy policy and a support page. Until then the web app works on iPhones from the home screen.

**D27 · The friendly reminder, in LORE's own words.** The owner's message for every lore maker (the
homebody who said no to the wanderer, then ran after the company) is retold as an original fable, "The
one who almost stayed home", on the Oracle and the welcome page, without the names or film lines it was
inspired by: LORE will be sold, and those belong to their rights holders. The look of the Oracle follows
the owner's direction: an ancient magic stone (carved granite, runes that glow while it reads) and old
scrolls for the futures.

**D26 · The Oracle reads the world, not your data stream.** Owner's vision (2026-11-18): LORE as a
"stone circle in your pocket" that reveals possible futures, either following the lore maker's interests
or ignoring them. Built as a deterministic engine (`apps/api/src/lib/oracle.ts`), not an AI model: it
combines free open data (notable places from Wikidata, Open-Meteo weather with night and dawn cloud cover,
the NOAA SWPC aurora Kp forecast, a computed moon phase, Nominatim for typing in a town) with the lore
maker's own free time (personal calendar and plans they're going to), crews, Idea Vault and memories from
the same week in earlier years. Each template (aurora night, stargazing, dawn, wild day trip, road trip,
ancient sites, coast, hot soak, museums on wet days, crew gathering on rainy nights, idea revival, memory
echo) only appears when its conditions hold, and every future lists **the signs** it was read from.
Modes: *Mixed* (two from your interests, one wildcard), *My path*, *Wild*. Seeded per person, day and
reading, so an answer is stable and testable. **Three readings a day** (in the lore maker's own time zone):
it should feel like consulting something, not pulling a slot machine (brief XXXV: no infinite lists).
*Choose this destiny* creates a real plan (organizer, crew if wanted, place with coordinates); *Save to
vault* makes a private idea; *Not this path* lets it go. Private by default: the realm (rounded location),
interests and readings are visible only to their owner, included in the export, deleted with the account.
Answers from the services are cached in `world_cache` (places 30 days, weather and Kp 1 hour, place search
30 days); a service being down means older data or fewer futures, never an error. Usage policies
respected: identifying User-Agent, caching, at most one Nominatim request per second; attribution shown
on the Oracle screen. The services see the realm's coordinates (rounded to a 0.5° cell for places) and
the typed town name, never who is asking. Limits: no opening hours, road closures or tides; the screen
says to check before going.

**D25 · Notes to self and reminders are one thing.** A note with a time is a reminder (`notes` table).
Private to the owner like the personal calendar; linked optionally to an event ("Remind me 1 hour / 1 day
before"). Due-within-a-day reminders show on Home; reminders sit on the Calendar's personal layer. In the
Android app (0.3.0+) each upcoming reminder is scheduled as a local notification on the device, so it
fires on time even offline or with the app closed; the list re-syncs whenever it changes. Browsers get no
background alerts (no push yet). Notification permission is asked for when the first reminder is set.
Inexact timing (no exact-alarm permission), so a reminder can arrive a few minutes late.

**D24 · Crazy theme.** Owner's idea, revised after the first take (neon glow on dark) missed: every part of the page (sections, cards, chips, buttons, tabs, calendar days, notes) is a solid block of one bright colour, and every piece of text gets its own colour as a highlighter patch. Ten colours (purple, red, green, yellow, cyan, blue, orange, pink, lime, white), each with its own text colour for contrast. Painted at random by lib/crazy.ts as elements appear, never matching the block around or before; re-rolled every visit or with Roll.

**D23 · The Android app updates itself from our server.** Capacitor Updater (MPL-2.0), self-hosted:
on launch the app POSTs to `/api/app/updates`; if the server's web build (`build.json`) differs from
the one running, it answers with a zip URL and SHA-256. The plugin downloads, verifies and switches at
the next background (`autoUpdate: atBackground`), and rolls back by itself if the new build never
calls `notifyAppReady()`. The server zips `apps/web/dist` on demand, writing its own address into
`index.html` (`<meta name="lore-api-base">`), so updates know which server to talk to. Capgo's cloud,
channel and stats endpoints are all disabled: no data leaves for third parties. Allowed by Google
Play (web code in a WebView). Native changes still need a new APK; installing one resets to its
built-in web app (`resetWhenUpdate`), which then updates again.

**D22 · Live on Render + Neon (free, no card).** The owner's bank blocked Oracle's card check, so LORE
runs on a Render free web service (Docker) at https://lore-g8co.onrender.com with Neon free Postgres
(1 GB). On Render, config defaults adapt automatically (`RENDER=true`): photos stored in Postgres
(the disk is wiped on restart), trusted proxy, scrypt 2^15/p=3 for 512 MB RAM; photo links are signed
with a key derived from `DATABASE_URL` unless `MEDIA_URL_SECRET` is set. Only `DATABASE_URL` needs
configuring. UptimeRobot pings `/api/health` every 5 minutes to stop the free service sleeping.
Oracle (D19) remains the upgrade path when photos outgrow 1 GB.

**D21 · Android app = Capacitor with the web app bundled inside.** The APK carries the built web app
and talks to the server over HTTPS with a bearer token (cookies don't cross from the app's
`https://localhost` origin). The API allows CORS for the app origins only (`NATIVE_ORIGINS`) and never
with credentials. A separate *dev* APK loads the Vite dev server over Wi-Fi for testing before a server
exists. App id `com.gosinn.lore` (change it before the first Play Store upload if wanted; impossible after).

**D20 · Photo links are signed and short-lived.** Every media URL carries an expiry (1–2 hours,
rounded to the hour) and an HMAC; the file route accepts a valid signature instead of a session, because
`<img>` can't send a bearer token. Only people who can see a photo ever receive its link; a forwarded
link stops working within two hours. Unsigned requests still go through the full access check. Set
`MEDIA_URL_SECRET` in production so links survive restarts.

**D19 · Hosting: Oracle Cloud Always Free.** Owner's choice (2026-10-18; no paid hosting). One Ampere
VM (2 OCPU / 12 GB) runs Caddy (HTTPS) + the app + Postgres + nightly backups via
`deploy/oracle/docker-compose.yml`; a free DuckDNS name provides the domain. Deploys are `git push oracle
main` to a bare repo on the server, whose hook rebuilds and restarts. Fly.io (no free tier any more) and
Render (sleeps, free database deleted after 30 days) were ruled out.

**D18 · Account deletion keeps shared history, anonymised.** Owner's choice (answers Q1). Deleted: the
account, sessions, friendships, blocks, memberships, RSVPs, personal calendar, notifications, private
(`only_me`) chapters, chapters nobody else was part of, ideas only they or their friends could see,
profile pictures and unused uploads. Kept with the author set to null ("a former member"):
contributions, comments, and the photos used in shared chapters. Crews pass to the longest-standing
admin (else member); events and chapters get a new organizer; anything left with nobody in it is
deleted. Deletion requires the password. A JSON export (`GET /api/me/export`) is offered first.

**D17 · Notifications only for things that change your plans or your history.** Invitations, crew
invites, plan changes, cancellations, being added to a chapter, new contributions to a chapter you're in,
friend requests. *Not* for discussion messages or RSVPs (would be noise). Several contributions to one
chapter collapse into a single unread notification. *Why:* brief part XXIV, "respect the user's attention".

**D16 · Home is finite.** Each section returns at most 3–8 items and the page ends with "That's everything.
Go make some lore." The idea pick rotates daily, not on every refresh. No infinite lists anywhere; the
Lorebook is browsed by year and search, notifications show the latest 50. *Why:* "No scrolling. Only rolling."

**D15 · Chapter deletion is restricted.** A chapter can only be deleted by its creator, and only while no
one else has contributed. Participants can remove themselves and delete their own contributions. *Why:*
"The experience belongs to its participants"; one person shouldn't erase shared history.

**D14 · A chapter keeps its own copy of the event's facts.** Drafting from an event copies title, dates
(as calendar dates in the event's zone), place, crew and the people who went. Editing the event later
doesn't rewrite the chapter. *Why:* brief part V, "preserve historical accuracy".

**D13 · You can only invite people you can reach.** Invitations to events and crews, and adding people to
chapters, require being friends or sharing a crew, never across a block. Event access and friendship stay
separate concepts (you can be in an event with a crewmate who isn't your friend). *Why:* spam protection
without forcing friendship.

**D12 · One chapter per event.** Multiple perspectives live inside the chapter as contributions, not as
competing chapters (brief part X).

**D11 · Media is never public.** Files are served through the API, which checks access (see D20 for
signed links). Photos are re-encoded on the device, which strips EXIF/GPS. File types are detected
from bytes.

**D10 · Deletion rules in the schema.** Personal data cascades with the account; shared records keep
existing with `created_by = null`; contributions, comments and their photos keep existing with the author
set to null (D18).

**D9 · Audiences, not ad-hoc ACL lists.** Each item has one audience (`only_me`, `participants`,
`friends`, `crew`) plus the explicit people attached to it. This covers every Phase 1 sharing case in the
brief, is easy to show in the UI ("Who can see it"), and compiles to a single SQL predicate per type.
Per-person exceptions can be added later as an access table if they're ever needed.

**D8 · 404 for hidden things.** Anything you can't see behaves as if it didn't exist.

**D7 · Sessions, not JWTs.** Opaque random tokens, stored hashed, revocable server-side, sliding expiry.
Cookies for browsers, bearer tokens for native apps.

**D6 · scrypt for passwords.** Built into Node (no native build step in Docker), memory-hard, parameters
stored with each hash.

**D5 · Node runs the TypeScript directly.** Node 22.18+/24 strips types natively, so the API has no build
step and no source maps to manage. Code sticks to erasable syntax (`erasableSyntaxOnly`), and imports use
`.ts` extensions.

**D4 · PGlite for development and tests, Postgres in production.** Same SQL dialect (PGlite *is*
Postgres), no installer, no Docker. Tests get a fresh in-memory database per file. The production `pg`
driver path was verified by running the lifecycle and privacy suites against a Postgres wire-protocol
server (PGlite socket server) on 2026-10-18.

**D3 · No npm workspaces.** D: is exFAT and can't create the symlinks workspaces need. One root
`package.json`; shared code is imported as `#shared` via Node subpath imports, which Node, TypeScript and
Vite all resolve.

**D2 · Web first, native via Capacitor.** Owner's choice: web app first, then a real app as soon as
possible. The PWA is the product; Capacitor wraps the same build for iOS and Android. The API already
supports bearer tokens for it.

**D1 · Own API + Postgres.** Owner's choice (2026-10-18) over Supabase.

**D0 · Cardboard for connecting other apps, at the very end.** Owner's instruction. Cardboard
(github.com/Gosinn/Cardboard) is the owner's encrypted personal data store and OIDC provider, still in
development. Expected integration points: "Sign in with Cardboard" (OIDC + PKCE) and Cardboard docks for
cross-app messages. Nothing is built for it yet, deliberately.

## Open questions for the product owner

**Q1 · ~~Account deletion~~** Answered: D18. Still open: immediate deletion (current) or a grace
period to change your mind?

**Q2 · Data export format.** A JSON export exists (D18); photos are linked, not bundled. A zip with the
photos, or a printable Lorebook PDF, later?

**Q3 · Discussion notifications.** Currently silent (D17). Options: notify organizers only, or let each
person "follow" a thread.

**Q4 · Crew size limit and public crews.** No limit and no discovery today (all crews are private).

**Q5 · ~~Hosting~~** Answered: D19 (Oracle Cloud Always Free + DuckDNS). Later: a real domain name
(~€10/year) would look better than `*.duckdns.org` and is needed for Play Store links.

**Q6 · Brand.** The current identity (Fraunces + Instrument Sans, paper/ink/ember palette, compass-needle
emblem) is a proposal. Replace or keep. (Since D34 the app wears the Loracle's stone kit over a world each Lorer
picks: Cinzel and IM Fell English, carve and glow inks, and a compass needle through the O of LORE.)

**Q7 · Lore Score.** Brief part XII lists the open questions (numeric? public? comparable?). Needs answers
before Phase 2 scoring work starts.

**Q8 · The Loracle before release (D31).** To be checked by a person before release: every entry in
`CRISIS_LINES` and `EMERGENCY_NUMBERS` (`packages/shared/src/vocabulary.ts`) against the service's own
site; the Icelandic care phrases (a native speaker); the consent sheet and the Privacy Policy's lines about
Anthropic (retention, no training on API data, transfer basis) against Anthropic's current terms; and
whether the Loracle stays 13+ with the teen rules or becomes 18+. Also: the cast limit (about 10 a day)
and the monthly ceiling (US$150) are first guesses, to tune once real spend rows exist.

**Q9 · The Treasure Map's words (D32).** Optional copy, not built: "Here be dragons. This page isn't on the
map." on Not Found, a "Lore maker" kicker above the name on Profile, and "Provisions" for the packing list.
Also the look's name ("Treasure Map") and whether the old stone door should come back on Home as the one
exception (its markup is in commit 671c2bc; its CSS is kept). And the desktop rail's Loracle icon: it is
still lucide's Sparkles (the generic AI glyph that Create's Loracle tile refuses; Create uses Flame). The
rail also shows inside the Loracle, which must look exactly as it did, so it was left for the owner to call.
(Since D34 the Treasure Map look is retired, so its words and its name only matter if it comes back; the rail
icon question stands.)

**Q10 · Loose ends of the one base (D34).** Each is small; none was decided without the owner.
- **The rail's lettering.** The preview shows Cinzel on the desktop rail; the rail keeps the temple rail's own
  UI sans and Fraunces wordmark, because the Loracle's rule can't change under "the Loracle stays exactly as
  it is". Switching both sides is one rule in the temple's CSS plus its mirror in lore.css.
- **The Loracle's scrollbar** (desktop): kept light, as under every earlier look. A dark one would suit the
  temple better; dropping one rule in lore.css ("the Loracle stays as it was") does it.
- **Input rims.** Wells stand out from slabs only by their sunk shadow (rim about 1.1:1), exactly as in the
  Loracle; WCAG's 3:1 for control boundaries may want a faint light rim (on every well, or the Loracle's too).
- **The front door by day.** Welcome and "Where do you stand?" (and a start with no one signed in) always show
  the black star sky by night; they could follow day and night like every other page.
- **A dark plate at night on the four bright worlds** (added for AA after review): the owner may prefer the
  bare halo of the preview there and accept lower contrast, or a darker cut of those worlds' art instead.
- **Vellum cards by day.** Ready behind `data-cards="vellum"`, not offered (the owner picked stone).
- **A day twin per world** (a lighter version of each night world) instead of the one green-hills day.
- **Wide screens.** The portrait art is cropped to its middle band on a wide desktop (`center / cover`), so the
  sun and the mountain peak may not show; a wide cut of the art would fix it.
- **The reminder scroll on Welcome** is the Loracle's own parchment scroll (`ReminderScroll` from
  `components/oracle.tsx`, the same one the temple shows), so it stays light parchment over the black star sky.
  It is the Loracle's kit, not the retired map paper; a dark dress for it on Welcome only would be one CSS rule
  (unverified in a browser either way).
