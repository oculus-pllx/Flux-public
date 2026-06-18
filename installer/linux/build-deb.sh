#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")
ARCH="amd64"
PKG_NAME="flux_${VERSION}_${ARCH}"
BUILD_DIR="dist-installer/${PKG_NAME}"

echo "Building ${PKG_NAME}.deb ..."

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/opt/flux/backend"
mkdir -p "$BUILD_DIR/opt/flux/frontend/dist"
mkdir -p "$BUILD_DIR/opt/flux/installer/linux"
mkdir -p "$BUILD_DIR/lib/systemd/system"

echo "Installing production dependencies..."
cd backend && npm ci --omit=dev --silent && cd ..

cp -r backend/config backend/middleware backend/models \
      backend/routes backend/services backend/utils backend/server.js \
      backend/node_modules backend/package.json \
      "$BUILD_DIR/opt/flux/backend/"

cp -r frontend/dist/. "$BUILD_DIR/opt/flux/frontend/dist/"
cp install-agent.sh "$BUILD_DIR/opt/flux/install-agent.sh"
cp installer/linux/flux.env.template "$BUILD_DIR/opt/flux/installer/linux/"
cp installer/linux/flux.service "$BUILD_DIR/lib/systemd/system/flux.service"

echo "Bundling agent installer payload..."
AGENT_BUILD=$(mktemp -d)
cp -r flux-agent/. "$AGENT_BUILD/"
rm -rf "$AGENT_BUILD/node_modules"
(cd "$AGENT_BUILD" && npm ci --omit=dev --silent)
tar czf "$BUILD_DIR/opt/flux/install-agent.tar.gz" \
  --exclude='./__tests__' \
  --exclude='./windows' \
  -C "$AGENT_BUILD" .
rm -rf "$AGENT_BUILD"

# Self-update helper: script + systemd units
mkdir -p "$BUILD_DIR/opt/flux/bin"
cp installer/linux/flux-update.sh       "$BUILD_DIR/opt/flux/bin/flux-update.sh"
cp installer/linux/flux-updater.service "$BUILD_DIR/lib/systemd/system/"
cp installer/linux/flux-updater.path    "$BUILD_DIR/lib/systemd/system/"
chmod 755 "$BUILD_DIR/opt/flux/bin/flux-update.sh"
chmod 755 "$BUILD_DIR/opt/flux/install-agent.sh"

cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: flux
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Depends: nodejs (>= 18)
Maintainer: Parallax Group <support@parallaxgroup.com>
Description: Flux UPS Monitoring Dashboard
 Connects to NUT servers, monitors UPS metrics, fires alerts,
 and SSH-shuts down connected machines on power loss.
EOF

cp installer/linux/postinst "$BUILD_DIR/DEBIAN/postinst"
cp installer/linux/prerm    "$BUILD_DIR/DEBIAN/prerm"
chmod 755 "$BUILD_DIR/DEBIAN/postinst" "$BUILD_DIR/DEBIAN/prerm"
find "$BUILD_DIR" -type d -exec chmod g-s {} \;
find "$BUILD_DIR" -type d -exec chmod 755 {} \;

dpkg-deb --build --root-owner-group "$BUILD_DIR" "dist-installer/${PKG_NAME}.deb"
echo "Built: dist-installer/${PKG_NAME}.deb"
