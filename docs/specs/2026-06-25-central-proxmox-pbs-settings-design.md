# Central Proxmox/PBS Settings Design

## Problem

Flux currently stores `pveConfig` and `pbsConfig` on individual machine rows. That works, but it is repetitive and easy to misconfigure: every PVE node needs the same token with only the node name and URL changed, and every agent must be pushed after edits. Production setup for `sms-cluster` showed the operational pain clearly.

## Recommended Direction

Add a first-class Proxmox/PBS orchestration settings area that stores shared defaults once and fans out per-node config automatically.

## Proposed Data Model

Add a `ProxmoxClusterConfig` model:

- `clusterId`
- `apiBaseUrl` or preferred API host
- `tokenId`
- `tokenSecret`
- `haFreezeTimeout`
- `enabled`

Add a `PbsConfig` model or cluster-linked PBS section:

- `name`
- `url`
- `tokenId`
- `tokenSecret`
- `jobAbortTimeout`
- `forceShutdown`
- optional `upsGroupId`

Machine-level `pveConfig` and `pbsConfig` remain as overrides. If no override exists, Flux derives config from the central settings plus the machine hostname/node name.

## UI Flow

Add **Settings -> Proxmox/PBS**:

1. Create or edit a Proxmox cluster config.
2. Test API token by listing nodes.
3. Match discovered nodes to enrolled Flux agents by hostname.
4. Apply cluster ID and derived PVE config to matched agents.
5. Create or edit PBS config and assign PBS to a UPS group.
6. Push updated config to online agents.

## Data Flow

For PVE:

- Operator enters one token for the cluster.
- Flux calls `/nodes` to discover node names.
- Flux writes `clusterId` to matching machines.
- Flux writes derived agent config with the shared token and node-specific `node`/URL.

For PBS:

- Operator enters one PBS endpoint/token.
- Flux tests `/nodes/localhost/tasks?running=1`.
- Flux writes `pbsConfig` to the PBS agent and assigns it to a UPS group.

## Error Handling

- Do not save a token until API test succeeds, unless the operator explicitly saves as disabled.
- Show unmatched PVE nodes and unmatched Flux agents separately.
- Preserve existing machine-level overrides when applying defaults unless the operator chooses overwrite.
- Never expose stored token secrets back to the browser; show only presence and allow replacement.

## Testing

- Backend tests for central config CRUD and token redaction.
- Backend tests for deriving per-machine `pveConfig`.
- Backend tests for applying config to matched agents without overwriting unrelated fields.
- Frontend build verification, plus component tests if a frontend test runner is introduced.

## Migration

Existing per-machine configs stay valid. A migration can detect identical token IDs/secrets across PVE machines and suggest creating a central cluster config, but it should not rewrite automatically without operator confirmation.
