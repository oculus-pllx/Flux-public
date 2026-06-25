# Next Session Punchlist

> Use this as the first context file for the next Flux session. It records what is already implemented, what still needs verification/configuration, and what should be done next.

**Goal:** Continue operational verification from the current deployed Flux state.

**Current Live Instance:** `http://10.11.200.135:5174`

**Current UPS Host:** `sms-pve-3` / `10.11.200.23`, NUT UPS name `apc2200`

**Current Replacement UPS:** `Smart-UPS 1500 RM`, USB `051d:0002`, serial `AS0517232423`

**Known Missing UPS Host:** `sms-pve-4` / `10.11.200.24` currently has no APC USB UPS attached. NUT still lists stale UPS name `ups`, but Flux now clears stale online data and stores `nutHealth.state = error` on poll failure.

---

## Already Baked In

- Durable UPS outage shutdown scheduling is implemented.
- Power restoration cancellation is implemented.
- Backend Proxmox HA freeze/restore is implemented through `backend/services/agentHub.js` and `backend/services/proxmoxService.js`.
- Agent-side Proxmox node HA maintenance enable/disable is implemented through `flux-agent/services/proxmox.js` and `flux-agent/services/sequencer.js`.
- Agent-side PVE guest shutdown is implemented before OS shutdown for `pve-node` and `both` roles when `pveConfig` exists.
- Agent-side PBS job abort is implemented before OS shutdown for `pbs` and `both` roles when `pbsConfig` exists.
- Auto-order priority is implemented as `controlled -> pbs -> pve-node -> ups-host`.
- UPS host assignment and agent role sync fixes are in both private and public repos.
- Manual update UI/check update support is implemented.
- Password input one-keystroke focus loss was previously addressed in the machine update/config UI work.
- UPS reprobe is implemented and deployed. It restarts the linked UPS-host NUT services, falls back from `systemctl restart nut-driver@name` to `upsdrvctl start name`, waits through the `upsd` restart window, reads all NUT variables, saves `lastStatus`, and renames the Flux device to the detected model.
- Polling failure handling is implemented and deployed. Failed NUT polls clear stale `lastStatus`, set `lastSeen` to null, and store `nutHealth.state = error` so a disconnected UPS does not keep appearing online.

## Important Caveat

The HA/PBS controls are code-complete but configuration-dependent. They only run when the relevant agent rows have saved config:

- Proxmox HA freeze/restore requires at least one online `pve-node` per cluster with valid `pveConfig`.
- PVE guest shutdown on a node requires that node's agent to have valid `pveConfig`.
- PBS job abort requires the PBS agent to have valid `pbsConfig`.

Live `.135` now has PVE/PBS API configs saved and pushed to agents. Read-only
API verification passes from the agents themselves. `sms-pbs` is assigned to
UPS group 8 (`PVE-6-1500`). Destructive execution of HA freeze, guest shutdown,
and PBS job abort is still intentionally untested.

## Next Concrete Tasks

- [x] On `.135`, verify all PVE node rows have the correct role, `upsGroupId`, `clusterId`, `shutdownOrder`, and `shutdownDelay`.
- [x] On `.135`, add or verify `pveConfig` for at least one reachable PVE node in each Proxmox cluster.
- [x] On `.135`, add or verify `pveConfig` for every PVE node that should stop its own VMs/CTs before host shutdown.
- [x] On `.135`, add or verify `pbsConfig` on the PBS machine so running backup jobs are aborted before shutdown.
- [x] Push updated machine configs to connected agents after editing `pveConfig`, `pbsConfig`, or `nutConfig`.
- [x] Push updated cluster metadata to connected PVE agents after editing `clusterId`.
- [ ] Run a non-destructive dry run or controlled simulation that proves the shutdown sequence emits the expected steps without relying on a real low-battery event.
- [x] Confirm the UPS host still reports `apc2200` over NUT and remains assigned to the UPS as `ups-host`.
- [x] Confirm UPS controls still work: beeper enable/disable, mute, and any available APC instant commands supported by NUT for this model.
- [x] Check whether load and input voltage fields are absent from the APC/NUT data or just not surfaced in the UI.
- [x] Repair `.23` NUT config after UPS replacement by changing `productid = 0003` to `productid = 0002`.
- [x] Deploy reprobe retry/fallback agent fix to `.23`, native `.135`, Docker `.25`, private repo, and public repo.
- [x] Confirm `.24` has no connected APC USB UPS and that device 4 is now marked offline/error instead of showing stale online data.
- [x] Rename public source references from `Flux-public` to `Flux-Controller`: install URLs, README clone commands, release URLs, updater metadata, and hardcoded repo references.
- [x] Rename/create the actual GitHub public repository as `oculus-pllx/Flux-Controller` and point the public checkout remote there.
- [x] Update or close stale unchecked process boxes in current shared NUT plan docs after confirming commits/deploys are done.
- [ ] In the next session, click **Restart NUT and Re-detect UPS** on device 3 from the UI and confirm the visible device name changes to `Smart-UPS 1500 RM`.
- [ ] In the next session, decide whether device 4 should be deleted, reassigned, or left as an offline placeholder until a UPS is connected to `10.11.200.24`.

## Docs Status

- Private README documents Docker install, native Linux install, agent install, NUT requirements, roles, UPS assignment, manual updates, and API routes.
- Public README has the same operational install/use docs, with public GitHub URLs.
- Both READMEs now document PBS before PVE in auto-order: `controlled -> pbs -> pve-node -> ups-host`.
- `docs/QUICKSTART.md` documents the Replace / Re-detect UPS workflow and offline NUT source behavior.
- `docs/plans/2026-06-24-nut-source-health.md` records full verification/deploy completion for the NUT source health and reprobe fixes.
- `docs/ops/2026-06-25-live-proxmox-pbs-shutdown-config.md` records the live Proxmox/PBS orchestration config without token secrets.
- `docs/specs/2026-06-25-central-proxmox-pbs-settings-design.md` records the recommended future central settings model.

## Relevant Files

- `README.md`
- `docs/plans/2026-06-17-agent-resilient-power.md`
- `docs/plans/2026-06-17-ups-follow-up.md`
- `docs/plans/2026-06-18-ups-machine-update-controls.md`
- `docs/plans/2026-06-18-ups-source-switching.md`
- `docs/plans/2026-06-24-nut-source-health.md`
- `backend/services/agentHub.js`
- `backend/services/pollingService.js`
- `backend/routes/devices.js`
- `backend/services/proxmoxService.js`
- `flux-agent/services/nut.js`
- `flux-agent/services/proxmox.js`
- `flux-agent/services/sequencer.js`
- `flux-agent/services/pbs.js`
- `frontend/src/utils/shutdownOrder.js`
