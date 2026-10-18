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

## 3. Database schema

Defined in `apps/api/src/db/schema.ts`; SQL migrations in `apps/api/drizzle/` are generated from it
(`npm run db:generate`) and applied automatically on server start.

| Table | Purpose | Notable columns / rules |
|---|---|---|
| `users` | Accounts | `username` and `email` unique, lowercase; `password_hash` (scrypt); `avatar_media_id` |
| `sessions` | Sign-in sessions | id = SHA-256 of the token (token itself never stored); sliding expiry |
| `friendships` | Friend requests and friendships | one row per pair (unique on least/greatest ids); `pending` / `accepted` |
| `blocks` | Blocks | blocking deletes any friendship between the two |
| `crews` | Groups | `emoji`, `members_can_invite` |
| `crew_members` | Membership | role `owner` / `admin` / `member`; status `invited` / `active` |
| `ideas` | Idea Vault | status lifecycle; audience `only_me` / `friends` / `crew`; where/when/budget notes |
| `idea_interest` | "I'm in" on an idea | |
| `events` | The LORE calendar | UTC instants + IANA `time_zone`; audience `participants` / `friends` / `crew`; `idea_id` link; `capacity` |
| `event_participants` | Invitations and RSVPs | role `organizer` / `participant`; rsvp `invited` / `going` / `maybe` / `declined` |
| `event_checklist_items` | Packing list | assignee |
| `personal_entries` | Private calendar | never joined into any shared query |
| `chapters` | Lorebook chapters | `occurred_on` date (+ optional `ended_on`); `event_id` unique (one chapter per event); own copy of title/date/place; audience `only_me` / `participants` / `crew`; cover photo |
| `chapter_people` | Who a chapter is about | personal Lorebooks reference the same chapter, never copies |
| `contributions` | Each person's piece of a chapter | `story` / `quote` (speaker user or name, context) / `photo` (media) |
| `media` | Uploaded files | `storage_key`; scoped to at most one of chapter / event / crew (none = profile picture) |
| `comments` | Discussion threads | exactly one of event / idea / chapter |
| `notifications` | In-app notifications | title rendered at creation, `href` to open |

Integrity is enforced in the database too: enums, `CHECK` constraints (audiences per table, end after start,
one comment target, photo contributions need media), unique indexes, and foreign keys with explicit delete
rules. **Deletion rule** (brief part XXVIII): a person's own data cascades (sessions, friendships, their
contributions, their media); shared records others rely on (crews, events, ideas, chapters) survive with
their creator set to null.

Built for later connections without speculative tables: places (Lore Map), traditions, achievements,
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

Photos are resized on the device before upload, which also strips EXIF metadata such as GPS location.
The server identifies file types from their bytes, not from what the client claims.

## 6. Navigation

Five primary destinations (brief part II), as a bottom tab bar on phones and a side rail on wide screens:

| Tab | Screen | Contextual routes from here |
|---|---|---|
| Home | `/`: needs your answer, coming up, still being planned, write it down, crews, ideas worth doing, on this day, recent lore. Finite, and ends with "That's everything." | events, ideas, chapters, crews, Idea Vault |
| Calendar | `/calendar`: month and agenda views; LORE and personal layers | new event on a day, personal entries |
| Create | `/create`: plan something, save an idea, write a chapter, start a crew | forms |
| Lorebook | `/lorebook`: timeline by year, crew and year filters, search | chapters |
| Profile | `/profile`: picture, bio, friends, crews, my lore, settings | `/friends`, `/u/:username` |

The notifications bell sits in the top bar everywhere. Crews (`/crews/:id`) are workspaces holding the crew
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
├─ tools/                  env.ps1 / env.sh, dev.mjs (runs API + web), android.mjs (builds the app), make-icons.mjs
├─ apps/android/           Capacitor Android project (generated, plus icons, splash and signing setup)
├─ packages/shared/src/    vocabulary.ts (enums + labels), inputs.ts (Zod schemas), types.ts (DTOs)
├─ apps/api/
│  ├─ src/
│  │  ├─ server.ts         entry point: config → database → migrate → listen
│  │  ├─ app.ts            Fastify setup, auth hook, CSRF guard, error handler, static web app
│  │  ├─ config.ts         environment parsing
│  │  ├─ context.ts        AppContext, requireUser
│  │  ├─ auth/             password.ts (scrypt), sessions.ts
│  │  ├─ db/               schema.ts, index.ts (Postgres or PGlite), migrate-cli.ts
│  │  ├─ lib/              access.ts (privacy), queries.ts (read models), notify.ts, storage.ts, images.ts, …
│  │  ├─ routes/           auth, users, friends, crews, events, personal, ideas, chapters, media, comments, notifications, home
│  │  └─ seed.ts           demo data through the HTTP API
│  ├─ drizzle/             generated SQL migrations
│  └─ test/                auth, privacy and full-lifecycle tests (Vitest, in-memory Postgres)
└─ apps/web/
   ├─ index.html, vite.config.ts (PWA manifest and service worker)
   ├─ public/              favicon and app icons
   └─ src/
      ├─ main.tsx, router.tsx
      ├─ lib/              api.ts, queries.ts (data hooks), dates.ts, images.ts, theme.ts
      ├─ components/       AppShell, ui, cards, pickers, CommentThread
      ├─ pages/            one file per screen
      └─ styles/app.css    design tokens (light "Paper", dark "Campfire") and components
```
