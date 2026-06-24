# NUT Source Health Implementation Plan

> Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a GUI warning when a UPS host loses its USB/SNMP data source even if NUT still serves cached UPS variables.

**Architecture:** The UPS-host agent computes `nutHealth` locally and includes it in existing `status` WebSocket messages. The backend stores it on the linked `Device`, and the frontend renders warning/error states from `device.nutHealth`.

**Tech Stack:** Node.js, Jest, Sequelize/SQLite, React.

---

### Task 1: Agent Health Diagnostics

**Files:**
- Modify: `flux-agent/services/nut.js`
- Test: `flux-agent/__tests__/nut.test.js`

- [x] **Step 1: Write failing tests**

Add tests for `checkHealth`: USB present returns `ok`, USB missing returns `degraded`, failed `upsc` returns `error`.

- [x] **Step 2: Run red test**

Run: `cd flux-agent && npm test -- --runInBand __tests__/nut.test.js`

Expected: FAIL because `checkHealth` is not exported.

- [x] **Step 3: Implement minimal health diagnostics**

Add `checkHealth(nutConfig, options)` with injectable `run` for tests, `lsusb -d`, `systemctl is-active`, and `pollStatus`.

- [x] **Step 4: Run green test**

Run: `cd flux-agent && npm test -- --runInBand __tests__/nut.test.js`

Expected: PASS.

### Task 2: Agent Status Message Includes Health

**Files:**
- Modify: `flux-agent/agent.js`
- Test: `flux-agent/__tests__/agent.test.js` if present, otherwise cover by testing `services/nut.js` and backend handling.

- [x] **Step 1: Add `nutHealth` to status send path**

After `pollStatus`, call `checkHealth` and include the result in the existing `status` message.

- [x] **Step 2: Verify agent tests**

Run: `cd flux-agent && npm test -- --runInBand`

Expected: PASS.

### Task 3: Backend Storage

**Files:**
- Modify: `backend/models/Device.js`
- Modify: `backend/services/agentHub.js`
- Test: `backend/__tests__/agentHub.test.js`

- [x] **Step 1: Write failing backend test**

Add a test where an agent with `upsGroupId` sends status with `nutHealth`, and the linked `Device.nutHealth` is updated.

- [x] **Step 2: Run red test**

Run: `cd backend && npm test -- --runInBand __tests__/agentHub.test.js`

Expected: FAIL because `Device.nutHealth` is not updated.

- [x] **Step 3: Implement storage**

Add `nutHealth` JSON field on `Device` and update it from `handleStatus` when `msg.nutHealth` and `machine.upsGroupId` are present.

- [x] **Step 4: Run green test**

Run: `cd backend && npm test -- --runInBand __tests__/agentHub.test.js`

Expected: PASS.

### Task 4: Frontend Warnings

**Files:**
- Modify: `frontend/src/pages/PowerCenter.jsx`
- Modify: `frontend/src/components/DeviceCard.jsx`
- Modify: `frontend/src/pages/DeviceDetail.jsx`

- [x] **Step 1: Render source health**

Show `nutHealth.message` when state is `degraded` or `error`; use warning/critical color and override header state color while retaining raw `ups.status`.

- [x] **Step 2: Build frontend**

Run: `cd frontend && npm run build`

Expected: PASS.

### Task 5: Full Verification and Deploy Note

**Files:**
- No new files.

- [x] **Step 1: Run backend and agent tests**

Run: `cd backend && npm test -- --runInBand`; `cd flux-agent && npm test -- --runInBand`

Result: PASS in both public and private checkouts after the reprobe/offline fixes.

- [x] **Step 2: Build frontend**

Run: `cd frontend && npm run build`

Result: PASS during the production packaging pass.

- [x] **Step 3: Deploy manually to local Docker install only after tests pass**

Result: deployed to native prod `.135`, UPS host `.23`, and local Docker prod `.25`. Rebuilt `.25` Docker backend and verified healthy.

### Task 6: Reprobe and Offline Follow-up

**Files:**
- Modify: `flux-agent/services/nut.js`
- Modify: `flux-agent/agent.js`
- Modify: `backend/routes/devices.js`
- Modify: `backend/services/pollingService.js`
- Test: `flux-agent/__tests__/nut.test.js`
- Test: `backend/__tests__/deviceNutRoute.test.js`
- Test: `backend/__tests__/pollingService.test.js`

- [x] **Step 1: Reprobe handles NUT restart timing**

The UPS-host agent now retries `upsc` after restarting NUT so transient `Connection refused` from `upsd` startup does not fail the UI action.

- [x] **Step 2: Reprobe handles driver restart failure**

The UPS-host agent falls back to `upsdrvctl start <upsName>` when `systemctl restart nut-driver@<upsName>` exits nonzero.

- [x] **Step 3: Reprobe updates the current Flux device identity**

Backend reprobe saves the returned variables and renames the existing device to the detected UPS model while preserving assignments, history, credentials, and shutdown relationships.

- [x] **Step 4: Poll failures clear stale online data**

Backend polling now clears `lastStatus`, sets `lastSeen` to null, and stores `nutHealth.state = error` when polling fails. This covers hosts such as `.24` where `upsc -l` can still list a stale configured UPS but no USB UPS is attached.
