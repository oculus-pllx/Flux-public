# Flux — Quick Start

---

## Docker (recommended)

```bash
git clone https://github.com/oculus-pllx/Flux-Controller.git
cd Flux
cp .env.example .env        # set JWT_SECRET at minimum
docker compose up -d
```

Open **http://your-server-ip:7483**

After pulling updates:
```bash
docker compose up -d --build
```

---

## Add Your First UPS

1. Register → login (first user = admin)
2. Click **+ Add UPS**

**Discover via SSH** (easiest): enter SSH credentials → Flux reads NUT config automatically.

**Manual**: you need host/IP, port (3493), UPS name, and optional credentials.

Find your UPS name:
```bash
echo "LIST UPS" | nc <nut-server-ip> 3493
```

For remote NUT access, add to `/etc/nut/upsd.conf` on the NUT server and restart `nut-server`:
```
LISTEN 0.0.0.0 3493
```

---

## Enroll Machines for Shutdown

From **Power Center** (home page), click **+ Enroll Machine**.

**Token method** — generates a 15-min token, run on target machine:
```bash
FLUX_URL=http://192.168.0.x:7483 FLUX_TOKEN=<token> bash <(curl -fsSL http://192.168.0.x:7483/install-agent.sh)
```

**SSH method** — Flux installs the agent remotely. Select role before confirming:
- `pve-node` — Proxmox VE node
- `pbs` — Proxmox Backup Server
- `ups-host` — machine with UPS attached (NUT server)
- `controlled` — anything else
- Leave blank for auto-detect

---

## Set Shutdown Order

1. Assign each machine to a UPS group (Power Center → "No UPS Assigned" → **Assign UPS** dropdown)
2. Click **⚡ Auto-order** in the UPS group header — auto-assigns order and delay by role

Or set manually per machine: click machine → **Config tab** → `shutdownOrder` + `shutdownDelay`.

---

## UPS Controls

From **Power Center**, use **Enable beeper** or **Disable beeper** in the UPS group header. Flux reads the live NUT beeper state first, sends the correct NUT command, then refreshes the UPS status.

For all available NUT instant commands, open the UPS **Manage** page and use the **Control** tab. Command pills refresh the UPS state after the command completes, so beeper and outlet highlights update from the latest NUT data.

---

## .env Settings

```env
JWT_SECRET=required-change-this
FRONTEND_URL=http://192.168.0.x:7483   # required for correct agent install URLs

# Email alerts (optional)
SMTP_HOST=smtp.gmail.com
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password

# SSH key file auth (optional — required only if machines use sshKeyPath)
SSH_KEY_DIR=/etc/flux/keys
```

---

## Common Issues

| Problem | Fix |
|---------|-----|
| Agent stuck pending | Delete from Power Center, re-enroll |
| NUT discovery fails | Ensure `upsd` is running and `LISTEN` is set in `upsd.conf` |
| No UPS stats showing | Check NUT credentials; verify port 3493 is reachable from Flux server |
| SSH key auth error | Set `SSH_KEY_DIR` in `.env` |
| Stale UI after update | `docker compose up -d --build` |
| Backend crash-looping after update | Schema migration ran automatically on next startup — if you pulled before this fix, run: `docker exec -it flux-backend sqlite3 /app/data/flux.db "ALTER TABLE Devices ADD COLUMN shutdownActive TINYINT(1) DEFAULT 0;"` then `docker restart flux-backend` |
