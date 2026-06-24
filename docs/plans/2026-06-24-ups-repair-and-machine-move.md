# UPS Repair and Machine Move Implementation Plan

> Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repair CTA support for installed-but-unconfigured NUT hosts and let assigned machines move between UPS groups with UPS-specific fields reset.

**Architecture:** Extend existing routes and controls instead of adding new models. `discover-nut` returns richer error metadata, `/install-nut` remains the repair action, and `PUT /api/agents/:id` gets an explicit `resetUpsAssignment` flag.

**Tech Stack:** Node.js, Express, Sequelize, Jest, React, Vite.

---

### Task 1: Repairable NUT Discovery

**Files:**
- Modify: `backend/routes/devices.js`
- Test: `backend/__tests__/deviceNutRoute.test.js`
- Modify: `frontend/src/components/AddUpsWizard.jsx`

- [x] **Step 1: Add failing backend test for USB UPS present but NUT inactive**

Run: `cd backend && npm test -- --runTestsByPath __tests__/deviceNutRoute.test.js`

Expected: FAIL until `discoverNut` returns `repairable: true`.

- [x] **Step 2: Implement live/config discovery split**

Change discovery to use live `upsc -l` names for success and physical USB presence for repairable 422 responses.

- [x] **Step 3: Add repair CTA in Add UPS wizard**

Show **Configure / Repair NUT on this host** when `repairable` is true, wired to existing `/api/devices/install-nut`.

### Task 2: Move Machine Between UPS Groups

**Files:**
- Modify: `backend/routes/agents.js`
- Test: `backend/__tests__/agentRoute.test.js`
- Modify: `frontend/src/pages/PowerCenter.jsx`

- [x] **Step 1: Add failing backend test for move/reset**

Run: `cd backend && npm test -- --runTestsByPath __tests__/agentRoute.test.js`

Expected: FAIL until `resetUpsAssignment` clears UPS-specific fields.

- [x] **Step 2: Implement reset flag**

When `resetUpsAssignment: true` is sent with `upsGroupId`, clear shutdown order/delay and outlet metadata, and reset timeout to the model default.

- [x] **Step 3: Add assigned-row Move UPS control**

Show a compact **Move UPS** selector on assigned machine rows, excluding the current UPS and using the reset flag.

### Task 3: Verification and Packaging

**Files:**
- No new production files beyond Tasks 1-2.

- [x] **Step 1: Run backend tests**

Run: `cd backend && npm test`

- [x] **Step 2: Build frontend**

Run: `cd frontend && npm run build`

- [x] **Step 3: Commit, mirror to private repo, deploy**

Commit public and private repos, rebuild Docker prod, and deploy native backend if needed.

Result: public `42bfc23` and private `475d08b` were pushed. Native `.135` was updated in `/opt/flux`, restarted, and returned `/api/health` OK. Docker `.25` was fast-forwarded, rebuilt with `docker compose up -d --build`, and backend health returned OK.
