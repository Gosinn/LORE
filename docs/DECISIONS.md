# LORE — Decisions

Decisions already taken (with the reason), then the questions that are the product owner's to answer.
Newest first within each list.

## Taken

**D32 · One look, the Treasure Map; the older looks are retired, not deleted.** The owner (2026-11-18):
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
  high, repair medium), server-side fallbacks, web search and web fetch (`_20260209`) for the research,
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
  and crew quests are not built.

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
emblem) is a proposal. Replace or keep. (Since D32 the app wears the Treasure Map: the same fonts plus Cinzel and
IM Fell English, a map-paper palette, and a compass needle through the O of LORE.)

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
