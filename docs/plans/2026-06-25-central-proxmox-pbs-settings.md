# Central Proxmox/PBS Settings Implementation Plan

> Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Settings -> Proxmox/PBS flow that stores shared PVE/PBS credentials, tests them, previews Proxmox node matches, and applies generated config only to operator-selected agents.

**Architecture:** Add focused Sequelize models for central configs, a backend service for redaction/matching/apply behavior, and a route module under `/api/settings/proxmox-pbs`. The frontend extends the existing Settings page with Proxmox and PBS panels that call those APIs and make assignment choices explicit.

**Tech Stack:** Node.js, Express, Sequelize, Jest/Supertest, React, Vite, Axios.

---

### Task 1: Backend Models And Redaction

**Files:**
- Create: `backend/models/ProxmoxClusterConfig.js`
- Create: `backend/models/PbsConfig.js`
- Create: `backend/services/proxmoxPbsSettingsService.js`
- Create: `backend/__tests__/proxmoxPbsSettingsRoute.test.js`

- [ ] **Step 1: Write failing route tests for CRUD redaction**

Create `backend/__tests__/proxmoxPbsSettingsRoute.test.js` with tests that mount `/api/settings/proxmox-pbs`, create a Proxmox cluster and PBS config with secrets, assert responses include `hasTokenSecret: true`, assert `tokenSecret` is absent, and assert an update without `tokenSecret` preserves the old secret.

- [ ] **Step 2: Run test to verify RED**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: FAIL because the route and models do not exist.

- [ ] **Step 3: Implement minimal models, redaction helpers, and CRUD routes**

Add models with fields from the spec. Add service helpers:

```js
function redactConfig(row) {
  const json = row.toJSON ? row.toJSON() : { ...row }
  const hasTokenSecret = !!json.tokenSecret
  delete json.tokenSecret
  return { ...json, hasTokenSecret }
}
```

Add route handlers for:

```text
GET /api/settings/proxmox-pbs/proxmox-clusters
POST /api/settings/proxmox-pbs/proxmox-clusters
PUT /api/settings/proxmox-pbs/proxmox-clusters/:id
GET /api/settings/proxmox-pbs/pbs-configs
POST /api/settings/proxmox-pbs/pbs-configs
PUT /api/settings/proxmox-pbs/pbs-configs/:id
```

Mount the new route from `backend/routes/settings.js` before the base settings handlers.

- [ ] **Step 4: Run test to verify GREEN**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/models/ProxmoxClusterConfig.js backend/models/PbsConfig.js backend/services/proxmoxPbsSettingsService.js backend/routes/settings.js backend/__tests__/proxmoxPbsSettingsRoute.test.js
git commit -m "feat: add central proxmox pbs settings storage"
```

### Task 2: Proxmox Discovery, Matching, And Apply

**Files:**
- Modify: `backend/services/proxmoxService.js`
- Modify: `backend/services/proxmoxPbsSettingsService.js`
- Modify: `backend/routes/settings.js`
- Modify: `backend/__tests__/proxmoxPbsSettingsRoute.test.js`

- [ ] **Step 1: Write failing tests for discovery and selected apply**

Extend `proxmoxPbsSettingsRoute.test.js` to mock `proxmoxService.listNodes` and `agentHub.sendToMachine`. Tests must cover normalized hostname matching, ambiguous duplicate matches requiring selection, applying only selected rows, preserving unrelated machine fields, and offline push reporting.

- [ ] **Step 2: Run test to verify RED**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: FAIL because discovery/apply endpoints and `listNodes` are missing.

- [ ] **Step 3: Implement Proxmox support**

Add `listNodes(pveConfig)` to `backend/services/proxmoxService.js` using `apiRequest(pveConfig, 'GET', '/nodes')`.

Add service helpers:

```js
function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().split('.')[0]
}

function buildPveConfig(cluster, node) {
  return {
    url: cluster.apiBaseUrl,
    tokenId: cluster.tokenId,
    tokenSecret: cluster.tokenSecret,
    node,
  }
}
```

Implement:

```text
POST /api/settings/proxmox-pbs/proxmox-clusters/:id/test
POST /api/settings/proxmox-pbs/proxmox-clusters/:id/discover
POST /api/settings/proxmox-pbs/proxmox-clusters/:id/apply
```

The apply request body must include `targets: [{ node, agentMachineId }]`. Only those selected rows are changed.

- [ ] **Step 4: Run test to verify GREEN**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/proxmoxService.js backend/services/proxmoxPbsSettingsService.js backend/routes/settings.js backend/__tests__/proxmoxPbsSettingsRoute.test.js
git commit -m "feat: apply central proxmox settings to selected agents"
```

### Task 3: PBS Test And Choosable UPS Assignment

**Files:**
- Create: `backend/services/pbsService.js`
- Modify: `backend/services/proxmoxPbsSettingsService.js`
- Modify: `backend/routes/settings.js`
- Modify: `backend/__tests__/proxmoxPbsSettingsRoute.test.js`

- [ ] **Step 1: Write failing tests for PBS apply**

Extend route tests to mock PBS API checks and `agentHub.sendToMachine`. Cover applying `pbsConfig` to one selected PBS agent, optional UPS assignment with reset of shutdown/order/outlet fields, no UPS move when not selected, and offline push reporting.

- [ ] **Step 2: Run test to verify RED**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: FAIL because PBS test/apply endpoints are missing.

- [ ] **Step 3: Implement PBS service and apply endpoints**

Create `backend/services/pbsService.js` with `apiRequest(pbsConfig, method, path, body)` and `testConnection(pbsConfig)` using `GET /nodes/localhost/tasks?running=1`.

Implement:

```text
POST /api/settings/proxmox-pbs/pbs-configs/:id/test
POST /api/settings/proxmox-pbs/pbs-configs/:id/apply
```

The apply body must include `agentMachineId`, and may include `assignUpsGroupId`. Only when `assignUpsGroupId` is present should UPS move reset fields be updated.

- [ ] **Step 4: Run test to verify GREEN**

Run: `cd backend && npm test -- proxmoxPbsSettingsRoute.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/pbsService.js backend/services/proxmoxPbsSettingsService.js backend/routes/settings.js backend/__tests__/proxmoxPbsSettingsRoute.test.js
git commit -m "feat: apply central pbs settings by selected assignment"
```

### Task 4: Settings UI

**Files:**
- Modify: `frontend/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Add Proxmox/PBS panels**

Extend `SettingsPage.jsx` with compact panels for Proxmox clusters and PBS configs. The Proxmox panel must save/test/discover, show matched rows with checkboxes and agent selectors, and apply only checked rows. The PBS panel must save/test, require a selected PBS agent, and expose a checkbox plus dropdown for optional UPS assignment.

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SettingsPage.jsx
git commit -m "feat: add proxmox pbs settings UI"
```

### Task 5: Full Verification

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run backend tests**

Run: `cd backend && npm test`

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 3: Update handoff**

Update `HANDOFF.md` with the implemented consolidation flow, verification output, and live next steps. Do not commit `HANDOFF.md`.

- [ ] **Step 4: Final status**

Run: `git status --short --branch`

Expected: branch ahead with committed implementation changes and only untracked `HANDOFF.md`.
