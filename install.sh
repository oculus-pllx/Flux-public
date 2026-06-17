#!/usr/bin/env bash
# Flux Server Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/oculus-pllx/Flux/main/install.sh | bash
# Or:    bash install.sh
set -euo pipefail

REPO="oculus-pllx/Flux"
RELEASE_API="https://api.github.com/repos/${REPO}/releases/latest"
SERVICE_NAME="flux"
INSTALL_DIR="/opt/flux"
CONFIG_DIR="/etc/flux"
DATA_DIR="/var/lib/flux"
SYSTEMD_UNIT="/lib/systemd/system/flux.service"
FLUX_USER="flux"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[flux]${NC} $*"; }
success() { echo -e "${GREEN}[flux]${NC} $*"; }
warn()    { echo -e "${YELLOW}[flux]${NC} $*"; }
die()     { echo -e "${RED}[flux] ERROR:${NC} $*" >&2; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "This installer must be run as root. Try: sudo bash install.sh"; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }

detect_os() {
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-}"
    OS_PRETTY="${PRETTY_NAME:-$OS_ID}"
  else
    OS_ID="unknown"
    OS_VERSION=""
    OS_PRETTY="Unknown Linux"
  fi
  ARCH="$(uname -m)"
  info "Detected: ${OS_PRETTY} (${ARCH})"
}

fetch_latest_version() {
  info "Fetching latest Flux release..."
  require_cmd curl
  LATEST_TAG=$(curl -fsSL "$RELEASE_API" | grep -oE '"tag_name":\s*"[^"]+"' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [ -n "$LATEST_TAG" ] || die "Could not fetch latest release from GitHub."
  LATEST_VERSION="${LATEST_TAG#v}"
  info "Latest version: ${LATEST_VERSION}"
}

install_deb() {
  local deb_url="https://github.com/${REPO}/releases/download/${LATEST_TAG}/flux_${LATEST_VERSION}_amd64.deb"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap "rm -rf ${tmp_dir}" EXIT

  info "Downloading flux_${LATEST_VERSION}_amd64.deb..."
  curl -fsSL -o "${tmp_dir}/flux.deb" "$deb_url" || die "Download failed: ${deb_url}"

  info "Installing .deb package..."
  DEBIAN_FRONTEND=noninteractive dpkg -i "${tmp_dir}/flux.deb" || true
  # Resolve any missing dependencies
  apt-get install -f -y || die "Dependency resolution failed."

  configure_env
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl start  "${SERVICE_NAME}"
  install_updater
  success "Flux ${LATEST_VERSION} installed and started."
  print_info
}

# Enable one-click self-updates: a root-owned path unit watches
# ${DATA_DIR}/update-requested (written by the unprivileged backend)
# and runs /opt/flux/bin/flux-update.sh.
install_updater() {
  info "Installing self-update helper..."
  mkdir -p "${INSTALL_DIR}/bin"
  if [ -f "${INSTALL_DIR}/installer/linux/flux-update.sh" ]; then
    cp "${INSTALL_DIR}/installer/linux/flux-update.sh"      "${INSTALL_DIR}/bin/flux-update.sh"
    cp "${INSTALL_DIR}/installer/linux/flux-updater.service" /lib/systemd/system/
    cp "${INSTALL_DIR}/installer/linux/flux-updater.path"    /lib/systemd/system/
  elif [ ! -f /lib/systemd/system/flux-updater.path ]; then
    # Older .deb without bundled updater files — skip; next release fixes this
    warn "Updater units not found; one-click updates disabled until next manual update."
    return
  fi
  chmod 755 "${INSTALL_DIR}/bin/flux-update.sh" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now flux-updater.path
  touch "${DATA_DIR}/.updater-installed"
  chown "${FLUX_USER}:${FLUX_USER}" "${DATA_DIR}/.updater-installed"
}

install_from_source() {
  info "Installing from source (non-Debian/Ubuntu or non-amd64 path)..."
  require_cmd git

  # Install Node.js 18 via nvm if not present or too old
  if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v(1[89]|[2-9][0-9])'; then
    info "Installing Node.js 18 via nvm..."
    export NVM_DIR="/root/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm install 18
    nvm use 18
    nvm alias default 18
    NODE_BIN="$(nvm which 18)"
    # Symlink to /usr/local/bin for system-wide access (flux user has no nvm)
    ln -sf "$NODE_BIN" /usr/local/bin/node
    NODE_BIN="/usr/local/bin/node"
  else
    NODE_BIN="$(command -v node)"
    info "Using existing Node.js $(node --version) at ${NODE_BIN}"
    # If node is nvm-managed, create system-wide symlink for flux user
    if echo "$NODE_BIN" | grep -q '\.nvm'; then
      ln -sf "$NODE_BIN" /usr/local/bin/node
      NODE_BIN="/usr/local/bin/node"
    fi
  fi

  # Clone or update repo
  if [ -d "${INSTALL_DIR}/.git" ]; then
    info "Updating existing installation at ${INSTALL_DIR}..."
    git -C "${INSTALL_DIR}" pull
  else
    info "Cloning repository to ${INSTALL_DIR}..."
    git clone "https://github.com/${REPO}.git" "${INSTALL_DIR}"
  fi

  # Install dependencies
  info "Installing backend dependencies..."
  cd "${INSTALL_DIR}/backend" && npm ci --production

  info "Installing frontend dependencies and building..."
  cd "${INSTALL_DIR}/frontend" && npm ci
  npm run build

  # Copy frontend dist into backend for serving
  mkdir -p "${INSTALL_DIR}/backend/public"
  cp -r "${INSTALL_DIR}/frontend/dist/." "${INSTALL_DIR}/backend/public/"

  # Create flux user
  if ! id -u "${FLUX_USER}" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /sbin/nologin "${FLUX_USER}"
  fi

  # Create data + config dirs
  mkdir -p "${CONFIG_DIR}" "${DATA_DIR}"
  chown "${FLUX_USER}:${FLUX_USER}" "${DATA_DIR}"
  chmod 750 "${DATA_DIR}"

  configure_env

  # Write systemd unit
  cat > "${SYSTEMD_UNIT}" << UNIT
[Unit]
Description=Flux UPS Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=${NODE_BIN} server.js
EnvironmentFile=${CONFIG_DIR}/.env
Restart=always
RestartSec=5
User=${FLUX_USER}

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl start  "${SERVICE_NAME}"
  install_updater
  success "Flux installed from source and started."
  print_info
}

configure_env() {
  mkdir -p "${CONFIG_DIR}"
  if [ -f "${CONFIG_DIR}/.env" ]; then
    warn ".env already exists at ${CONFIG_DIR}/.env — skipping prompt. Edit it manually if needed."
    return
  fi

  info "Configuring Flux..."
  local jwt_secret port
  jwt_secret="$(openssl rand -hex 32 2>/dev/null || dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n' | head -c 64)"
  read -rp "  Port [5174]: " port
  port="${port:-5174}"

  cat > "${CONFIG_DIR}/.env" << ENV
NODE_ENV=production
PORT=${port}
JWT_SECRET=${jwt_secret}
DB_PATH=${DATA_DIR}/flux.db
ENV

  chmod 600 "${CONFIG_DIR}/.env"
  success ".env written to ${CONFIG_DIR}/.env"
}

print_info() {
  local port
  port="$(grep '^PORT=' "${CONFIG_DIR}/.env" 2>/dev/null | cut -d= -f2)"
  port="${port:-5174}"
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN} Flux is running!${NC}"
  echo -e "${GREEN} API:  http://$(hostname -I | awk '{print $1}'):${port}/api/health${NC}"
  echo -e "${GREEN} Logs: journalctl -u flux -f${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
}

main() {
  require_root
  detect_os
  fetch_latest_version

  if [[ "$OS_ID" == "debian" ]] || [[ "$OS_ID" == "ubuntu" ]]; then
    if [[ "$ARCH" == "x86_64" ]]; then
      install_deb
    else
      install_from_source
    fi
  else
    install_from_source
  fi
}

main "$@"
