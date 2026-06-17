#!/usr/bin/env bash
# Flux self-update helper. Runs as root via flux-updater.service, which is
# fired by flux-updater.path when /var/lib/flux/update-requested appears.
set -euo pipefail

DATA_DIR="/var/lib/flux"
LOG="${DATA_DIR}/update.log"
STATUS="${DATA_DIR}/update-status.json"
INSTALL_DIR="/opt/flux"
REPO="oculus-pllx/Flux-public"
SERVICE="flux"

rm -f "${DATA_DIR}/update-requested"
exec >>"$LOG" 2>&1
echo "=== flux-update started $(date -Is) ==="

write_status() {
  printf '{"state":"%s","message":"%s","at":"%s"}\n' "$1" "$2" "$(date -Is)" > "$STATUS"
  chown flux:flux "$STATUS" "$LOG" 2>/dev/null || true
}
trap 'write_status failed "update script failed — see update.log"' ERR
write_status running "update in progress"

if dpkg -s flux >/dev/null 2>&1; then
  echo "deb-managed install: fetching latest release"
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -oE '"tag_name":\s*"[^"]+"' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [ -n "$TAG" ] || { write_status failed "could not resolve latest release tag"; exit 1; }
  VER="${TAG#v}"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL -o "${TMP}/flux.deb" \
    "https://github.com/${REPO}/releases/download/${TAG}/flux_${VER}_amd64.deb"
  DEBIAN_FRONTEND=noninteractive dpkg -i "${TMP}/flux.deb" || apt-get install -f -y
elif [ -d "${INSTALL_DIR}/.git" ]; then
  echo "source install: pulling and rebuilding"
  git -C "$INSTALL_DIR" pull
  (cd "${INSTALL_DIR}/backend" && npm ci --omit=dev)
  (cd "${INSTALL_DIR}/frontend" && npm ci && npm run build)
  mkdir -p "${INSTALL_DIR}/backend/public"
  cp -r "${INSTALL_DIR}/frontend/dist/." "${INSTALL_DIR}/backend/public/"
else
  write_status failed "no dpkg package or git checkout found at ${INSTALL_DIR}"
  exit 1
fi

systemctl restart "$SERVICE"
write_status success "updated and restarted"
echo "=== flux-update finished $(date -Is) ==="
