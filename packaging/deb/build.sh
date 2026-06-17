#!/usr/bin/env bash
# Build the Flux .deb package
# Usage: bash packaging/deb/build.sh
# Requires: dpkg-deb, curl, npm
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT="${SCRIPT_DIR}/root"
VERSION="$(node -p "require('${REPO_ROOT}/backend/package.json').version")"
DEB_OUT="${REPO_ROOT}/flux_${VERSION}_amd64.deb"

NODE_VERSION="18.20.4"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"
NODE_DIR="${ROOT}/opt/flux/node"

echo "==> Building Flux .deb v${VERSION}"

# 1. Bundle Node.js 18 binary
echo "==> Downloading Node.js ${NODE_VERSION}..."
mkdir -p "${NODE_DIR}"
TMP=$(mktemp -d)
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$TMP" "$BUILD_DIR"' EXIT
curl -fsSL -o "${TMP}/node.tar.gz" "${NODE_URL}"
tar xzf "${TMP}/node.tar.gz" -C "${NODE_DIR}" --strip-components=1

echo "    Node.js bundled at ${NODE_DIR}"

# 2. Build frontend
echo "==> Building frontend..."
cd "${REPO_ROOT}/frontend"
npm ci --silent
npm run build --silent

# 3. Copy app files
echo "==> Copying app files..."
APP="${ROOT}/opt/flux"
mkdir -p "${APP}/backend" "${APP}/frontend"
cp -r "${REPO_ROOT}/backend/." "${APP}/backend/"
cp -r "${REPO_ROOT}/frontend/dist/." "${APP}/backend/public/"

# Install production backend deps inside the package
echo "==> Installing backend production dependencies..."
cd "${APP}/backend"
npm ci --omit=dev --silent

# Remove dev tooling from the package
rm -rf "${APP}/backend/__tests__"
rm -f  "${APP}/backend/.env" "${APP}/backend/data/*.db" 2>/dev/null || true

# Self-update helper: script + systemd units
mkdir -p "${APP}/bin"
cp "${REPO_ROOT}/installer/linux/flux-update.sh"      "${APP}/bin/flux-update.sh"
cp "${REPO_ROOT}/installer/linux/flux-updater.service" "${ROOT}/lib/systemd/system/"
cp "${REPO_ROOT}/installer/linux/flux-updater.path"    "${ROOT}/lib/systemd/system/"
chmod 755 "${APP}/bin/flux-update.sh"
chmod 644 "${ROOT}/lib/systemd/system/flux-updater.service" "${ROOT}/lib/systemd/system/flux-updater.path"

# 4. Copy DEBIAN metadata to build dir and update version
cp -r "${ROOT}/." "${BUILD_DIR}/"
sed -i "s/^Version:.*/Version: ${VERSION}/" "${BUILD_DIR}/DEBIAN/control"

# 5. Set permissions
find "${ROOT}" -type f -name "*.sh" -exec chmod 755 {} \;
chmod 755 "${ROOT}/DEBIAN/postinst" "${ROOT}/DEBIAN/prerm"
chmod 644 "${ROOT}/lib/systemd/system/flux.service"
chmod 644 "${ROOT}/etc/flux/.env.example"
# Empty data dir must exist in package skeleton (directory only — no files)
mkdir -p "${ROOT}/var/lib/flux"

# 6. Build
echo "==> Running dpkg-deb..."
dpkg-deb --build "${BUILD_DIR}" "${DEB_OUT}"
echo ""
echo "==> Built: ${DEB_OUT}"
echo "    Install with: dpkg -i ${DEB_OUT}"
