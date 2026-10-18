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

1. Account deletion and data export (decisions Q1, Q2).
2. Password reset and email verification (pick an email provider).
3. Deploy: domain, HTTPS, managed Postgres or VPS; S3-compatible storage for photos; backups.
4. Reporting and moderation basics beyond blocking.
5. Calendar day/week views, event reminders.

## Next: the real app (owner priority: "as soon as possible")

| Step | Status |
|---|---|
| API accepts bearer tokens for native clients | ✅ tested |
| Add Capacitor (`@capacitor/core`, `cli`, `android`, `ios`), point it at the built web app | ⬜ |
| CORS for the Capacitor origins; token storage on the device (Capacitor Preferences or secure storage) | ⬜ |
| Signed media URLs (images can't send bearer headers) | ⬜ |
| Android build on this machine (JDK and Android SDK already on `D:\dev`) | ⬜ |
| iOS build (needs a Mac or a cloud build service) | ⬜ |
| Push notifications (FCM/APNs) | ⬜ |
| Offline cache of upcoming plans | ⬜ |

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
