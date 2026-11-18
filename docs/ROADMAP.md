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
| 19 | Responsive interface | ✅ | phone tab bar, desktop side rail, light and dark themes, installable PWA |

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
| Google Play listing (developer account is a one-time $25) | ⬜ |
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
| **Lore Map**: places, plans and memories on a map (MapLibre + free OpenStreetMap tiles) | ⬜ next |
| More signs: tides, opening hours, events happening nearby, sunset/golden hour | ⬜ |

## Phase 2 — Spontaneity and identity

Who's Down? (spontaneous, expiring invitations; *I'M DOWN / MAYBE / NOT TODAY*), Quote Archive across
chapters, achievements and custom crew achievements, basic Lore Score (after Q7 is answered),
shared-history views between two people, profile customisation, event ratings, better historical search.

## Phase 3 — The living world

Lore Map (places table; exact/approximate/hidden locations), traditions and their timelines, Hall of Lore,
crew challenges and rivalries, more event categories, media organisation, external calendar sync
(Google first, then Apple/Outlook) as a separate integration layer.

## Phase 4 — Expeditions and legacy

Expedition Mode (route, equipment, log, milestones), offline expedition features, Lore Capsules, advanced
Lore Score, full data export, historical imports, archive tools.

## Last — Cardboard integration

Connect other apps to LORE through Cardboard (github.com/Gosinn/Cardboard) once it's ready: "Sign in with
Cardboard" (OIDC + PKCE → `user_identities` table), Cardboard docks for cross-app messages, optionally a
private Cardboard box for LORE exports. Scheduled last by the owner.
