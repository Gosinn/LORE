#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Oracle Cloud Always Free, Ampere).
# Run as the default `ubuntu` user:   bash server-setup.sh lore-yourname.duckdns.org
#
# Afterwards, deploying is: git push oracle main   (from the development machine)
set -euo pipefail

DOMAIN="${1:?Usage: bash server-setup.sh <domain, e.g. lore-yourname.duckdns.org>}"

echo "== Packages (Docker, git, firewall persistence)"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 git iptables-persistent
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "== Firewall: Oracle's Ubuntu image only allows SSH; open HTTP and HTTPS"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save

echo "== Swap (builds are memory hungry; harmless on 12 GB)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== Secrets (generated once, kept outside the code)"
mkdir -p ~/lore-config ~/lore-backups
if [ ! -f ~/lore-config/.env ]; then
  umask 077
  cat > ~/lore-config/.env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
MEDIA_URL_SECRET=$(openssl rand -hex 32)
EOF
fi

echo "== Git deploy target: pushing to ~/lore.git builds and restarts the app"
if [ ! -d ~/lore.git ]; then
  git init --bare -b main ~/lore.git
fi
cat > ~/lore.git/hooks/post-receive <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
unset GIT_DIR
mkdir -p ~/lore
git --work-tree="$HOME/lore" --git-dir="$HOME/lore.git" checkout -f main
cd ~/lore/deploy/oracle
echo "== Building and starting LORE"
sg docker -c "docker compose --env-file $HOME/lore-config/.env up -d --build --remove-orphans"
sg docker -c "docker image prune -f" >/dev/null
echo "== Deployed: https://$(grep ^DOMAIN= ~/lore-config/.env | cut -d= -f2)"
HOOK
chmod +x ~/lore.git/hooks/post-receive

echo
echo "Server ready for $DOMAIN."
echo "From the development machine:  git push oracle main"
