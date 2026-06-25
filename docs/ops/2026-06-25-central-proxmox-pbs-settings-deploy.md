# Central Proxmox/PBS Settings Deployment - 2026-06-25

## Scope

This records the deployment target and operator flow for the central Proxmox/PBS settings build. It intentionally does not include token secrets.

## Included Build

- Central Proxmox cluster config storage with redacted token secrets.
- Central PBS config storage with redacted token secrets.
- Proxmox token test, node discovery, hostname matching, and selected apply.
- PBS token test and selected apply.
- Settings UI panels for Proxmox VE and Proxmox Backup Server.
- PBS UPS assignment remains operator-selected. UPS-specific reset fields change only when the operator explicitly selects a UPS group during apply.

## Deployment Targets

- Public repo: `oculus-pllx/Flux-Controller`, branch `main`.
- Private repo: `oculus-pllx/Flux`, branch `main`.
- Native production: `10.11.200.135`, service `flux`, install path `/opt/flux`, app port `5174`.
- Docker production: `192.168.0.25`, install path `/root/Flux`, frontend port `7483`.

## Deployment Status - 2026-06-25

- Public GitHub repo updated to include central Proxmox/PBS settings docs and implementation.
- Private GitHub repo updated to commit `13de69d`.
- Docker production `.25` fast-forwarded to private commit `13de69d`, rebuilt with `docker compose up -d --build`, and verified healthy.
- Native production `.135` remained reachable over HTTP health check, but was not updated from this session because no available SSH key/user authenticated to the host and `.25` could not reach `.135` on port 22.

## Post-Deploy Verification

Run after updating each production target:

```bash
curl -fsS http://127.0.0.1:5174/api/health
```

For Docker production, also verify:

```bash
docker compose ps
curl -fsS http://127.0.0.1:5174/api/health
```

For local source verification:

```bash
cd backend && npm test
cd frontend && npm run build
```

## Operator Flow After Deploy

1. Open **Settings -> Proxmox VE**.
2. Create the `sms-cluster` central config.
3. Test the Proxmox token.
4. Discover Proxmox nodes.
5. Review matched, ambiguous, and unmatched rows.
6. Apply only selected PVE agents.
7. Open **Settings -> Proxmox Backup Server**.
8. Create the PBS config.
9. Test the PBS token.
10. Choose the `sms-pbs` agent.
11. Choose whether to assign/move it to UPS group `PVE-6-1500`.
12. Confirm online agents report pushed config; push/restart any offline agents after reconnecting.

## What Is Next In The Build

- Add a read-only summary of central Proxmox/PBS config state to Power Center so operators can see which UPS groups have cluster-aware shutdown coverage.
- Add an explicit "pending config push" indicator for agents updated while offline.
- Add a controlled dry-run endpoint for shutdown ordering that reports the exact schedule without sending shutdown commands.
- Add optional migration assistance that detects identical existing PVE/PBS tokens and offers to create central settings without rewriting automatically.
