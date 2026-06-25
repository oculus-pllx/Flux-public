# Power Center Card Ordering Implementation Plan

> Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose drag-and-drop ordering for UPS cards on the Power Center page.

**Architecture:** Store card order on `Device.displayOrder`, sort device API responses by that field, and add an authenticated bulk reorder route. Power Center will use native HTML drag/drop from a visible handle in each UPS header, optimistically reorder local state, and persist the ordered device IDs.

**Tech Stack:** Express, Sequelize, Jest/Supertest, React 18, Vite, Axios, native HTML drag/drop.

---

## File Structure

- Modify `backend/models/Device.js`: add `displayOrder` integer column with default `0`.
- Modify `backend/routes/devices.js`: add sorted device listing helpers and `PUT /api/devices/order`.
- Modify `backend/__tests__/deviceNutRoute.test.js`: add route coverage for sorted reads, persistence, validation, and authorization.
- Modify `frontend/src/pages/PowerCenter.jsx`: add drag state, reorder persistence, error handling, and the visible drag handle.

## Task 1: Backend Device Ordering Tests

**Files:**
- Modify: `backend/__tests__/deviceNutRoute.test.js`

- [ ] **Step 1: Add failing tests**

Append a `describe('UPS card ordering')` block that creates three devices with unsorted `displayOrder` values, asserts `GET /api/devices` returns display order, asserts `PUT /api/devices/order` persists a new order, asserts unknown IDs return `404`, and asserts viewer tokens return `403`.

```js
describe('UPS card ordering', () => {
  it('lists devices by displayOrder, then name, then id', async () => {
    await Device.create({ name: 'Rack C', host: '10.0.0.3', upsName: 'c', displayOrder: 20 })
    await Device.create({ name: 'Rack A', host: '10.0.0.1', upsName: 'a', displayOrder: 10 })
    await Device.create({ name: 'Rack B', host: '10.0.0.2', upsName: 'b', displayOrder: 10 })

    const res = await request(app).get('/api/devices').set(auth)

    expect(res.status).toBe(200)
    expect(res.body.map(d => d.name)).toEqual(['Rack A', 'Rack B', 'Rack C'])
  })

  it('persists a submitted UPS card order', async () => {
    const first = await Device.create({ name: 'First', host: '10.0.0.11', upsName: 'first' })
    const second = await Device.create({ name: 'Second', host: '10.0.0.12', upsName: 'second' })
    const third = await Device.create({ name: 'Third', host: '10.0.0.13', upsName: 'third' })

    const res = await request(app)
      .put('/api/devices/order')
      .set(auth)
      .send({ deviceIds: [third.id, first.id, second.id] })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.devices.map(d => d.id)).toEqual([third.id, first.id, second.id])

    await first.reload()
    await second.reload()
    await third.reload()
    expect(third.displayOrder).toBe(1)
    expect(first.displayOrder).toBe(2)
    expect(second.displayOrder).toBe(3)
  })

  it('rejects unknown IDs when ordering UPS cards', async () => {
    const device = await Device.create({ name: 'Only', host: '10.0.0.21', upsName: 'only' })

    const res = await request(app)
      .put('/api/devices/order')
      .set(auth)
      .send({ deviceIds: [device.id, 99999] })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('rejects viewers when ordering UPS cards', async () => {
    const device = await Device.create({ name: 'Only', host: '10.0.0.31', upsName: 'only' })

    const res = await request(app)
      .put('/api/devices/order')
      .set({ Authorization: `Bearer ${viewerToken}` })
      .send({ deviceIds: [device.id] })

    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && npm test -- deviceNutRoute.test.js
```

Expected: FAIL because `displayOrder` and `PUT /api/devices/order` do not exist yet.

## Task 2: Backend Device Ordering Implementation

**Files:**
- Modify: `backend/models/Device.js`
- Modify: `backend/routes/devices.js`
- Test: `backend/__tests__/deviceNutRoute.test.js`

- [ ] **Step 1: Add the model field**

Add this field to the `Device` model:

```js
displayOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
```

- [ ] **Step 2: Add sorted listing helpers and route**

In `backend/routes/devices.js`, add a shared device order constant:

```js
const DEVICE_ORDER = [['displayOrder', 'ASC'], ['name', 'ASC'], ['id', 'ASC']]
```

Change `GET /api/devices` to:

```js
const devices = await Device.findAll({ order: DEVICE_ORDER })
```

Add `PUT /api/devices/order` before `router.get('/:id', ...)`:

```js
router.put('/order', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const ids = req.body.deviceIds
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'deviceIds must be a non-empty array' })
    }
    const deviceIds = ids.map(id => Number(id))
    if (deviceIds.some(id => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'deviceIds must contain only positive integer IDs' })
    }
    if (new Set(deviceIds).size !== deviceIds.length) {
      return res.status(400).json({ error: 'deviceIds must not contain duplicates' })
    }

    const devices = await Device.findAll({ where: { id: deviceIds } })
    if (devices.length !== deviceIds.length) {
      return res.status(404).json({ error: 'One or more devices were not found' })
    }

    await Promise.all(deviceIds.map((id, index) =>
      Device.update({ displayOrder: index + 1 }, { where: { id } })
    ))

    const ordered = await Device.findAll({ order: DEVICE_ORDER })
    res.json({ ok: true, devices: ordered.map(sanitizeDevice) })
  } catch (err) { next(err) }
})
```

- [ ] **Step 3: Run tests to verify GREEN**

Run:

```bash
cd backend && npm test -- deviceNutRoute.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit backend ordering**

Run:

```bash
git add backend/models/Device.js backend/routes/devices.js backend/__tests__/deviceNutRoute.test.js
git commit -m "feat: persist power center card order"
```

## Task 3: Frontend Drag Handle Ordering

**Files:**
- Modify: `frontend/src/pages/PowerCenter.jsx`

- [ ] **Step 1: Add drag props to `UpsHeader`**

Extend `UpsHeader` props with `dragHandleProps`, and render a handle before the UPS title when present:

```jsx
{dragHandleProps && (
  <span
    {...dragHandleProps}
    title="Drag to reorder"
    aria-label="Drag to reorder UPS card"
    style={{
      color: 'var(--flux-muted)',
      cursor: 'grab',
      fontSize: 16,
      lineHeight: 1,
      userSelect: 'none',
      padding: '2px 6px 2px 0',
    }}>
    ⋮⋮
  </span>
)}
```

- [ ] **Step 2: Add reorder state and helper in `PowerCenter`**

Add state:

```jsx
const [draggingDeviceId, setDraggingDeviceId] = useState(null)
const [dragOverDeviceId, setDragOverDeviceId] = useState(null)
const [reorderError, setReorderError] = useState('')
```

Add a `reorderDevices` helper that removes the dragged item, inserts it at the target index, updates local state, calls `PUT /api/devices/order`, and reloads on failure.

- [ ] **Step 3: Wire card drag events**

On each UPS card wrapper, handle `onDragOver`, `onDragLeave`, and `onDrop`. Pass `dragHandleProps` into `UpsHeader` only when `canWrite` is true. Use `dataTransfer.effectAllowed = 'move'` and `dataTransfer.setData('text/plain', String(device.id))`.

- [ ] **Step 4: Add visual states**

Apply reduced opacity to the dragged card and an accent border/box shadow to the current drop target. Show `reorderError` near the page header when present.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS, with only the existing Vite chunk-size warning.

- [ ] **Step 6: Commit frontend ordering**

Run:

```bash
git add frontend/src/pages/PowerCenter.jsx
git commit -m "feat: add power center drag ordering"
```

## Task 4: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend && npm test
```

Expected: all test suites pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes, with only the existing Vite chunk-size warning.

- [ ] **Step 3: Check git state**

Run:

```bash
git status --short --branch
```

Expected: branch is ahead with implementation commits; only intentionally untracked `HANDOFF.md` remains.
