# UPS Repair and Machine Move Design

## Goal

Flux should recognize a host with a physically connected UPS but inactive/unconfigured NUT as repairable, and operators should be able to move an already onboarded machine from one UPS group to another while resetting UPS-specific shutdown/outlet fields.

## NUT Repair Discovery

`POST /api/devices/discover-nut` will separate live NUT names from static config stanzas. A host is a successful discovery only when `upsc -l` returns at least one live UPS name. If NUT binaries exist but `upsc -l` returns nothing and `lsusb` shows a common USB UPS vendor, the response is `422` with `repairable: true`, `nutMissing: false`, and a message that Flux can configure/repair NUT on that host.

The Add UPS wizard will show a **Configure / Repair NUT on this host** action when `repairable` is true. That action reuses the existing `/api/devices/install-nut` route because it already installs missing packages if needed, writes NUT config, restarts services, and re-runs discovery.

## Machine Move

The existing `AgentMachine.upsGroupId` remains the source of truth. Moving a machine to a different UPS uses `PUT /api/agents/:id` with `resetUpsAssignment: true`. The backend sets the new `upsGroupId`, clears UPS-specific order/delay and outlet fields, and resets `shutdownTimeout` to the model default.

Role, machine identity, Proxmox/PBS config, update policy, notes, and enrollment state are preserved. The UI will expose this through a **Move UPS** control on assigned machine rows, while the existing unassigned-machine **Assign UPS** control remains.

## Testing

Backend tests cover repairable discovery and move/reset updates. Frontend verification is `npm run build`.
