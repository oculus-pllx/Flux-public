process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/serverUpdateService', () => ({
  getStatus: jest.fn(),
  applyUpdate: jest.fn(),
  getUpdateLog: jest.fn(),
}))

const request = require('supertest')
const express = require('express')
const jwt     = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const serverUpdateService = require('../services/serverUpdateService')
const Device = require('../models/Device')

const app = express()
app.use(express.json())
app.use('/api/system', require('../routes/system'))

const adminToken  = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const viewerToken = jwt.sign({ id: 2, role: 'viewer' }, 'test-secret')
const adminAuth  = { Authorization: `Bearer ${adminToken}` }
const viewerAuth = { Authorization: `Bearer ${viewerToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })
beforeEach(async () => {
  jest.clearAllMocks()
  await Device.destroy({ where: {} })
})

describe('GET /api/system/update', () => {
  it('returns update status for admin', async () => {
    serverUpdateService.getStatus.mockResolvedValue({ currentVersion: '2.0.0', updateAvailable: false, mode: 'manual' })
    const res = await request(app).get('/api/system/update').set(adminAuth)
    expect(res.status).toBe(200)
    expect(res.body.currentVersion).toBe('2.0.0')
  })

  it('rejects non-admin', async () => {
    const res = await request(app).get('/api/system/update').set(viewerAuth)
    expect(res.status).toBe(403)
    expect(serverUpdateService.getStatus).not.toHaveBeenCalled()
  })
})

describe('POST /api/system/update', () => {
  it('409s when any active device is on battery', async () => {
    await Device.create({ name: 'u', host: 'h', upsName: 'ups', active: true, lastStatus: { 'ups.status': 'OB LB' } })
    const res = await request(app).post('/api/system/update').set(adminAuth)
    expect(res.status).toBe(409)
    expect(serverUpdateService.applyUpdate).not.toHaveBeenCalled()
  })

  it('202 starts apply when mains is OK', async () => {
    await Device.create({ name: 'u', host: 'h', upsName: 'ups', active: true, lastStatus: { 'ups.status': 'OL' } })
    serverUpdateService.applyUpdate.mockResolvedValue({ started: true, mode: 'systemd' })
    const res = await request(app).post('/api/system/update').set(adminAuth)
    expect(res.status).toBe(202)
    expect(res.body.started).toBe(true)
  })

  it('202 starts a manual update trigger even when no active UPS exists', async () => {
    serverUpdateService.applyUpdate.mockResolvedValue({ started: true, mode: 'docker' })
    const res = await request(app).post('/api/system/update').set(adminAuth)
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ started: true, mode: 'docker' })
    expect(serverUpdateService.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('passes through err.status from the service (manual mode 400)', async () => {
    serverUpdateService.applyUpdate.mockRejectedValue(Object.assign(new Error('nope'), { status: 400 }))
    const res = await request(app).post('/api/system/update').set(adminAuth)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('nope')
  })

  it('rejects non-admin', async () => {
    const res = await request(app).post('/api/system/update').set(viewerAuth)
    expect(res.status).toBe(403)
    expect(serverUpdateService.applyUpdate).not.toHaveBeenCalled()
  })
})

describe('GET /api/system/update/log', () => {
  it('returns log + state for admin', async () => {
    serverUpdateService.getUpdateLog.mockResolvedValue({ state: 'success', log: 'done', mode: 'systemd' })
    const res = await request(app).get('/api/system/update/log').set(adminAuth)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ state: 'success', log: 'done' })
  })
})
