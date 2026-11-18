# LORE — Decisions

Decisions already taken (with the reason), then the questions that are the product owner's to answer.
Newest first within each list.

## Taken

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
emblem) is a proposal. Replace or keep.

**Q7 · Lore Score.** Brief part XII lists the open questions (numeric? public? comparable?). Needs answers
before Phase 2 scoring work starts.
