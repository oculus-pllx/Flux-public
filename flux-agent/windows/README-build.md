# Building the Windows Flux Agent Installer

## Prerequisites

- **NSIS 3.x** — [nsis.sourceforge.io](https://nsis.sourceforge.io/Download)
  - Windows: download the installer and add NSIS to PATH
  - Linux/macOS: `apt install nsis` / `brew install nsis`
- **Node.js 18+** on the build machine (for preparing agent files)

## Prepare Agent Files

Before building, copy the agent files into `flux-agent/windows/dist/`:

```bash
# From repo root
mkdir -p flux-agent/windows/dist
cp -r flux-agent/agent.js flux-agent/services/ flux-agent/package.json \
      flux-agent/windows/dist/
cd flux-agent/windows/dist && npm ci --production
```

## Build the Installer

```bash
cd flux-agent/windows
makensis flux-agent-setup.nsi
```

Output: `flux-agent/windows/flux-agent-setup.exe`

## Build via Docker (Linux/macOS, no NSIS install needed)

```bash
# Prepare dist first (see above), then:
docker run --rm \
  -v "$(pwd)/flux-agent/windows:/work" \
  nsis/nsis:latest \
  makensis /work/flux-agent-setup.nsi
```

## Bundling Node.js (self-contained installer)

To make the installer self-contained (not require Node.js pre-installed), download
the Node.js 18 Windows binary and bundle it:

```bash
# Download node.exe
curl -fsSL https://nodejs.org/dist/v18.20.4/node-v18.20.4-win-x64.zip -o node.zip
unzip node.zip node-v18.20.4-win-x64/node.exe
mv node-v18.20.4-win-x64/node.exe flux-agent/windows/dist/node.exe
```

Then change the NSIS script's service creation from:
```nsi
"\"$NodePath\node.exe\" \"$INSTDIR\agent.js\""
```
to:
```nsi
"\"$INSTDIR\node.exe\" \"$INSTDIR\agent.js\""
```
And remove the `.onInit` Node.js check function.

## Testing

1. Build the installer
2. Run `flux-agent-setup.exe` in a Windows 10/11 VM
3. Enter your Flux server URL and an enrollment token
4. Verify the `FluxAgent` service appears in `services.msc`
5. Check `C:\ProgramData\flux-agent\config.json` was written correctly
6. In Flux dashboard → Machines: confirm the agent appears as `pending` then `online`

## CI Build (GitHub Actions)

```yaml
jobs:
  build-windows-installer:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install NSIS
        run: choco install nsis
      - name: Prepare agent dist
        shell: bash
        run: |
          mkdir -p flux-agent/windows/dist
          cp -r flux-agent/agent.js flux-agent/services flux-agent/package.json \
                flux-agent/windows/dist/
          cd flux-agent/windows/dist && npm ci --production
      - name: Build installer
        run: makensis flux-agent/windows/flux-agent-setup.nsi
      - uses: actions/upload-artifact@v4
        with:
          name: flux-agent-setup
          path: flux-agent/windows/flux-agent-setup.exe
```
