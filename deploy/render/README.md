# Putting LORE online for free, no card (Render + Neon)

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
2. **New → Blueprint** → choose `LORE`. Render reads `render.yaml` from the repo.
3. When it asks for `DATABASE_URL`, paste the Neon connection string. Apply.
4. Wait for the first deploy to finish. Your app is at `https://lore-xxxx.onrender.com`
   (shown at the top of the service page). Open it and create your account.

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
