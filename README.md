# Flux — UPS Monitoring & Shutdown Orchestration

A self-hosted dashboard for UPS monitoring and graceful ordered shutdown. Connects to NUT (Network UPS Tools) servers, tracks battery/load/runtime in real time, fires configurable email alerts, and coordinates safe shutdown of every machine on a UPS — via native agents (preferred) or SSH.

**v1.0.0** | Node.js + React + SQLite | Docker or bare-metal

---

## Quick Start — Docker

```bash
git clone https://github.com/oculus-pllx/Flux-Controller.git
cd Flux-Controller
cp .env.example .env      # set JWT_SECRET at minimum
docker compose up -d
```

Open **http://your-server-ip:7483** — register your first account (becomes admin), then add a UPS.

```bash
# After git pull
docker compose up -d --build
```

---

## Native Linux Install

For a bare-metal or VM install on Linux, run the installer as root:

```bash
curl -fsSL https://raw.githubusercontent.com/oculus-pllx/Flux-Controller/main/install.sh | sudo bash
```

On Debian/Ubuntu amd64, the installer downloads the latest `.deb` release, creates the `flux` systemd service, writes `/etc/flux/.env`, and stores data in `/var/lib/flux`. Other Linux targets fall back to a source install under `/opt/flux`.

Useful commands:

```bash
systemctl status flux
journalctl -u flux -f
```

---

## Where NUT Is Needed

NUT is required on the machine physically connected to the UPS. Flux agents do not replace NUT drivers; agents communicate with Flux, execute shutdown plans, and can poll local NUT when running on the UPS host.

Typical layout:

- UPS-connected Linux host: NUT + Flux agent with role `ups-host`.
- Other machines: Flux agent only.
- Optional NUT client fallback: deploy NUT client/`upsmon` only where independent NUT-based shutdown is desired.

Flux can install and configure NUT on the UPS host over SSH. Existing NUT installs remain read-only unless you explicitly enable **Managed by Flux**, which backs up and overwrites NUT config files when pushed.

---

## Adding a UPS

### Discover via SSH (recommended)

Click **+ Add UPS** → **🔍 Discover via SSH**. Enter SSH credentials for the machine running NUT. Flux reads `/etc/nut/ups.conf`, `upsd.conf`, and `upsd.users` and pre-fills everything — just enter a display name and confirm.

### Manual

Click **+ Add UPS** → **✎ Manual**. You need: host/IP, port (3493), UPS name from NUT, and optional monitor credentials.

**Find your UPS name:**
```bash
echo "LIST UPS" | nc <nut-server-ip> 3493
# UPS apc "APC Back-UPS 1350"  ← "apc" is the UPS name
```

**NUT server requirements for remote access** (add to `/etc/nut/upsd.conf` and restart):
```
LISTEN 0.0.0.0 3493
```
And a monitor user in `/etc/nut/upsd.users`:
```
[fluxmon]
    password = yourpassword
    upsmon slave
```

---

## Enrolling Machines (Power Center)

The **Power Center** (home page) shows all UPS groups and their machines. To add machines that Flux can shut down:

### Option A — Install Agent via SSH (migrate from Hosts)
On a device with existing SSH-connected hosts, click the machine row → **⬆ Install Agent (migrate)**. Select the machine's role, confirm, and Flux SSHs in, installs the agent, and migrates the record.

### Option B — Enroll Machine (new machine)
Click **+ Enroll Machine** → generate an enrollment token → install on the target:

```bash
FLUX_URL=http://<flux-host>:7483 FLUX_TOKEN=<token> sudo -E bash <(curl -fsSL http://<flux-host>:7483/install-agent.sh)
```

The Linux agent installer auto-detects the machine role, installs Node.js 20 if needed, downloads the agent bundle from Flux, writes `/etc/flux-agent/config.json`, and starts the `flux-agent` systemd service.

**Agent roles:**

| Role | Auto-detected when | Shutdown behaviour |
|------|-------------------|-------------------|
| `pve-node` | `pve-manager` package present | PVE HA maintenance → stop VMs/CTs → OS shutdown |
| `pbs` | `proxmox-backup-server` present | Abort PBS jobs → OS shutdown |
| `ups-host` | `nut-server` service active | OS shutdown (NUT continues independently) |
| `controlled` | none of the above | OS shutdown |

### Option C — SSH install flow (Install via SSH)
Click **+ Enroll Machine** → SSH tab. Flux SSHs in, runs the installer non-interactively with the token and selected role.

---

## Shutdown Order

Once machines are enrolled and assigned to a UPS group:

1. Click **⚡ Auto-order** in the UPS group header — automatically assigns shutdown order and delay by role: `controlled → pbs → pve-node → ups-host`, 30s apart.
2. Or edit manually: click any machine → **Config tab** → set `shutdownOrder` and `shutdownDelay`.

Each machine row shows `#1 · 0s` — position and delay at a glance.

**Auto-shutdown:** When the UPS status becomes `OB LB` (on battery + low battery), Flux sends durable scheduled shutdown commands to enrolled agents. If power is restored before the deadline, Flux sends a cancel command so machines stay up.

---

## Power Center Features

- **Rename UPS** — click the UPS name (✎) to edit inline
- **Assign UPS** — machines in "No UPS Assigned" have an inline dropdown to move them to a group
- **⚡ UPS HOST** badge — the machine running NUT is highlighted in orange with a bold name
- **Shutdown order pill** — cyan `#N · Ns` badge on each row shows position and delay
- **Battery, load, runtime, input voltage** — live stats in each UPS group header
- **Enable/Disable beeper** — one-click dashboard control when NUT credentials are configured; prefers persistent `beeper.disable` and falls back to temporary mute when disable is unavailable
- **Manage commands** — the device **Manage → Control** pills run NUT instant commands and refresh UPS state after the command completes

---

## Configuration

`.env` at the project root (Docker) or `backend/.env` (dev):

```env
JWT_SECRET=change-me-required          # required
PORT=5174                              # backend port (internal)
NODE_ENV=production

DB_PATH=/app/data/flux.db              # SQLite, auto-created
FRONTEND_URL=http://192.168.0.x:7483   # set this for correct agent install URLs

# Optional — email alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=Flux Alerts <you@gmail.com>

# Optional — restrict SSH key file auth to a safe directory
SSH_KEY_DIR=/etc/flux/keys             # required if any machine uses sshKeyPath
```

---

## API Reference

### Auth
```
POST /api/auth/register         first user = admin
POST /api/auth/login            rate-limited: 10 req / 15 min
POST /api/auth/validate-token
PUT  /api/auth/password
```

### Devices (UPS)
```
GET    /api/devices
GET    /api/devices/:id
POST   /api/devices             admin/operator
POST   /api/devices/discover-nut  SSH-discover NUT config (admin/operator)
PUT    /api/devices/:id
DELETE /api/devices/:id
```

### UPS Control
```
GET    /api/devices/:id/control/commands
POST   /api/devices/:id/control/beeper/toggle  enable/disable from live UPS state
POST   /api/devices/:id/control/commands/:cmd  run NUT instant command and refresh state
GET    /api/devices/:id/control/vars/rw
PUT    /api/devices/:id/control/vars/:varname
```

### Agent Machines
```
GET    /api/agents
GET    /api/agents/:id
PUT    /api/agents/:id          update upsGroupId, shutdownOrder, shutdownDelay, pveConfig, nutConfig, etc.
POST   /api/agents/install-via-ssh
POST   /api/agents/:id/push-config   send config-update to connected agent
POST   /api/agents/:id/reenroll
POST   /api/agents/:id/ping
DELETE /api/agents/:id
GET    /api/agents/:id/events
GET    /api/agents/install-jobs/:jobId
```

### Connected Hosts (legacy SSH)
```
GET/POST   /api/devices/:id/machines
PUT/DELETE /api/devices/:id/machines/:mid
POST       /api/devices/:id/machines/:mid/test
POST       /api/devices/:id/machines/:mid/shutdown
POST       /api/devices/:id/machines/:mid/install-agent   migrate to agent
POST       /api/devices/:id/machines/:mid/deploy-nut
```

### Alerts
```
GET/POST/PUT/DELETE  /api/alerts/triggers
GET                  /api/alerts/history?limit=100&offset=0   returns { count, rows }
GET                  /api/alerts/unresolved/count
POST                 /api/alerts/alerts/:id/resolve
```

### Metrics
```
GET /api/metrics/device/:id          24h history
GET /api/metrics/device/:id/stats
GET /api/metrics/latest              latest per all active devices (single query)
GET /api/metrics/stream              SSE stream (accepts ?token= for browser EventSource)
```

### System
```
GET  /api/system/backup      download JSON backup (accepts ?token= for browser download)
POST /api/system/restore
GET  /api/system/info
```

### Users (admin only)
```
GET/POST   /api/users       POST validates: username 3-50 chars, valid email, password ≥8, role in [admin,operator,viewer]
PUT/DELETE /api/users/:id
```

---

## Static Endpoints

```
GET /install-agent.sh        bootstrap installer script
GET /install-agent.tar.gz    agent bundle (Node.js source + node_modules, ~74KB)
```

---

## Security

- JWT bearer tokens, 7-day expiry; query-string token only on SSE and file-download endpoints
- Passwords hashed bcrypt (10 rounds)
- Role-based access on all write endpoints (admin / operator / viewer)
- Login rate-limited (10 attempts / 15 min)
- SSH key files restricted to `SSH_KEY_DIR` — prevents path traversal
- 5xx errors return generic message in production (detail logged server-side)
- `Change JWT_SECRET before any deployment`

---

## Architecture

```
Browser → nginx :7483
  ├── /              React SPA (built at image build time)
  ├── /api/*         → Express backend :5174
  ├── /api/agent     → WebSocket hub (agent connections)
  ├── /api/metrics/stream  → SSE stream
  ├── /install-agent.sh    → backend static
  └── /install-agent.tar.gz → backend static

Express backend
  ├── pollingService  — per-device NUT polling timers
  │     └── checkAutoShutdown — OB+LB → ordered shutdown; state in Device.shutdownActive
  ├── alertService    — trigger evaluation (device + group), edge detection, email
  ├── emailService    — nodemailer with cached transport
  ├── agentHub        — WebSocket server; machine state machine
  │     └── notifyShutdown → cluster-aware (HA freeze + quorum) → role shutdown
  ├── sshService      — SSH shutdown, NUT deploy, agent install (readKeyFileSafe)
  └── nutService      — NUT TCP protocol client
```

---

## Development

```bash
git clone https://github.com/oculus-pllx/Flux-Controller.git
cd Flux
make install && make setup

# Terminal 1 — backend
cd backend && npm run dev       # :5174

# Terminal 2 — frontend
cd frontend && npm run dev      # :7483 (proxies /api to :5174)
```

Tests:
```bash
cd backend && npm test
cd flux-agent && npm test
cd frontend && npm run build
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent shows "Enrollment error: Unexpected server response: 200" | Set `FRONTEND_URL` in `.env` and rebuild — agent was connecting to wrong URL path |
| install-agent.sh returns 404 | Rebuild Docker backend — `install-agent.sh` must be in container |
| Agent stuck pending after install | Delete pending entry from Power Center, re-add machine, retry install |
| NUT discovery returns "No UPS found" | Ensure `upsd` is running; it tries `upsc -l` and multiple config paths |
| SSH key auth fails | Set `SSH_KEY_DIR` env var to the directory containing your key files |
| UPS not updating in Power Center | Check `FRONTEND_URL` is correct; NUT credentials may be needed for remote upsd |
| Replacement UPS reads correctly but old model remains | Use **Manage -> Replace / Re-detect UPS**. Flux restarts NUT, waits for `upsd`, saves the new variables, and renames the device to the detected model. |
| UPS appears online after being unplugged | The next poll clears stale `lastStatus`, sets `lastSeen` to empty, and shows `nutHealth.state = error` when NUT returns errors such as `DRIVER-NOT-CONNECTED`. |
| Alert emails not sending | Check SMTP config in Settings; use "Send Test Email" button |
| Docker UI stale after git pull | `docker compose up -d --build` — must rebuild images |
| `JWT_SECRET` error on start | Set it in `.env` — required, no default |

---

## License

MIT — Parallax Group
