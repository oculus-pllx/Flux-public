# UPS Machine Assignment and Manual Updates Design

## Goal

Make two existing capabilities visible and usable: assign an existing enrolled/control machine to a UPS from the UPS card, and manually check/apply server updates from the System page.

## Design

Flux already stores UPS membership on `AgentMachine.upsGroupId`, so the UPS card should not create a new relationship model. Each UPS header will expose an `Assign Machine` action for admins/operators. The selector will list enrolled machines not already assigned to that UPS, including unassigned machines and machines currently assigned to a different UPS, then save by calling `PUT /api/agents/:id` with `{ upsGroupId: device.id }`.

The System page already uses `/api/system/update`, but hides actions behind update availability and install mode. The update card will get an explicit `Check for Updates` button and a consistently visible action area. When one-click update is available, `Update Now` can be pressed whenever the user wants to manually trigger the updater. When the install is manual or Docker without sidecar, the page will show the command/instructions instead of hiding the update path.

## Error Handling

Machine assignment failures show an inline error in the UPS header and do not mutate local state until reload succeeds. Update failures continue to show the backend message returned by `/api/system/update`, including power-event refusal or unavailable updater mode.

## Testing

Backend route tests will cover reassignment through `PUT /api/agents/:id` and manual update trigger behavior through `POST /api/system/update`. Frontend verification is by `npm run build` because this repository currently has no frontend test runner.
