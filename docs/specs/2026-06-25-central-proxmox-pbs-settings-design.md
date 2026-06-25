# Central Proxmox/PBS Settings Design

## Problem

Flux currently stores `pveConfig` and `pbsConfig` on individual machine rows. That works, but it is repetitive and easy to misconfigure: every PVE node needs the same token with only the node name and URL changed, and every agent must be pushed after edits. Production setup for `sms-cluster` showed the operational pain clearly.

## Goal

Add a first-class **Settings -> Proxmox/PBS** area that stores shared orchestration defaults once, tests credentials before use, previews discovered resources, and lets the operator choose exactly which agents receive generated Proxmox or PBS config.

The first implementation should include the full usable flow:

- central Proxmox cluster settings
- central PBS settings
- API credential tests
- Proxmox node discovery
- hostname-based matching to enrolled Flux agents
- operator-selected apply targets
- optional PBS UPS assignment selected by the operator
- config push to online agents after apply

## Proposed Data Model

Add a `ProxmoxClusterConfig` model:

- `id`
- `name`
- `clusterId`
- `apiBaseUrl`
- `tokenId`
- `tokenSecret`
- `haFreezeTimeout`
- `enabled`
- timestamps

Add a `PbsConfig` model:

- `id`
- `name`
- `url`
- `tokenId`
- `tokenSecret`
- `jobAbortTimeout`
- `forceShutdown`
- optional default `upsGroupId`
- `enabled`
- timestamps

Machine-level `pveConfig` and `pbsConfig` remain valid and continue to be the agent runtime contract. Central settings are used to generate or update those machine-level values through an explicit apply action.

Secrets are write-only from the browser. List and detail responses return `hasTokenSecret: true` when a secret exists, never the stored secret value. Updating a config without a new secret preserves the existing secret.

The first pass can use Sequelize `sync()` like existing models do; no destructive migration should rewrite existing machine configs automatically.

## UI Flow

Add **Settings -> Proxmox/PBS**:

### Proxmox

1. Create or edit a Proxmox cluster config.
2. Test the API token by listing cluster nodes.
3. Show discovered nodes, enrolled Flux agents with PVE-capable roles, and automatic hostname matches.
4. Let the operator choose which matched rows to apply with checkboxes.
5. Let the operator override a match by selecting a different Flux agent for a discovered node.
6. Show unmatched Proxmox nodes and unmatched Flux agents separately.
7. Apply only selected rows.
8. Push updated config to online selected agents when possible, and report offline agents as saved-but-not-pushed.

### PBS

1. Create or edit a PBS config.
2. Test the API token by listing running tasks or another lightweight authenticated PBS endpoint.
3. Let the operator choose the target enrolled PBS agent.
4. Let the operator choose whether to assign that PBS agent to a UPS group.
5. If UPS assignment is selected, show a UPS group dropdown and apply the existing move/reset semantics.
6. Apply `pbsConfig` only to the selected agent.
7. Push updated config to the online selected agent when possible, and report offline saved-but-not-pushed.

Assignment is always choosable. Flux must not silently assign a PBS machine to a UPS group, move a PVE node between UPS groups, or overwrite an operator's per-machine shutdown values unless the operator selected that action.

## Data Flow

For PVE:

- Operator enters one token for the cluster.
- Flux calls `/nodes` to discover node names.
- Flux creates a preview that pairs each discovered node with the best matching enrolled agent by normalized hostname.
- Operator selects rows to apply.
- Flux writes `clusterId` and derived `pveConfig` to selected machines only.
- Derived `pveConfig` contains `url`, `tokenId`, `tokenSecret`, and the node-specific `node`.
- Existing machine fields unrelated to Proxmox config are preserved.
- If a selected machine is online, Flux pushes the updated config through the existing agent channel.

For PBS:

- Operator enters one PBS endpoint/token.
- Flux tests `/nodes/localhost/tasks?running=1`.
- Operator selects one enrolled PBS agent.
- Flux writes `pbsConfig` to that selected agent only.
- If the operator selected a UPS group, Flux assigns the PBS agent to that group using the same reset behavior as other UPS moves.
- If the selected agent is online, Flux pushes the updated config through the existing agent channel.

## Backend API

Add authenticated admin/operator routes under `/api/settings/proxmox-pbs`:

- `GET /proxmox-clusters`
- `POST /proxmox-clusters`
- `PUT /proxmox-clusters/:id`
- `POST /proxmox-clusters/:id/test`
- `POST /proxmox-clusters/:id/discover`
- `POST /proxmox-clusters/:id/apply`
- `GET /pbs-configs`
- `POST /pbs-configs`
- `PUT /pbs-configs/:id`
- `POST /pbs-configs/:id/test`
- `POST /pbs-configs/:id/apply`

Apply request bodies must include explicit selected target IDs. Discovery and apply responses should include enough detail for the UI to explain what changed, what was skipped, and which agents were offline.

## Matching Rules

Normalize names by lowercasing and stripping domain suffixes. A Proxmox node matches an agent when the normalized node name equals the normalized `hostname`. If more than one agent matches, mark the row ambiguous and require manual selection.

Eligible Proxmox apply targets default to roles `pve-node`, `ups-host`, or `both`. Eligible PBS targets default to role `pbs` or `both`. Manual selection can still show other agents with a warning, but the default choices should stay role-aware.

## Error Handling

- Do not save a token until API test succeeds, unless the operator explicitly saves as disabled.
- Show unmatched PVE nodes and unmatched Flux agents separately.
- Preserve existing machine-level overrides when applying defaults unless the operator chooses overwrite.
- Never expose stored token secrets back to the browser; show only presence and allow replacement.
- If a central config references a missing secret, test/apply returns a clear validation error.
- If an agent is offline during apply, save database changes and report that config push is pending.
- If API discovery succeeds but no nodes match agents, show the discovered nodes and require manual target choices.
- If pushing config fails for one agent, continue applying other selected agents and return per-agent status.

## Testing

- Backend tests for central config CRUD and token redaction.
- Backend tests for preserving existing secrets on update.
- Backend tests for Proxmox test/discovery using mocked API calls.
- Backend tests for deriving per-machine `pveConfig`.
- Backend tests for hostname matching, ambiguous matches, and unmatched rows.
- Backend tests for applying config only to selected agents.
- Backend tests for optional PBS UPS assignment using existing move/reset semantics.
- Backend tests for reporting offline or failed config pushes per agent.
- Frontend build verification, plus component tests if a frontend test runner is introduced.

## Migration

Existing per-machine configs stay valid. A migration can detect identical token IDs/secrets across PVE machines and suggest creating a central cluster config, but it should not rewrite automatically without operator confirmation.

For the initial implementation, no automatic migration is required. Existing configured machines continue to work, and operators can create central settings when ready.
