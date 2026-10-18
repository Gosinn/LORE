# LORE — Decisions

Decisions already taken (with the reason), then the questions that are the product owner's to answer.
Newest first within each list.

## Taken

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
