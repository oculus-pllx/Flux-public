# Power Center Card Ordering Design

## Goal

Power Center should let admins and operators reorder UPS cards with a clear visual drag affordance, and that order should persist for all users.

## Current Behavior

Power Center renders UPS cards in the order returned by `GET /api/devices`. Device rows do not currently have a display-order field, so the order is effectively database/default query order. Machine shutdown ordering inside each UPS card is separate and remains controlled by each agent machine's shutdown fields.

## Proposed Behavior

Add a persisted UPS card order on `Device` rows using a new integer `displayOrder` field. `GET /api/devices` will return devices ordered by `displayOrder ASC`, then `name ASC`, then `id ASC` so old rows and ties remain deterministic.

Power Center will show a drag handle in every UPS card header for admins and operators. The handle will use a compact visual marker such as `⋮⋮` and a tooltip of `Drag to reorder`. The rest of the header remains clickable for existing controls, but only the handle starts a reorder drag.

While dragging, the dragged card gets reduced opacity and the current drop target gets an accent insertion indicator. Dropping a card updates the local UI immediately and sends the new ordered device IDs to the backend. If saving fails, Power Center reloads the server order and shows a compact error message.

Viewers cannot reorder cards, but they see the saved order.

## API Design

Add `PUT /api/devices/order`, restricted to admins and operators.

Request body:

```json
{
  "deviceIds": [3, 1, 8, 4]
}
```

Backend validation:

- `deviceIds` must be a non-empty array.
- Every entry must be an integer.
- Every ID must refer to an existing `Device`.
- The route will update only the submitted devices, assigning `displayOrder` from the array index.

Response body:

```json
{
  "ok": true,
  "devices": []
}
```

The response includes sanitized devices in the same sorted order used by `GET /api/devices`.

## Frontend Design

`PowerCenter.jsx` will keep the loaded device list as the display source. A drag operation tracks the dragged device ID and the drop target ID. On drop, it computes the reordered array, updates local state, then calls `PUT /api/devices/order`.

The drag handle is rendered inside `UpsHeader` only when `canWrite` is true. The handle has:

- `draggable=true`
- a visible grip marker
- a tooltip
- keyboard-neutral behavior that does not interfere with existing header buttons

Native HTML drag/drop is sufficient for the vertical UPS list and avoids a new dependency. If touch behavior is poor in practice, a follow-up can add small up/down fallback buttons beside the drag handle without changing the backend.

## Error Handling

If save fails, the UI shows a short reorder error near the Power Center header and reloads devices from the backend. This avoids leaving the user with a local order that was not persisted.

Backend validation failures return `400` for malformed input, `404` for missing devices, and require the existing auth middleware for unauthenticated or unauthorized access.

## Testing

Backend route tests will cover:

- `PUT /api/devices/order` persists the requested order.
- `GET /api/devices` returns devices in `displayOrder` order.
- invalid IDs are rejected.
- viewers cannot reorder.

Frontend verification will cover:

- production build succeeds.
- manual UI check that drag handles are visible for write-capable users and the Power Center list reorders after drop.

## Out Of Scope

- Reordering machines inside UPS cards.
- Changing shutdown order behavior.
- Replacing per-agent Proxmox/PBS config storage with central references.
- Adding a drag/drop dependency.
