# NUT Source Health Design

## Goal

Flux should warn when a UPS appears online through NUT but the local UPS data source is degraded, such as a USB HID UPS that has disappeared from the host while `upsd` still serves cached variables.

## Approach

UPS host agents will report a `nutHealth` object with each NUT status message. The backend will store that object on the UPS `Device` linked to the reporting agent's `upsGroupId`. The frontend will render `nutHealth.state` as a separate health warning that can override the visual "Online" presentation without hiding the raw `ups.status`.

This keeps SSH credentials out of routine polling and works with the existing agent architecture. Health checks are source-aware: USB sources verify local USB presence, while future SNMP/AP9630 sources skip USB checks and can report network reachability.

## Data Shape

`nutHealth`:

```json
{
  "state": "ok",
  "sourceType": "usb",
  "message": "USB data source healthy",
  "checkedAt": "2026-06-24T14:00:00.000Z",
  "checks": {
    "upscReachable": true,
    "nutServerActive": true,
    "nutDriverActive": true,
    "usbDevicePresent": true
  }
}
```

States are `ok`, `degraded`, `error`, or `unknown`. For USB, missing `vendorid` devices produce `degraded` when `upsc` still works, and `error` when NUT polling also fails.

## Components

- `flux-agent/services/nut.js`: add health diagnostics helpers.
- `flux-agent/agent.js`: include `nutHealth` in status messages.
- `backend/models/Device.js`: add `nutHealth` JSON storage.
- `backend/services/agentHub.js`: save agent-reported `nutHealth` to the linked device.
- `frontend/src/pages/PowerCenter.jsx`, `frontend/src/components/DeviceCard.jsx`, and `frontend/src/pages/DeviceDetail.jsx`: show source health warnings.

## Testing

Agent tests will cover USB present, USB missing with reachable NUT, and NUT poll failure. Backend tests will cover saving `nutHealth` from an agent status message to the linked `Device`.
