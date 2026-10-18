# Putting LORE online for free, no card (Render + Neon)

## What are these, in plain words?
LORE has two halves that need a home on the internet:

- **The app itself**: the program people's phones and browsers talk to.
  **Render** is a company that runs programs like this for you. You point it at the LORE code on
  GitHub, it builds it, and gives it a web address like `https://lore-abcd.onrender.com`.
- **The memory**: every account, plan, idea, chapter and photo has to be saved somewhere.
  **Neon** is a company that runs the database (Postgres) where all of that is stored.
- **UptimeRobot** just visits LORE every 5 minutes. On the free plan Render puts an app to sleep after
  15 quiet minutes; these visits keep it awake so it opens instantly.

All three have free plans, you sign in to them with your GitHub account, and none asks for a card
(as far as we know; tell Claude if one does). Everything below works from a phone browser.

Three free services, all signed into with your GitHub account. No payment card.

| Piece | Service | Free limits that matter |
|---|---|---|
| App (API + web app) | **Render** web service | 512 MB RAM; sleeps after 15 idle minutes (about a minute to wake); 750 hours/month, enough for one app around the clock |
| Database (and photos) | **Neon** Postgres | 1 GB per project (photos are resized on the phone, so a few thousand fit) |
| Keep it awake | **UptimeRobot** | checks every 5 minutes, which also stops Render from sleeping |

Prerequisite: the code is on GitHub (private repo `LORE`).

## 1. Database: Neon (2 minutes)
1. Sign in at **neon.com** with GitHub.
2. Create a project named `lore`, Postgres 17 or 18, region **AWS Europe (Frankfurt)**.
3. On the dashboard, **Connect** → copy the connection string. It looks like
   `postgresql://neondb_owner:…@ep-….eu-central-1.aws.neon.tech/neondb?sslmode=require`.

## 2. App: Render (5 minutes + first build ~5–10 minutes)
1. Sign in at **render.com** with GitHub and allow access to the `LORE` repo.
2. **New → Web Service** → choose `LORE`. **Language:** Docker. **Instance type:** Free.
3. Under **Environment Variables**, add one: key `DATABASE_URL`, value = the Neon connection string.
   That's the only setting: on Render, LORE picks the right defaults itself (photos in the database,
   lighter password hashing, proxy settings).
4. **Deploy** and wait until it says **Live**. Your app is at `https://lore-xxxx.onrender.com`
   (shown at the top of the service page). Open it and create your account.
5. Check `https://lore-xxxx.onrender.com/api/health`: it must say `"database":"postgres"`. If it says
   `"embedded"`, `DATABASE_URL` is missing, and data would be lost on the next restart.

(Alternative: **New → Blueprint** reads `render.yaml` from the repo and asks for `DATABASE_URL`.)

Every push to `main` on GitHub redeploys automatically.

## 3. Keep it awake: UptimeRobot (2 minutes)
1. Sign up at **uptimerobot.com** (free plan).
2. **New monitor** → HTTP(s) → URL `https://lore-xxxx.onrender.com/api/health`, every **5 minutes**.

## 4. Tell Claude the address
With the `onrender.com` address, Claude builds the signed Android app that talks to it:
`node tools/android.mjs release --api https://lore-xxxx.onrender.com`.

## Good to know
- Render's free tier restarts the app now and then; nothing is lost, since everything lives in Neon.
- Free Neon databases pause after 5 idle minutes and wake in under a second.
- Backups: Neon keeps a restore history (point-in-time restore window on the free plan). For your own
  copy, `pg_dump "<connection string>" -Fc -f lore.dump` from any machine with Postgres tools.
- When LORE outgrows this (photos near 1 GB, or more speed), move to paid tiers or the Oracle setup in
  `deploy/oracle/` without changing code.
