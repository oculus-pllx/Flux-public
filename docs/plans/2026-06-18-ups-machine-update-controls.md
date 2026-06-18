# UPS Machine Assignment and Manual Updates Implementation Plan

> Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose existing UPS machine assignment and server update operations clearly in the UI.

**Architecture:** Reuse `AgentMachine.upsGroupId` and existing `/api/agents/:id` updates for assignment. Reuse existing `/api/system/update` endpoints for update checks and manual update starts, changing frontend visibility rather than adding duplicate backend flows.

**Tech Stack:** Express, Sequelize, Jest/Supertest, React, Vite.

---

### Task 1: Backend Behavior Guardrails

**Files:**
- Modify: `backend/__tests__/agentRoute.test.js`
- Modify: `backend/__tests__/systemUpdateRoute.test.js`

- [x] **Step 1: Write failing tests**

Add tests proving `PUT /api/agents/:id` can assign an existing machine to a UPS and `POST /api/system/update` triggers the updater even when the status card was not showing an available version.

- [x] **Step 2: Run tests and verify failure or existing coverage**

Run: `npm test -- agentRoute systemUpdateRoute --runInBand`

- [x] **Step 3: Implement minimal backend changes only if tests reveal missing behavior**

Expected backend behavior already exists. If tests fail because the route blocks `upsGroupId` or update trigger, patch the relevant route.

- [x] **Step 4: Run tests to verify pass**

Run: `npm test -- agentRoute systemUpdateRoute --runInBand`

### Task 2: UPS Header Assignment UI

**Files:**
- Modify: `frontend/src/pages/PowerCenter.jsx`

- [x] **Step 1: Add an assign-machine control to each UPS header**

Pass all agents into `UpsHeader`, derive machines not already on the current UPS, and render an `Assign Machine` selector next to existing UPS actions.

- [x] **Step 2: Save selection through the existing agent route**

On selection, call `PUT /api/agents/:id` with `{ upsGroupId: device.id }`, then call `onRefresh()`.

- [x] **Step 3: Preserve existing unassigned-machine assignment control**

Keep the existing unassigned machine row `Assign UPS` button unchanged.

### Task 3: Manual Update UI

**Files:**
- Modify: `frontend/src/pages/SystemPage.jsx`

- [x] **Step 1: Add a visible Check for Updates button**

Refetch `/api/system/update`, clear errors, and update the status state.

- [x] **Step 2: Make Update Now visible for one-click-capable installs**

Render the button when `status.mode !== 'manual'`, not only when `status.updateAvailable` is true.

- [x] **Step 3: Keep manual/Docker instructions visible when one-click is unavailable**

Render the manual command/instructions whenever `status.mode === 'manual'`.

### Task 4: Verification, Mirror, Release, and Instance Update

**Files:**
- Mirror changed files to `/srv/ccc/projects/Flux-public`

- [x] **Step 1: Run targeted backend tests**

Run: `npm test -- agentRoute systemUpdateRoute --runInBand`

- [x] **Step 2: Build frontend**

Run: `npm run build` in `frontend`.

- [x] **Step 3: Mirror to public repo and repeat verification**

Apply the private diff to `/srv/ccc/projects/Flux-public`, then run the same tests/build.

- [ ] **Step 4: Commit and push both repos**

Commit private and public changes with the same message, then push `main`.

- [ ] **Step 5: Rebuild public `.deb` release asset**

Run `npm run build:installer:linux` in the public repo and upload `dist-installer/flux_2.0.0_amd64.deb` to release `v2.0.0`.

- [ ] **Step 6: Check/update `192.168.0.25`**

Call `/api/health` and `/api/system/update` when credentials are available. If unauthenticated access blocks update, report exactly what credential or token is needed.
