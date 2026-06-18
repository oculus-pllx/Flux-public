# Next Session Punchlist

> Use this as the first context file for the next Flux session. It records what is already implemented, what still needs verification/configuration, and what should be done next.

**Goal:** Finish operational verification for the live UPS/proxmox/PBS setup and clean up public repo naming.

**Current Live Instance:** `http://10.11.200.135:5174`

**Current UPS Host:** `sms-pve-3` / `10.11.200.23`, NUT UPS name `apc2200`

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

## Important Caveat

The HA/PBS controls are code-complete but configuration-dependent. They only run when the relevant agent rows have saved config:

- Proxmox HA freeze/restore requires at least one online `pve-node` per cluster with valid `pveConfig`.
- PVE guest shutdown on a node requires that node's agent to have valid `pveConfig`.
- PBS job abort requires the PBS agent to have valid `pbsConfig`.

Do not assume the live `.135` instance is fully HA/PBS-ready until those configs are verified in the database/UI and pushed to the agents.

## Next Concrete Tasks

- [x] On `.135`, verify all PVE node rows have the correct role, `upsGroupId`, `clusterId`, `shutdownOrder`, and `shutdownDelay`.
- [ ] On `.135`, add or verify `pveConfig` for at least one reachable PVE node in each Proxmox cluster.
- [ ] On `.135`, add or verify `pveConfig` for every PVE node that should stop its own VMs/CTs before host shutdown.
- [ ] On `.135`, add or verify `pbsConfig` on the PBS machine so running backup jobs are aborted before shutdown.
- [ ] Push updated machine configs to connected agents after editing `pveConfig`, `pbsConfig`, or `nutConfig`.
- [x] Push updated cluster metadata to connected PVE agents after editing `clusterId`.
- [x] Run a non-destructive dry run or controlled simulation that proves the shutdown sequence emits the expected steps without relying on a real low-battery event.
- [x] Confirm the UPS host still reports `apc2200` over NUT and remains assigned to the UPS as `ups-host`.
- [x] Confirm UPS controls still work: beeper enable/disable, mute, and any available APC instant commands supported by NUT for this model.
- [x] Check whether load and input voltage fields are absent from the APC/NUT data or just not surfaced in the UI.
- [x] Rename public source references from `Flux-public` to `Flux-Controller`: install URLs, README clone commands, release URLs, updater metadata, and hardcoded repo references.
- [ ] Rename/create the actual GitHub public repository as `oculus-pllx/Flux-Controller` and point the public checkout remote there.
- [ ] Update or close stale unchecked process boxes in older plan docs after confirming commits/releases are already done.

## Docs Status

- Private README documents Docker install, native Linux install, agent install, NUT requirements, roles, UPS assignment, manual updates, and API routes.
- Public README has the same operational install/use docs, with public GitHub URLs.
- Both READMEs now document PBS before PVE in auto-order: `controlled -> pbs -> pve-node -> ups-host`.

## Relevant Files

- `README.md`
- `docs/plans/2026-06-17-agent-resilient-power.md`
- `docs/plans/2026-06-17-ups-follow-up.md`
- `docs/plans/2026-06-18-ups-machine-update-controls.md`
- `docs/plans/2026-06-18-ups-source-switching.md`
- `backend/services/agentHub.js`
- `backend/services/proxmoxService.js`
- `flux-agent/services/proxmox.js`
- `flux-agent/services/sequencer.js`
- `flux-agent/services/pbs.js`
- `frontend/src/utils/shutdownOrder.js`
