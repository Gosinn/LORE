# LORE — Roadmap

Status key: ✅ built and verified (automated tests and/or checked in the browser) · 🟡 partly built ·
⬜ not started. "Verified" means exactly that; anything untested says so.

## Phase 1 — The Foundation (current)

Success condition from the brief: create a crew → invite friends → suggest an idea → turn it into an event →
coordinate attendance → complete it → write the chapter together → share it with participants → revisit it.
**Status: the whole path works.** `apps/api/test/lifecycle.test.ts` walks it end to end, and the screens were
exercised in the browser with demo data.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Registration and authentication | ✅ | username/email + password, cookie sessions, bearer tokens for native. No email verification or password reset yet (needs an email provider). |
| 2 | User profiles | ✅ | name, bio, profile picture, "lore you can see", crews in common |
| 3 | Friend connections | ✅ | search, request/accept/decline/cancel, remove, block |
| 4 | Crews | ✅ | create, invite, accept/decline, roles, remove, leave; crew workspace page |
| 5 | Basic personal calendar | ✅ | private entries, month + agenda |
| 6 | Shared LORE calendar | 🟡 | month and agenda views, crew filter. Day/week views, recurrence and reminders not built. |
| 7 | Event creation | ✅ | title + time is enough; category, place, crew, audience, capacity, notes optional |
| 8 | Event invitations | ✅ | at creation or later; only reachable people |
| 9 | RSVP | ✅ | I'm in / maybe / not this time; capacity enforced; join open friends/crew events |
| 10 | Basic event discussions | ✅ | thread per event (also per idea and chapter) |
| 11 | Idea Vault | ✅ | personal and crew vaults, "I'm in", statuses, archive |
| 12 | Idea-to-event conversion | ✅ | only asks *when*; interested people invited automatically |
| 13 | Basic Lorebook | ✅ | timeline by year, crew/year filters, search across chapters and contributions |
| 14 | Chapter creation | ✅ | from an event (snapshot) or from scratch, any date in the past |
| 15 | Photo uploads | 🟡 | API upload, type sniffing, access-checked serving, cover photos: tested. The in-browser file picker wasn't exercised by automation (it can't drive a file dialog). Try it by hand. |
| 16 | Collaborative chapter contributions | ✅ | stories, quotes with speaker and context, photos; own-edit, organizer moderation |
| 17 | Basic notifications | ✅ | in-app, collapsing, unread badge. No push or email yet. |
| 18 | Privacy and permissions | ✅ | audiences + roles enforced in SQL on the server; 14 privacy tests |
| 19 | Responsive interface | ✅ | phone tab bar, desktop side rail, one base (the Loracle's kit) over a world each Lorer picks (D34; the Treasure Map and the older looks retired, kept), installable PWA |

**Phase 1 gaps to close before real users** (in order):

1. ✅ Account deletion (shared history kept anonymised) and JSON data export: tested.
2. ✅ Live at **https://lore-g8co.onrender.com** (Render free + Neon free, no card; `deploy/render`).
   Checked from outside: app, deep links, manifest, sign-in required, CORS for the app, cross-site
   writes blocked. Oracle kit (`deploy/oracle`) kept for when it outgrows the free tiers.
3. ⬜ Password reset and email verification (needs an email provider; free tiers exist).
4. ⬜ Reporting and moderation basics beyond blocking.
5. ⬜ Calendar day/week views, event reminders.

## The real app (owner priority: "as soon as possible")

| Step | Status |
|---|---|
| API accepts bearer tokens for native clients | ✅ tested |
| CORS for the app origins (no credentials) | ✅ tested |
| Signed, short-lived photo links (images can't send bearer headers) | ✅ tested |
| Capacitor Android project (`apps/android`), LORE icons and splash, back button, status bar | ✅ builds |
| Portable Android toolchain on D: (JDK 21, SDK 36) | ✅ |
| `node tools/android.mjs dev`: Wi-Fi test app against this PC | ✅ builds (`dist-android/LORE-dev.apk`); not yet run on a phone |
| `node tools/android.mjs release --api https://…`: signed APK + AAB | ✅ 0.1.0 and 0.2.0 built for the live server |
| Live updates: web changes reach installed apps without a new APK | ✅ server side tested (zip, checksum, `unzip -t`); on-phone update not yet observed |
| Run on a real phone (layout under system bars, sign-in, photos) | ⬜ owner's phone |
| Google Play listing (developer account is a one-time $25). Data safety must declare **Approximate location** (App functionality; the device's point rounded to ~1 km before it leaves, or a typed town), as deploy/ios/README.md does for Apple. The manifest declares fine location only up to Android 11 (API 30), where Android has no approximate choice | ⬜ |
| iOS project (`apps/ios`), LORE icon and splash, live updates, `tools/ios.mjs prepare` | ✅ generated and synced on Windows; not yet built (needs Xcode) |
| Cloud iPhone build → TestFlight (`.github/workflows/ios.yml`) | 🟡 written, not run: waits for the owner's Apple Developer account (deploy/ios/README.md) |
| App Store rules: report + block, moderation screen (24 h), Terms agreed at sign-up, Privacy Policy, Help & contact page, App Privacy answers | ✅ 11 tests; report, moderation, public pages and sign-up checked in the browser |
| Forgot password by email (needs an email service) | ⬜ until then: `npm run account:recover` (deploy/render/README.md) |
| App Store listing, price, review | ⬜ owner's account |
| Push notifications (FCM) | ⬜ |
| Offline cache of upcoming plans | ⬜ |

## The expansion: exploring the world (owner priority, 2026-11-18)

"An app that sees what the user doesn't see": LORE reveals possible futures in the real world around you.

| Step | Status |
|---|---|
| **The Oracle**: realm (town + radius), interests, three possible futures a day from places, weather, sky, free time, crews, ideas and memories; Mixed / My path / Wild | ✅ 20 tests; tried in the browser with live open data (aurora night, hot soak, museum wildcard). **Replaced in the app by the Loracle's wishes (D31)**; the API and old readings remain |
| Choose this destiny → real plan with place and coordinates · Save to vault · Not this path | ✅ tested; checked in the browser |
| Oracle realm with **No limit** (journeys past 250 km, far shores by air past 1,500 km) and the full stone & scroll look | ✅ 99 tests; checked at phone width with a live reading |
| Oracle on Home, Create and the desktop rail | ✅ checked in the browser (desktop and phone width) |
| Oracle on a real phone (arrives by live update, no new APK) | ⬜ owner's phone |
| **The Loracle, phase A** (D31): wishes first and only; the stone's questions; a quest per wish drawn by Claude Opus 5.5 (weigh, research with web search/fetch, compose, checks, repair, pins); open and sealed waypoints; plan / vault / my week / ink / chapter; care route; hidden limits and the monthly ceiling (moon); asleep without a key; fake mind for dev. The Futures are gone from the app (API kept) | ✅ 219 tests; typecheck; build; smoke-tested end to end with the fake mind (no browser), after the review fixes too (care floor, sealed offers, spend always counted, consent withdrawal, reach ANYWHERE by default, town-only realm). 🟡 **Not verified:** no real Claude call yet, nothing looked at in a browser |
| Loracle: owner sets `ANTHROPIC_API_KEY` (Render), a Console spend limit, and runs the live eval (`node tools/loracle-eval.mjs --yes`, est. US$15–25, unverified) and reads the scrolls | ⬜ owner |
| Loracle: crisis lines, emergency numbers, Icelandic care phrases and the Anthropic consent/privacy wording checked by a person | ⬜ before release |
| Loracle phase B/C: Ask deeper, Ask again, a dawn lane (batches), crew quests | ⬜ later |
| **The Treasure Map** (D32): one look across the app (map paper, leather chrome, brass compass Create); the older looks retired, kept; stone only inside the Loracle | Retired the same day (D34, see "The one base and the worlds"); kept in code |
| **The daily sign on Home** (D32): one small future a day near where you stand, on the Loracle door; Choose it (a private plan) / Not this one; never counts as a reading, stays within 250 km; only moments still ahead; dealt again after a move or once all its moments passed, at most 3 deals a day | 🟡 API tested (`oracle.test.ts`, "the daily sign", incl. local midnight in Honolulu); the door not looked at in a browser |
| **"Where do you stand?" at sign-up** (D32): location recommended (rounded to ~1 km), or a town by name, or Later; the town at a point from `GET /oracle/reverse` | 🟡 reverse endpoint and the "Near me" realm lookup tested with a fake world. **Not verified:** the page in a browser, Nominatim's live reverse answer, location permission on Android/iOS (needs a new native build) |
| **Lore Map** (D35): places on chapters, plans and ideas (Exact / About here ~5 km / Only me, rounded on the server; "Show my places on maps"); `/lorebook/map` with Mine, Crew, Memories, Adventures; MapLibre over OpenFreeMap tiles in LORE's night and day look; the Place row in the chapter, plan and idea forms | ✅ API: 23 tests in `map.test.ts` (no exact point leaks by any route, the switch, blocks, parity with the item routes, cap, waypoints, home, export, deletion, points travelling only with their author, idea names, all-day plans); review fixes in (D35); typecheck, full tests (299 API + 196 web copy) and build pass; MapLibre in its own lazy chunk (302 kB gzip), not precached; HTTP smoke test against a local API. 🟡 **Not verified:** nothing looked at in a browser or on a phone (the map, pins, clusters, the "N places here" sheet, the offline state, day/night switch, the picker, the kit Sheet's new focus handling); tiles in the Android and iOS web views; iOS starting the map's worker from a `blob:` URL |
| Lore Map: Profile → Your data also offers "Show my places on maps" (today only on the map page) | ⬜ later |
| Lore Map: a shared places table (one place for many chapters), and photos placed on the map | ⬜ later |
| More signs: tides, opening hours, events happening nearby, sunset/golden hour | ⬜ |

## Live text: the owner's own words (D33, owner request 2026-11-18)

"I want the ability to change all text myself manually and then a button to commit in real time."

| Step | Status |
|---|---|
| Build transform: every static word in the web app, the vocabulary and the static server messages becomes an editable key; `copy-catalog.json` (about 1,130 texts, only what ships) | ✅ transform, render-equality and coverage tests (`npm run test:copy`); build checked: catalog emitted, page chunks call the runtime |
| API: public `GET /api/copy`, owner-only publish / undo / history, version header, catalog check in production, words following a move after a deploy, kill switch, owner `gosinn` by default with the cut-off | ✅ `copy.test.ts`, `copyShared.test.ts`, `config.test.ts`; tried by hand against a local production-mode server (publish, header change, 404 for others, 403 cross-site, unknown key refused, undo, restart) |
| Runtime and sync on every client: cached words before the first render, refetch on a new version or when the app comes to the front, crash guard | ✅ unit tests (node, no browser) |
| The owner's editor: Profile → Edit text, the quill, outlines, tap to edit with live preview, publish bar and sheet (legal tick), discard, Edited texts (published, earlier versions, orphans, history with undo, find, on this screen), "Change those too" | 🟡 typecheck and build pass; the editor is its own chunk, kept out of the service worker. **Not verified:** nothing looked at in a browser or on a phone yet (tapping, outlines, the sheet above the keyboard, TalkBack/VoiceOver) |
| Server words: static error messages, notification titles, the stone's signs (new ones) | ✅ tested |
| `npm run copy:check` (live edits a code change would orphan) and **Copy for Claude** (bake published edits into the code) | ✅ unit-tested / tried offline and against a fake server; not yet run against the live server |
| Deploy to Render and edit for real (the live server has none of this yet) | ⬜ next deploy |

## The one base and the worlds (D34, owner request 2026-11-18)

"there has to be a level of consistency in the whole thing. the base. which is the UI itself" and "let's give the
users some variety".

| Step | Status |
|---|---|
| **One base**: the Loracle's own kit on every screen (stone buttons, copper Create, wells, slabs, stamps, Cinzel and IM Fell), the tab bar and rail as in the temple, the live text editor too; the Treasure Map retired, kept | 🟡 typecheck, full tests and build pass; stone audit clean (wall, masonry and rune textures only in the Loracle); no Loracle file or temple CSS changed; no words changed (live text keys: 0 removed, 19 new). Contrast computed, not measured. **Not verified:** nothing looked at in a browser or on a phone, including the before/after check that the Loracle is unchanged, 320–375 px widths, the desktop rail and wide layouts |
| **Seven night worlds** and Profile → Your world (radios with live thumbnails, one tap applies); black star sky by default; Welcome, "Where do you stand?" and signed-out starts on the default world with the compass rose; a dark plate under text on the four bright worlds at night | 🟡 choices, the first-paint script, the signed-in hint and the tabs' storage events unit-tested (a stand-in page, no real DOM). **Not verified:** in a browser; how long the SVG filters take to draw on a mid-range phone |
| **Day mode**: the green hills under the engraved sun; When = Follow my phone / Follow the sun where I stand / Always night / Always day; stone cards by day, text on the sky in ink on a vellum plate | 🟡 sunrise and sunset tested against almanac times (Reykjavík, London, midnight sun, polar night). **Not verified:** in a browser; whether the Android app's WebView reports the phone's dark mode. *(Simplified 2026-11-19, next row.)* |
| **Your world, simpler** (owner 2026-11-19): every world, dark or light, one tap and it's yours, always (the green hills too, no "day mode" first); **Auto** (off by default) is the only way the world changes by itself: a night world among the dark ones, a day world among the light ones, Follow my phone or the sun. One list of worlds in `lib/theme.ts` (`WORLDS`: id, label, tone, bar); index.html's first paint needs no list (`lore.boot`). Old choices carried over (Follow my phone/sun → Auto on; Always night → that night world; Always day → the green hills) | 🟡 typecheck, the theme tests (57: defaults, every old stored value, a light world is day, Auto with the phone and the sun, the boot script wearing exactly what theme.ts wears for every world and pair) and the build pass. **Not verified:** in a browser or on a phone: the switch, the two piles, the thumbnails at 320–375 px |
| More light worlds (the main session is drawing them; adding one = art + a worlds.css block + a lore.css block, after the green hills' block + one line in `WORLDS`; the tests read the list) | ⬜ next |
| Native colours: splash (`#030409`, PNGs redrawn), the web view's own background (`#030409`), notification accent `#FFB36B`, PWA manifest | 🟡 in the repo; the native ones arrive with the next native build (`tools/android.mjs` syncs the config; iOS needs `npx cap sync ios`) |
| Sync the world choice across devices (an account setting; needs a migration) | ⬜ later |
| Light vellum cards by day as a choice in Your world (the CSS hook `data-cards="vellum"` is ready) | ⬜ owner to choose (DECISIONS Q10) |
| A day twin for each night world (instead of the one green-hills day) | ⬜ later |
| A wide cut of the art for desktop (the portrait art is cropped to its middle band) | ⬜ later |
| Time the worlds' SVG drawing on a mid-range Android and an iPhone; if slow, draw the full-screen grain of the green hills, mountain range, northern lights and treasure map as a small CSS tile instead of a full-screen filter (the black star sky's filters are already bounded to the screen) | ⬜ needs a phone |

## Phase 2 — Spontaneity and identity

Who's Down? (spontaneous, expiring invitations; *I'M DOWN / MAYBE / NOT TODAY*), Quote Archive across
chapters, achievements and custom crew achievements, basic Lore Score (after Q7 is answered),
shared-history views between two people, profile customisation, event ratings, better historical search.

## Phase 3 — The living world

Lore Map (✅ first version, D35: exact/approximate/only-me places; a places table later), traditions and their timelines, Hall of Lore,
crew challenges and rivalries, more event categories, media organisation, external calendar sync
(Google first, then Apple/Outlook) as a separate integration layer.

## Phase 4 — Expeditions and legacy

Expedition Mode (route, equipment, log, milestones), offline expedition features, Lore Capsules, advanced
Lore Score, full data export, historical imports, archive tools.

## Last — Cardboard integration

Connect other apps to LORE through Cardboard (github.com/Gosinn/Cardboard) once it's ready: "Sign in with
Cardboard" (OIDC + PKCE → `user_identities` table), Cardboard docks for cross-app messages, optionally a
private Cardboard box for LORE exports. Scheduled last by the owner.
