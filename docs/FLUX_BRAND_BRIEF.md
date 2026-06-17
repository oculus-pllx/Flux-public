# Flux — Brand Implementation Brief for CC
> This document is the authoritative implementation reference for applying the Parallax Group
> brand to the Flux codebase. It was produced in a design session and supersedes any prior
> naming, color, or typographic decisions made during the initial build.
>
> **Use this document alongside `Pllx_group_BRAND.md` which lives in the project root.**
> The brand doc is the ecosystem reference. This doc is the Flux-specific implementation spec.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| Project name | Flux |
| Tagline | NUT UPS Management — Single Pane of Glass |
| Attribution | Flux by Parallax Group |
| Accent color | Orange `#f97316` |
| Repository | `github.com/pllx/flux` |
| Docker image | `pllx/flux` |
| npm scope | `@pllx/flux` |

**Every instance of the old working name `nut-monitor` must be replaced with `flux` (lowercase)
in code, filenames, Docker config, package.json, and documentation. The human-readable name
is `Flux` (capitalised). Never `NUT Monitor`, `nut-monitor`, or any other variant.**

---

## 2. Component Taxonomy

These are the canonical names for every major system within Flux. Use them consistently in:
- Code comments and file headers
- Documentation and README references
- Variable names where they appear as system identifiers
- Any UI text that refers to internal systems

| Canonical Name | Role | Maps To |
|----------------|------|---------|
| **Conduit** | React/Vite frontend SPA | `/frontend` |
| **Core** | Node.js/Express backend | `/backend` |
| **Cycle** | Background polling engine | `services/pollingService.js` |
| **Surge** | Alert evaluation + dispatch | `services/alertService.js` |
| **Tap** | NUT client / server connection | `services/nutService.js` |
| **Signal** | Email/notification delivery | `services/emailService.js` |
| **Lock** | JWT auth + role middleware | `middleware/auth.js` |
| **Stratum** | SQLite/Sequelize data layer | `config/database.js` + `models/` |

**These names do not replace technical file names** (keep `pollingService.js` etc.) but should
appear in file header comments, README sections, and any UI copy that references these systems.

Example file header comment:
```js
/**
 * Cycle — Background polling engine
 * Fetches metrics from all registered NUT servers on a configurable interval.
 * Part of the Flux monitoring stack · Flux by Parallax Group
 */
```

---

## 3. Design System

### 3.1 Color Palette

Replace all Tailwind default color references (`slate-*`, `gray-*`, `emerald-*` etc.) with
these CSS custom properties. Define them in the root stylesheet and reference them throughout.

```css
:root {
  /* Base */
  --flux-bg:        #08090b;   /* Near-black — page background */
  --flux-panel:     #101216;   /* Dark panel — cards, sidebars */
  --flux-border:    rgba(255, 255, 255, 0.05); /* Subtle borders */

  /* Text */
  --flux-text:      #e2e8f0;   /* Primary text */
  --flux-muted:     #64748b;   /* Secondary text */
  --flux-dim:       #3e4555;   /* Tertiary / labels */

  /* Accent */
  --flux-accent:    #f97316;   /* Flux orange — interactive, highlighted */
  --flux-glow:      rgba(249, 115, 22, 0.15); /* Accent glow for hover/focus */

  /* Status */
  --flux-healthy:   #10b981;   /* OK / online / active */
  --flux-warning:   #f59e0b;   /* Warning state */
  --flux-critical:  #f43f5e;   /* Critical / error / offline */
}
```

**Glow effects** (`box-shadow` or `drop-shadow` using `--flux-glow`) are used **only** on:
- Interactive elements on hover/focus
- Status indicators that are actively alerting
- The accent-colored Parallax Shift mark

No gradients on text. No decorative glows. Every use of color is purposeful.

### 3.2 Typography

Load all three fonts from Google Fonts. Add to the HTML `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
```

| Font | Weight | Apply To |
|------|--------|----------|
| Syne | 600–800 | Headings, wordmark "Flux", page titles, nav labels, metric labels |
| IBM Plex Mono | 400–600 | All metric values, data readouts, UPS variable values, timestamps, version strings |
| IBM Plex Sans | 400–500 | Body copy, descriptions, alert messages, prose, form labels |

**Never use system fonts or Tailwind's default font stack for visible UI text.**

Add to `tailwind.config.js`:
```js
theme: {
  extend: {
    fontFamily: {
      display: ['Syne', 'sans-serif'],
      mono: ['IBM Plex Mono', 'monospace'],
      sans: ['IBM Plex Sans', 'sans-serif'],
    }
  }
}
```

---

## 4. The Parallax Shift Mark

The Parallax Shift mark is an SVG component. It must be implemented as a reusable React
component: `<ParallaxMark size={n} />`. The mark color is always Flux orange `#f97316`.

### 4.1 Mark Construction

The mark consists of:
- **Front chevron**: 90% opacity, slightly larger, offset forward (translate -1px, -1px)
- **Back chevron**: 30% opacity, slightly smaller, offset back (translate +2px, +2px)
- **Depth connectors**: 15% opacity, `stroke-dasharray="2 2"`, connecting the two chevron tips
  — rendered only when `size >= 32`

### 4.2 Reference SVG Implementation

```jsx
// components/ParallaxMark.jsx
export function ParallaxMark({ size = 24 }) {
  const showConnectors = size >= 32;
  const color = '#f97316';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Flux by Parallax Group"
    >
      {/* Back chevron — 30% opacity, offset back */}
      <polyline
        points="6,26 16,8 26,26"
        stroke={color}
        strokeWidth="2.5"
        strokeOpacity="0.30"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform="translate(2, 2) scale(0.88)"
      />

      {/* Depth connectors — only at >= 32px */}
      {showConnectors && (
        <>
          <line
            x1="6" y1="26" x2="7.3" y2="24.2"
            stroke={color}
            strokeOpacity="0.15"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="26" y1="26" x2="24.7" y2="24.2"
            stroke={color}
            strokeOpacity="0.15"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        </>
      )}

      {/* Front chevron — 90% opacity, offset forward */}
      <polyline
        points="6,26 16,8 26,26"
        stroke={color}
        strokeWidth="2.5"
        strokeOpacity="0.90"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform="translate(-1, -1)"
      />
    </svg>
  );
}
```

Adjust the SVG geometry to achieve clean visual offset between the two chevron planes.
The exact pixel values above are a starting reference — tune for visual quality.

---

## 5. Mark Placement Rules

### 5.1 Navbar
- Compact variant: `<ParallaxMark size={24} />`
- Followed immediately by wordmark: **"Flux"** in `font-display` (Syne), weight 700, color `--flux-text`
- No subtitle in the navbar
- Minimum clearance around the mark: 1× the chevron arm width (~4px at 24px size)

```jsx
// Navbar brand lockup
<div className="flex items-center gap-2">
  <ParallaxMark size={24} />
  <span className="font-display font-bold text-lg tracking-wide">Flux</span>
</div>
```

### 5.2 Login Screen
- Full variant: `<ParallaxMark size={48} />` (or larger, centered)
- Wordmark: **"Flux"** in Syne 800, large (text-4xl or text-5xl)
- Attribution beneath wordmark: **"by Parallax Group"** in IBM Plex Sans 400,
  color `--flux-muted`, smaller (text-sm)
- Mark + wordmark + attribution centered vertically above the login form

```jsx
// Login screen brand block
<div className="flex flex-col items-center gap-3 mb-8">
  <ParallaxMark size={48} />
  <div className="flex flex-col items-center gap-1">
    <span className="font-display font-extrabold text-5xl tracking-tight">Flux</span>
    <span className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
      by Parallax Group
    </span>
  </div>
</div>
```

### 5.3 Footer
- Text only — no mark in the footer
- Content: **"Flux by Parallax Group © 2026"**
- Font: IBM Plex Sans 400, color `--flux-dim`
- Centered or left-aligned depending on layout

```jsx
<footer>
  <span className="font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>
    Flux by Parallax Group © 2026
  </span>
</footer>
```

---

## 6. Light/Dark Mode

**Dark mode only.** The light/dark toggle introduced in the original build must be
**removed entirely** — not hidden, not disabled, removed. This includes:

- The toggle UI element (button, switch, icon)
- The toggle state (useState, localStorage key, class toggling)
- Any `light:` Tailwind variant classes
- Any conditional color logic based on theme state

The Parallax Group light mode palette has not yet been defined at the ecosystem level.
Light mode for Flux will be implemented when the ecosystem palette is released.

The app background is always `--flux-bg` (`#08090b`).

---

## 7. Aesthetic Rules

These apply throughout Conduit (the frontend). They derive from the Parallax Group
brand aesthetic: **60s mission control / cosmic**.

- **Borders**: Use `--flux-border` (`rgba(255,255,255,0.05)`). Borders should be barely
  visible — structural, not decorative.
- **Panels/Cards**: Background `--flux-panel` (`#101216`). No heavy shadows.
  A subtle border is sufficient to define edges.
- **Accent use**: Orange `--flux-accent` is reserved for interactive elements (buttons,
  links, active states), the brand mark, and highlighted/alerting status. Do not use it
  decoratively.
- **Metric values**: Always render in IBM Plex Mono. Numbers on a dashboard are data,
  not copy.
- **Glow**: Only on hover/focus states and active alert indicators. Use `--flux-glow`
  (`rgba(249, 115, 22, 0.15)`) as `box-shadow` or `drop-shadow`.
- **No text gradients**: Do not apply gradient fills to any text.
- **Status colors**: Use `--flux-healthy`, `--flux-warning`, `--flux-critical` exclusively
  for device/UPS status states. Do not repurpose them for decoration.

---

## 8. Naming & String Replacements

The following find-and-replace operations must be applied across the entire codebase,
including source files, config files, documentation, and comments.

| Find | Replace With | Scope |
|------|-------------|-------|
| `nut-monitor` | `flux` | All files |
| `NUT Monitor` | `Flux` | All files |
| `NUT UPS Monitor` | `Flux` | All files |
| `nut_monitor` | `flux` | All files |
| `NutMonitor` | `Flux` | All files |
| `pllx/nut-monitor` | `pllx/flux` | Docker config |
| `nut-monitor-backend` | `flux-backend` | docker-compose.yml |
| `nut-monitor-frontend` | `flux-frontend` | docker-compose.yml |
| `"name": "nut-monitor"` | `"name": "flux"` | package.json files |
| `container_name: nut-monitor` | `container_name: flux` | docker-compose.yml |

After replacements, verify no instance of `nut-monitor` or `NUT Monitor` remains
in any user-facing string, config value, or code comment.

---

## 9. Docker & Package Conventions

Following Parallax Group developer conventions:

**docker-compose.yml service names:**
```yaml
services:
  flux-backend:
    container_name: flux-backend
    image: pllx/flux-backend
    ...
  flux-frontend:
    container_name: flux-frontend
    image: pllx/flux-frontend
    ...
```

**package.json (root):**
```json
{
  "name": "@pllx/flux",
  "version": "1.0.0",
  "description": "NUT UPS Management — Single Pane of Glass"
}
```

**package.json (backend):**
```json
{
  "name": "@pllx/flux-core"
}
```

**package.json (frontend):**
```json
{
  "name": "@pllx/flux-conduit"
}
```

---

## 10. Native Install Support

In addition to Docker, Flux must support a native install path for users running
directly on Linux, macOS, or Windows (via Git Bash / WSL2).

### 10.1 PM2 Process Manager

The backend (Core) should run under PM2 in native installs. Add the following:

**`ecosystem.config.js` in `/backend`:**
```js
module.exports = {
  apps: [
    {
      name: 'flux-core',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5000
      }
    }
  ]
};
```

### 10.2 Install Script

Create `/install.sh` (Linux/macOS) for native installation:

```bash
#!/bin/bash
# Flux — Native Install Script
# Flux by Parallax Group · github.com/pllx/flux

set -e

echo "🔋 Flux — Installing..."

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install Node.js 18+ and try again."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi

# Install dependencies
echo "📦 Installing backend dependencies..."
cd backend && npm install --production && cd ..

echo "📦 Installing frontend dependencies..."
cd frontend && npm install && cd ..

# Build frontend
echo "🔨 Building Conduit (frontend)..."
cd frontend && npm run build && cd ..

# Copy env if not present
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚙️  .env created — edit before starting"
fi

echo ""
echo "✅ Flux installed successfully."
echo ""
echo "Next steps:"
echo "  1. Edit .env with your configuration"
echo "  2. Run: npm start   (or: pm2 start backend/ecosystem.config.js)"
echo "  3. Open: http://localhost:5000"
echo ""
echo "Flux by Parallax Group"
```

### 10.3 Start/Stop Scripts

Add to root `package.json` scripts:
```json
{
  "scripts": {
    "start":        "pm2 start backend/ecosystem.config.js",
    "stop":         "pm2 stop flux-core",
    "restart":      "pm2 restart flux-core",
    "logs":         "pm2 logs flux-core",
    "status":       "pm2 status",
    "install:deps": "cd backend && npm install && cd ../frontend && npm install",
    "build":        "cd frontend && npm run build",
    "dev:backend":  "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev"
  }
}
```

### 10.4 Systemd Service (Linux production)

Create `/flux.service` as a reference systemd unit file:
```ini
[Unit]
Description=Flux — NUT UPS Management by Parallax Group
After=network.target

[Service]
Type=simple
User=flux
WorkingDirectory=/opt/flux/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 10.5 Windows (Git Bash / WSL2)

Create `/install.ps1` for Windows PowerShell native install:
```powershell
# Flux — Windows Install Script
# Flux by Parallax Group · github.com/pllx/flux

Write-Host "🔋 Flux — Installing..." -ForegroundColor Cyan

# Check Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "❌ Node.js not found. Install Node.js 18+ from nodejs.org" -ForegroundColor Red
  exit 1
}

# Install PM2
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "📦 Installing PM2..."
  npm install -g pm2
}

# Install dependencies
Write-Host "📦 Installing dependencies..."
Set-Location backend; npm install --production; Set-Location ..
Set-Location frontend; npm install; Set-Location ..

# Build frontend
Write-Host "🔨 Building Conduit (frontend)..."
Set-Location frontend; npm run build; Set-Location ..

# Copy env
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "⚙️  .env created — edit before starting"
}

Write-Host ""
Write-Host "✅ Flux installed." -ForegroundColor Green
Write-Host "Edit .env, then run: npm start"
Write-Host ""
Write-Host "Flux by Parallax Group"
```

---

## 11. Documentation Updates

The following documentation files must be updated to reflect the Flux brand:

| File | Changes Required |
|------|-----------------|
| `README.md` | Title → "Flux — NUT UPS Management", replace all `nut-monitor` references, update Docker image names, add native install section |
| `QUICKSTART.md` | Replace product name, update commands to use `flux` |
| `PROJECT_OVERVIEW.md` | Update architecture diagram labels to use component names (Conduit, Core, Cycle, Surge, Tap, Signal, Lock, Stratum) |
| `docker-compose.yml` | All service/container names updated per Section 9 |
| All `package.json` files | Updated per Section 9 |

The `PROJECT_INSTRUCTIONS.md` file should be replaced by or updated to reference this
brand brief and the `Pllx_group_BRAND.md` ecosystem document.

---

## 12. Verification Checklist for CC

After implementing all changes, verify:

- [ ] No instance of `nut-monitor` or `NUT Monitor` remains anywhere
- [ ] All component names (Conduit, Core, Cycle, Surge, Tap, Signal, Lock, Stratum) appear
      in file header comments
- [ ] CSS custom properties (`--flux-*`) defined and used throughout Conduit
- [ ] Syne loaded and applied to all headings, wordmark, and labels
- [ ] IBM Plex Mono applied to all metric values and data readouts
- [ ] IBM Plex Sans applied to all body copy and descriptions
- [ ] `ParallaxMark` SVG component created and renders correctly at 24px and 48px
- [ ] Navbar shows compact mark (24px) + "Flux" wordmark only
- [ ] Login screen shows full mark (48px) + "Flux" + "by Parallax Group"
- [ ] Footer shows "Flux by Parallax Group © 2026"
- [ ] Light/dark toggle removed entirely (no remnant state, no remnant UI)
- [ ] `install.sh` exists and is executable
- [ ] `install.ps1` exists for Windows
- [ ] `backend/ecosystem.config.js` exists for PM2
- [ ] Root `package.json` scripts include start, stop, restart, logs, build
- [ ] Docker image names follow `pllx/flux-*` convention
- [ ] `README.md` includes both Docker and native install instructions

---

*Flux by Parallax Group · pllx.group · Brand brief Rev 1 · April 2026*
