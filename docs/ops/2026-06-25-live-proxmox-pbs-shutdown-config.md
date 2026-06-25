# Live Proxmox/PBS Shutdown Config - 2026-06-25

## Scope

This records the live `.135` production configuration for Proxmox/PBS shutdown orchestration. It intentionally does not include token secrets.

## Proxmox Cluster

- Cluster ID in Flux: `sms-cluster`
- Proxmox token ID: `root@pam!flux-ups`
- Token secret storage:
  - Flux native DB: `/var/lib/flux/flux.db`
  - Each PVE node agent config: `/etc/flux-agent/config.json`
- PVE token verification: each node could list local VMs using its stored `pveConfig`.

Configured PVE rows:

| Hostname | Role | UPS group | Node URL |
|---|---|---:|---|
| `sms-pve-1` | `ups-host` | 5 | `https://10.11.200.21:8006` |
| `sms-pve-2` | `pve-node` | 5 | `https://10.11.200.22:8006` |
| `sms-pve-3` | `ups-host` | 3 | `https://10.11.200.23:8006` |
| `sms-pve-4` | `pve-node` | 3 | `https://10.11.200.24:8006` |
| `sms-pve-5` | `pve-node` | 8 | `https://10.11.200.25:8006` |
| `sms-pve-6` | `ups-host` | 8 | `https://10.11.200.26:8006` |

There is also a stale/offline `sms-pve-4` row assigned to UPS group 4. It was not configured.

## PBS

- PBS host: `sms-pbs`
- PBS URL: `https://10.11.200.31:8007`
- Flux role: `pbs`
- UPS group: 8 (`PVE-6-1500`)
- Shutdown order: 1
- Shutdown delay: 0
- PBS token ID: `flux@pbs!flux-ups`
- Token secret storage:
  - Flux native DB: `/var/lib/flux/flux.db`
  - PBS agent config: `/etc/flux-agent/config.json`
- PBS token verification: `listRunningJobs` succeeded from the agent config.

## Shutdown Behavior

Flux shutdown orchestration starts only when a UPS reports `OB LB`, not on `OB` alone.

For PVE nodes with `pveConfig`, the agent sequence is:

1. Enable Proxmox node maintenance with `ha-manager crm-command node-maintenance enable <node>`.
2. Stop local VMs/CTs through the Proxmox API.
3. Run OS shutdown.

For the PBS agent with `pbsConfig`, the sequence is:

1. List running PBS tasks.
2. Abort running tasks.
3. Wait up to `jobAbortTimeout`.
4. Run OS shutdown, honoring `forceShutdown`.

Cluster-wide HA freeze is attempted by the backend for nodes sharing a `clusterId` when shutdown is triggered.

## Operational Notes

- After changing PVE/PBS config in Flux, push config to the agent or update `/etc/flux-agent/config.json` and restart `flux-agent`.
- If API tokens are rotated, update both the Flux DB row and each affected agent config.
- A controlled dry-run/simulation should be used before relying on this in a real outage.
