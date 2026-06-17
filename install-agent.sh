#!/usr/bin/env bash
set -euo pipefail

AGENT_DIR="/opt/flux-agent"
CONFIG_DIR="/etc/flux-agent"
SERVICE_NAME="flux-agent"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[flux-agent]${NC} $*"; }
warn()  { echo -e "${YELLOW}[flux-agent]${NC} $*"; }
error() { echo -e "${RED}[flux-agent]${NC} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "This script must be run as root."
[ "$(uname -s)" = "Linux" ] || error "This installer is for Linux only."

info "Flux Agent Installer"
echo ""

# Flux server URL
if [ -z "${FLUX_URL:-}" ]; then
  [ -t 0 ] || error "FLUX_URL must be set when running non-interactively."
  read -rp "Flux server URL (e.g. http://<flux-host>:7483): " FLUX_URL
fi
[ -n "$FLUX_URL" ] || error "Flux server URL is required."

# Enrollment token
if [ -z "${FLUX_TOKEN:-}" ]; then
  [ -t 0 ] || error "FLUX_TOKEN must be set when running non-interactively."
  read -rp "Enrollment token (from Flux dashboard -> Machines -> Add Machine): " FLUX_TOKEN
fi
[ -n "$FLUX_TOKEN" ] || error "Enrollment token is required."

# Role detection
if [ -n "${FLUX_ROLE:-}" ]; then
  case "$FLUX_ROLE" in
    controlled|pve-node|pbs|ups-host) ;;
    *) error "Invalid FLUX_ROLE: ${FLUX_ROLE}. Must be: controlled, pve-node, pbs, ups-host" ;;
  esac
  ROLE="$FLUX_ROLE"
  info "Role set by server: ${ROLE}"
else
  info "Detecting machine role..."
  ROLE="controlled"
  if dpkg -l pve-manager &>/dev/null 2>&1; then
    ROLE="pve-node"; warn "Detected: Proxmox VE node"
  elif dpkg -l proxmox-backup-server &>/dev/null 2>&1; then
    ROLE="pbs"; warn "Detected: Proxmox Backup Server"
  elif systemctl is-active --quiet nut-server 2>/dev/null; then
    ROLE="ups-host"; warn "Detected: UPS host (NUT server running)"
  fi
  echo ""
  if [ -t 0 ]; then
    read -rp "Detected role: ${ROLE}. Accept? [Y/n]: " CONFIRM
    CONFIRM="${CONFIRM:-Y}"
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
      echo "Available roles: controlled, pve-node, pbs, ups-host"
      read -rp "Enter role: " ROLE
    fi
  else
    info "Non-interactive: auto-accepting detected role: ${ROLE}"
  fi
fi

# Install Node.js 20 if missing or too old
NODE_BIN=""
if command -v node &>/dev/null && node --version 2>/dev/null | grep -qE '^v(1[89]|[2-9][0-9])'; then
  NODE_BIN="$(command -v node)"
  info "Using existing $(node --version)"
else
  info "Installing Node.js 20..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1
  elif command -v dnf &>/dev/null; then
    dnf install -y nodejs npm >/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    yum install -y nodejs npm >/dev/null 2>&1
  else
    error "Cannot install Node.js automatically. Please install Node.js 18+ and retry."
  fi
  NODE_BIN="$(command -v node)"
  info "Installed $(node --version)"
fi

# Download and extract agent bundle from Flux server
info "Downloading agent bundle..."
rm -rf "${AGENT_DIR}"
mkdir -p "${AGENT_DIR}"
curl -fsSL "${FLUX_URL}/install-agent.tar.gz" | tar xz -C "${AGENT_DIR}"

# Write config
info "Writing config..."
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
cat > "${CONFIG_DIR}/config.json" <<CONFIG
{
  "fluxUrl": "${FLUX_URL}",
  "enrollmentToken": "${FLUX_TOKEN}",
  "role": "${ROLE}"
}
CONFIG
chmod 600 "${CONFIG_DIR}/config.json"

# Install systemd service
info "Installing systemd service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Flux UPS Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${AGENT_DIR}/agent.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# First run: enroll (exits after saving machineKey, then service starts normally)
info "Enrolling with Flux server..."
"${NODE_BIN}" "${AGENT_DIR}/agent.js" || true

# Restart service so re-installs pick up rewritten config and agent bundle
systemctl restart "${SERVICE_NAME}"
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  info "flux-agent is running. Machine will appear in Flux dashboard momentarily."
else
  warn "Service may need a moment to start. Check: journalctl -u flux-agent -f"
fi

echo ""
info "Installation complete!"
info "Commands:"
info "  Status:  systemctl status flux-agent"
info "  Logs:    journalctl -u flux-agent -f"
info "  Restart: systemctl restart flux-agent"
