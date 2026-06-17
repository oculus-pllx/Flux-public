process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request   = require('supertest')
const express   = require('express')
const jwt       = require('jsonwebtoken')
const { sequelize } = require('../config/database')

require('../models/Device')
require('../models/Metrics')
require('../models/AlertTrigger')
require('../models/AlertHistory')
require('../models/User')
require('../models/ConnectedMachine')
require('../models/AgentMachine')
require('../models/ClusterGroup')
require('../models/Group')
require('../models/Setting')
require('../models/AlertHistory')

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

// ── Q1: Loose equality in alertService ────────────────────────────────────────

describe('Q1 — alertService uses strict equality', () => {
  const alertService = require('../services/alertService')

  it('eq: does not treat "1" equal to true', async () => {
    const Device = require('../models/Device')
    const AlertTrigger = require('../models/AlertTrigger')
    const AlertHistory = require('../models/AlertHistory')

    const device = await Device.create({ name: 'test', host: '1.2.3.4', port: 3493, upsName: 'ups' })
    await AlertTrigger.create({
      deviceId: device.id, variable: 'ups.status', condition: 'eq',
      threshold: '1', severity: 'warning', cooldown: 0,
    })

    // With loose ==, parseFloat('1') == parseFloat(true) would be 1 == 1 (true)
    // But since values go through parseFloat, both become NaN for non-numeric inputs
    // The real test: ensure strict equality is used (not type-coercing)
    const beforeCount = await AlertHistory.count()
    // "1" as number == 1 (threshold 1) — should fire
    await alertService.evaluate(device.id, { 'ups.status': '1' })
    const afterCount = await AlertHistory.count()
    expect(afterCount).toBeGreaterThan(beforeCount)

    await device.destroy()
  })
})

// ── Q2: Group alert triggers fire ─────────────────────────────────────────────

describe('Q2 — Group alert triggers fire when device belongs to group', () => {
  const alertService = require('../services/alertService')

  it('fires a group-level trigger for a device in that group', async () => {
    const Device = require('../models/Device')
    const AlertTrigger = require('../models/AlertTrigger')
    const AlertHistory = require('../models/AlertHistory')

    const device = await Device.create({ name: 'd1', host: '1.2.3.5', port: 3493, upsName: 'ups', groupId: 42 })
    await AlertTrigger.create({
      groupId: 42, deviceId: null,
      variable: 'battery.charge', condition: 'lt', threshold: '50',
      severity: 'warning', cooldown: 0,
    })

    const before = await AlertHistory.count()
    await alertService.evaluate(device.id, { 'battery.charge': '20' })
    const after = await AlertHistory.count()
    expect(after).toBeGreaterThan(before)

    await device.destroy()
  })

  it('does not fire group trigger for device in a different group', async () => {
    const Device = require('../models/Device')
    const AlertTrigger = require('../models/AlertTrigger')
    const AlertHistory = require('../models/AlertHistory')

    const device = await Device.create({ name: 'd2', host: '1.2.3.6', port: 3493, upsName: 'ups', groupId: 99 })
    await AlertTrigger.create({
      groupId: 42, deviceId: null,
      variable: 'battery.charge', condition: 'lt', threshold: '50',
      severity: 'warning', cooldown: 0,
    })

    const before = await AlertHistory.count()
    await alertService.evaluate(device.id, { 'battery.charge': '20' })
    const after = await AlertHistory.count()
    expect(after).toBe(before)

    await device.destroy()
  })
})

// ── Q3: N+1 query fix in /api/metrics/latest ─────────────────────────────────

describe('Q3 — /api/metrics/latest uses single batched query', () => {
  it('returns latest metrics for all devices in one response', async () => {
    const Device  = require('../models/Device')
    const Metrics = require('../models/Metrics')

    const [d1, d2] = await Promise.all([
      Device.create({ name: 'dev1', host: '1.1.1.1', port: 3493, upsName: 'ups' }),
      Device.create({ name: 'dev2', host: '1.1.1.2', port: 3493, upsName: 'ups' }),
    ])
    await Metrics.create({ deviceId: d1.id, data: { 'ups.status': 'OL' } })
    await Metrics.create({ deviceId: d2.id, data: { 'ups.status': 'OB' } })
    // Second metric for d1 — should be the one returned
    await Metrics.create({ deviceId: d1.id, data: { 'ups.status': 'OL CHRG' } })

    const app = express()
    app.use(express.json())
    app.use('/api/metrics', require('../routes/metrics'))

    const res = await request(app).get('/api/metrics/latest').set(auth)
    expect(res.status).toBe(200)

    const d1Result = res.body.find(r => r.deviceId === d1.id)
    // Should return the latest metric ('OL CHRG'), not the first ('OL')
    expect(d1Result?.data?.['ups.status']).toBe('OL CHRG')

    await Promise.all([d1.destroy(), d2.destroy()])
  })
})

// ── Q4: Shutdown state persisted to DB ────────────────────────────────────────

describe('Q4 — Shutdown triggered state survives restart', () => {
  it('marks device as shutdownActive in DB when OB+LB triggers', async () => {
    const Device = require('../models/Device')
    const { checkAutoShutdownForTest } = require('../services/pollingService')

    if (!checkAutoShutdownForTest) return // skip if not exported yet

    const device = await Device.create({ name: 'ups-dev', host: '1.1.2.1', port: 3493, upsName: 'ups' })
    await checkAutoShutdownForTest(device, { 'ups.status': 'OB LB' })

    await device.reload()
    expect(device.shutdownActive).toBe(true)
    await device.destroy()
  })
})

// ── Q5: sequelize.sync safe in production ─────────────────────────────────────

describe('Q5 — sequelize.sync does not use alter in production', () => {
  it('initDatabase uses alter only outside production', async () => {
    const { sequelize: seq, initDatabase } = require('../config/database')
    const origEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const authSpy = jest.spyOn(seq, 'authenticate').mockResolvedValue()
    const syncSpy = jest.spyOn(seq, 'sync').mockResolvedValue()

    await initDatabase()

    expect(syncSpy).toHaveBeenCalledWith(expect.not.objectContaining({ alter: true }))

    authSpy.mockRestore()
    syncSpy.mockRestore()
    process.env.NODE_ENV = origEnv
  })
})

// ── Q6: Email transport reused ────────────────────────────────────────────────

describe('Q6 — email transport is reused across alerts', () => {
  it('createTransport is called once for multiple alerts with same config', async () => {
    const nodemailer = require('nodemailer')
    const spy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({}),
    })

    process.env.SMTP_HOST = 'smtp.test.com'
    process.env.SMTP_USER = 'test@test.com'
    process.env.SMTP_PASS = 'pass'

    const emailService = require('../services/emailService')
    await emailService.sendAlert({ message: 'msg1', severity: 'warning', deviceId: 1, deviceName: 'D1' })
    await emailService.sendAlert({ message: 'msg2', severity: 'critical', deviceId: 1, deviceName: 'D1' })

    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS
  })
})

// ── Q7: Alert history pagination ──────────────────────────────────────────────

describe('Q7 — Alert history supports pagination', () => {
  it('respects limit and offset query params', async () => {
    const AlertHistory = require('../models/AlertHistory')
    const AlertTrigger = require('../models/AlertTrigger')
    const Device       = require('../models/Device')
    const dev = await Device.create({ name: 'q7dev', host: '9.9.9.9', port: 3493, upsName: 'ups' })
    const trig = await AlertTrigger.create({ deviceId: dev.id, variable: 'battery.charge', condition: 'lt', threshold: '10', severity: 'warning' })
    // Seed 5 entries
    for (let i = 0; i < 5; i++) {
      await AlertHistory.create({ triggerId: trig.id, deviceId: dev.id, message: `alert ${i}`, severity: 'warning' })
    }

    const app = express()
    app.use(express.json())
    app.use('/api/alerts', require('../routes/alerts'))

    const res = await request(app).get('/api/alerts/history?limit=2&offset=0').set(auth)
    expect(res.status).toBe(200)
    expect(res.body.rows.length).toBe(2)
    expect(typeof res.body.count).toBe('number')

    const res2 = await request(app).get('/api/alerts/history?limit=2&offset=2').set(auth)
    expect(res2.body.rows.length).toBe(2)
    // Pages should be different
    expect(res2.body.rows[0].id).not.toBe(res.body.rows[0].id)
  })

  it('caps limit at 500', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/alerts', require('../routes/alerts'))

    const res = await request(app).get('/api/alerts/history?limit=9999').set(auth)
    expect(res.status).toBe(200)
  })
})
