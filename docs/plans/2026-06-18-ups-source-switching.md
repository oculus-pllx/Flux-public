# UPS Source Switching

## Goal

Allow an existing UPS record to keep its Flux identity, assigned machines, history, and credentials while changing the NUT input source on the attached host.

## Behavior

- Add a backend source switch action for an existing device.
- SSH to the NUT host and rewrite only that UPS stanza in `ups.conf`.
- Preserve the UPS name, defaulting to the current device `upsName`.
- Support USB HID (`usbhid-ups`) and APC network card polling (`snmp-ups`).
- Back up `/etc/nut` or `/etc/ups` before editing.
- Restart NUT driver/server services and verify with `upsc`.
- Roll back the backed-up NUT files when verification fails.
- Update the existing Flux `Device` row with the discovered NUT endpoint and latest poll result.
- For the agent-driven **Replace / Re-detect UPS** flow, keep the same Flux device row but save the newly detected NUT variables and rename the device to the detected UPS model.
- Re-detect waits through the NUT restart window before polling so transient `Connection refused` from `upsd` startup does not fail the workflow.

## Verification

- Backend route test for `POST /api/devices/:id/source`.
- SSH service tests for generated SNMP config and missing-sentinel failure.
- Frontend build verifies the modal wiring.
- Backend route test for `POST /api/devices/:id/reprobe` verifies identity update on the existing device.
- Agent tests verify driver restart fallback and `upsc` retry after NUT restarts.
