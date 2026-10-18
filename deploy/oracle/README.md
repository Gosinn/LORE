# Putting LORE online for free (Oracle Cloud Always Free)

You do steps 1–4 (sign-ups and clicks only, about 30 minutes). Step 5 is run from the
development machine. Cost: €0. Oracle asks for a card to verify you're a person; the
Always Free resources used here are not charged.

## 1. Oracle Cloud account
1. Sign up at **cloud.oracle.com** (Free Tier). Pick a **home region** close to your users
   (e.g. *Germany Central (Frankfurt)* or *UK South (London)*); it can't be changed later.
2. Wait for the "account ready" email.

## 2. Create the server
In the Oracle console: **Compute → Instances → Create instance**.
- **Name:** `lore`
- **Image:** Canonical **Ubuntu 24.04** (not "Oracle Linux")
- **Shape:** Change shape → **Ampere** → `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB memory**
  (shows "Always Free-eligible")
- **Networking:** keep the defaults (new virtual cloud network, **assign a public IPv4 address**)
- **SSH keys:** choose *Paste public keys* and paste this line exactly:

  ```
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK60sX5A0rfRIf7aOJxxd9XoWgCkutwHJPqkVQ2rb9CA lore-deploy
  ```
- **Boot volume:** default is fine (up to 200 GB total is free).
- Click **Create**. When it's *Running*, note the **Public IP address**.

If it says *Out of capacity* for Ampere, try again later or pick another availability
domain. This is common and temporary.

## 3. Open the web ports
Instance page → **Subnet** link → **Security Lists** → *Default Security List* →
**Add Ingress Rules** (twice):
- Source CIDR `0.0.0.0/0`, TCP, destination port **80**
- Source CIDR `0.0.0.0/0`, TCP, destination port **443**

## 4. A free web address (DuckDNS)
1. Sign in at **duckdns.org** (GitHub or Google login).
2. Add a subdomain, e.g. `lore-yourname` → you get `lore-yourname.duckdns.org`.
3. Put the server's **public IP** in its *current ip* field and click *update ip*.

## 5. Tell Claude the IP and the domain
That's all that's needed. From the development machine, the rest is:

```bash
# one-time server setup (Docker, firewall, secrets, deploy hook)
scp -i D:/LORE-devenv/ssh/lore_oracle deploy/oracle/server-setup.sh ubuntu@<IP>:
ssh -i D:/LORE-devenv/ssh/lore_oracle ubuntu@<IP> bash server-setup.sh lore-yourname.duckdns.org

# every deploy afterwards
git remote add oracle ubuntu@<IP>:lore.git     # once
git push oracle main
```

The first deploy builds the image on the server (a few minutes), then LORE is live at
`https://lore-yourname.duckdns.org` with a real HTTPS certificate.

## What runs on the server
`deploy/oracle/docker-compose.yml`: **Caddy** (HTTPS, renews certificates itself) →
**LORE** (API + web app) → **Postgres 18**. Photos are stored in a Docker volume. A
**backup** container writes a compressed database dump every night to `~/lore-backups`
and keeps two weeks.

Secrets (database password, photo-link signing key) are generated on the server in
`~/lore-config/.env` and never leave it.

## Day-to-day
- Logs: `ssh … ubuntu@<IP> "cd lore/deploy/oracle && docker compose --env-file ~/lore-config/.env logs -f app"`
- Restore a backup: `pg_restore -h … -U lore -d lore --clean <file>` from inside the `db` container.
- Updates to Ubuntu: `sudo apt-get upgrade` now and then (or enable unattended-upgrades).
