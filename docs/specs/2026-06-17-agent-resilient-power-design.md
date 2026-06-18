# Agent Resilient Power Design

## Purpose

Flux should protect machines during UPS events even when the Flux server or network becomes unreliable after the outage decision is made. It should also make NUT ownership explicit, avoid overwriting manually managed NUT installs without opt-in, and put Proxmox HA into a known planned-maintenance state during power-event shutdowns.

This design covers four related changes:

- Opt-in Flux-managed NUT configuration with backups before writes.
- Durable agent shutdown schedules with cancel/stay-up commands.
- Proxmox HA maintenance/freeze handling with restore after power recovery.
- README Linux install instructions for native server and agent installs.

## Current Behavior

NUT server installation already exists through `POST /api/devices/install-nut` and SSH writes config files on the UPS-attached host. Existing discovered NUT installs are read and used, but agent `push-config` does not reconfigure NUT.

The Flux agent communicates with the Flux server over WebSocket, stores config in `/etc/flux-agent/config.json`, receives commands, polls local NUT when running as `ups-host`, and executes shutdown sequences. It does not currently replace NUT; NUT is still required on the machine physically connected to the UPS.

Auto-shutdown currently triggers on `OB+LB`, schedules SSH host shutdowns in backend memory, and sends immediate agent shutdown commands with relative delays. If power returns, backend timers are canceled, but already-sent agent commands are not durable/cancelable.

Proxmox support currently stops guests before OS shutdown and has a backend cluster-wide HA freeze path using `shutdown_policy=freeze`. It does not currently run Proxmox node maintenance mode or restore HA policy after power recovery.

The repo already contains `install.sh` for native Linux Flux server installation and `install-agent.sh` for Linux agent bootstrap, but the GitHub README primarily presents Docker installation.

## External Reference

Proxmox VE documents node maintenance through:

```bash
ha-manager crm-command node-maintenance enable <node>
ha-manager crm-command node-maintenance disable <node>
```

The current Proxmox docs describe these as CRM commands for changing node maintenance request state. See:

- https://pve.proxmox.com/pve-docs/ha-manager.1.html
- https://pve.proxmox.com/pve-docs/chapter-ha-manager.html

## Design

### 1. Managed NUT Ownership

Flux will add an explicit `nutConfig.managedByFlux` boolean.

When `managedByFlux` is false or missing:

- Agent may save `nutConfig`.
- Agent may poll NUT with `upsc`.
- Agent must not write `/etc/nut/*`, `/etc/ups/*`, or restart NUT services.

When `managedByFlux` is true:

- Agent may install NUT if missing.
- Agent writes NUT config from `nutConfig`.
- Agent restarts the NUT service.
- Agent backs up existing NUT config before the first managed write in that apply operation.

Flux-created NUT installs should default to managed because Flux created the config. Existing discovered/imported NUT installs must remain unmanaged until the user opts in.

Backups will be written on the target host before changing files:

```text
/etc/nut/flux-backup-YYYYMMDD-HHMMSS/
```

If the host uses `/etc/ups`, the backup path will be:

```text
/etc/ups/flux-backup-YYYYMMDD-HHMMSS/
```

The backup includes existing `ups.conf`, `upsd.conf`, `upsd.users`, `upsmon.conf`, and `nut.conf` when present. Missing files are skipped.

The UI must make the boundary explicit: enabling managed mode means Flux will overwrite NUT config files on that host.

### 2. Durable Agent Shutdown and Cancel

Flux will replace fire-and-forget relative shutdown commands for agents with durable scheduled shutdown messages.

On UPS critical state, Flux sends each affected agent:

```json
{
  "type": "schedule-shutdown",
  "shutdownId": "uuid",
  "reason": "ups-critical",
  "deviceId": 1,
  "executeAt": "2026-06-17T20:42:00.000Z",
  "delaySeconds": 120
}
```

The agent persists this pending shutdown to disk under `/etc/flux-agent/pending-shutdown.json`. If the agent or Flux server restarts, the agent resumes the pending deadline and shuts down when `executeAt` is reached.

On power recovery before shutdown, Flux sends:

```json
{
  "type": "cancel-shutdown",
  "shutdownId": "uuid",
  "deviceId": 1,
  "reason": "power-restored"
}
```

The agent cancels the matching local timer, deletes the pending shutdown file, and sends an acknowledgement. If the cancel arrives after the deadline has passed or shutdown has started, best effort applies.

Manual shutdown may keep using immediate commands or may be moved to the same scheduler. For this feature, UPS-triggered shutdowns must use the durable scheduler.

### 3. Proxmox HA Planned Shutdown Handling

For `pve-node` and `both` agents with `pveConfig`, the shutdown sequence will perform HA preparation before stopping guests.

The preferred node-local preparation is:

```bash
ha-manager crm-command node-maintenance enable <node>
```

The node name comes from `pveConfig.node`, falling back to `hostname -s` only if needed. The agent should report a shutdown step when maintenance mode is requested.

Existing backend HA freeze through `shutdown_policy=freeze` remains available as a compatibility fallback, but it must be restored after power recovery. Before changing cluster HA policy, Flux stores the previous HA setting in outage state. On cancellation/recovery, Flux restores the previous setting.

Power recovery behavior:

- If shutdown was scheduled but not executed, Flux sends `cancel-shutdown` to agents.
- Flux restores cluster HA policy to its saved previous value.
- Flux sends or queues maintenance disable for PVE agents:

```bash
ha-manager crm-command node-maintenance disable <node>
```

Reconnect behavior:

- If nodes went down and later reconnect after power returns, Flux reconciles cleanup by sending maintenance disable to reachable PVE agents that were marked as HA-prepared during the outage.
- Flux should not blindly disable maintenance for unrelated/manual maintenance. It only cleans up maintenance state it requested for the active/resolved outage.

### 4. Linux Install Documentation

README should document both Linux install paths:

- Native Flux server install:

```bash
curl -fsSL https://raw.githubusercontent.com/oculus-pllx/Flux-Controller/main/install.sh | sudo bash
```

- Linux agent install from a running Flux server:

```bash
FLUX_URL=http://<flux-host>:7483 FLUX_TOKEN=<token> sudo -E bash <(curl -fsSL http://<flux-host>:7483/install-agent.sh)
```

The docs should state that NUT is only required on the UPS-connected machine, unless the user deliberately deploys NUT client fallback to other machines.

## Data Model

Agent config gains:

```json
{
  "nutConfig": {
    "managedByFlux": true
  }
}
```

Agent local state gains:

```text
/etc/flux-agent/pending-shutdown.json
```

Backend needs persistent outage metadata so HA restore survives backend restarts. Add a new SQLite model named `PowerEvent` with:

- `id`
- `deviceId`
- `shutdownId`
- `state`: `active`, `cancelled`, `completed`
- `startedAt`
- `resolvedAt`
- `previousHaPolicy`
- `haPreparedMachineKeys`

Restore state must not live only in memory.

## Error Handling

Managed NUT apply failures must report an agent error and leave the backup path in the error detail when available.

If backup fails, the agent must not write NUT config.

If HA maintenance enable fails, the agent reports the error and continues with guest/OS shutdown. This feature uses graceful degradation for HA preparation failures.

If HA restore fails on power recovery, Flux records state detail and retries when the agent reconnects or the device returns to stable online state again.

If an agent is offline when `schedule-shutdown` is sent, Flux records that the command could not be delivered. Durable scheduling only works once the agent has received the schedule; it cannot protect a machine that was isolated before the UPS event was known.

## Testing Plan

Backend tests:

- UPS critical creates a persistent power event and sends `schedule-shutdown` with absolute `executeAt`.
- Power recovery sends `cancel-shutdown`, clears active shutdown state, and restores saved HA policy.
- Offline agents are recorded without pretending they received a durable schedule.
- Existing direct SSH timer cancellation behavior remains covered.

Agent tests:

- `schedule-shutdown` persists pending shutdown and schedules local execution.
- Agent restart reloads pending shutdown and executes if the deadline arrives.
- `cancel-shutdown` deletes pending shutdown and prevents execution.
- Stale/unknown cancel does not delete unrelated pending shutdown.
- Managed NUT false does not call setup/write/restart.
- Managed NUT true backs up config before writing and applies setup.
- Proxmox shutdown sequence enables node maintenance before stopping guests.
- HA maintenance disable command is available for recovery cleanup.

Docs verification:

- README contains Docker, native Linux server install, and Linux agent install.
- README explains NUT is required on the UPS-connected host.

## Acceptance Criteria

- Users can opt an existing NUT host into Flux management only with an explicit control.
- Flux backs up NUT config files before managed writes.
- Flux-installed NUT hosts are marked managed by default.
- UPS-triggered agent shutdown is durable after the command is received.
- Power restoration before the deadline cancels pending agent shutdowns.
- Proxmox nodes enter maintenance mode before planned power-event shutdown.
- HA freeze/maintenance state requested by Flux is restored or reconciled after power returns.
- README documents native Linux server install and Linux agent bootstrap.
