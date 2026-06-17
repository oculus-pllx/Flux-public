process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/sshService', () => ({
  installAgent:     jest.fn().mockResolvedValue('...FLUX_INSTALL_OK'),
  testConnection:   jest.fn().mockResolvedValue('ok'),
  shutdown:         jest.fn().mockResolvedValue(''),
  deployNutMonitor: jest.fn().mockResolvedValue({ log: 'ok' }),
  getNutMonitorStatus: jest.fn().mockResolvedValue('active'),
}))

const request  = require('supertest')
const express  = require('express')
const jwt      = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const ConnectedMachine = require('../models/ConnectedMachine')
const AgentMachine     = require('../models/AgentMachine')
const Device           = require('../models/Device')

const app = express()
app.use(express.json())
// mergeParams is required for :id → :mid param inheritance
app.use('/api/devices/:id/machines', require('../routes/machines'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }
const operatorToken = jwt.sign({ id: 2, role: 'operator' }, 'test-secret')
const operatorAuth = { Authorization: `Bearer ${operatorToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterEach(async () => {
  await AgentMachine.destroy({ where: {}, truncate: true })
  await ConnectedMachine.destroy({ where: {}, truncate: true })
  await Device.destroy({ where: {}, truncate: true })
})
afterAll(async () => { await sequelize.close() })

describe('POST /api/devices/:id/machines/:mid/install-agent', () => {
  let device, machine

  beforeEach(async () => {
    device  = await Device.create({ name: 'Test UPS', host: '192.168.0.10', port: 3493, upsName: 'ups' })
    machine = await ConnectedMachine.create({
      deviceId:     device.id,
      name:         'test-host',
      host:         '192.168.0.100',
      sshPort:      22,
      sshUser:      'root',
      sshAuthType:  'password',
      sshPassword:  'secret',
      shutdownDelay: 30,
      description:  'My server',
    })
  })

  it('returns 200 with machineId + jobId immediately (async)', async () => {
    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/${machine.id}/install-agent`)
      .set(auth)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.machineId).toBeDefined()
    expect(res.body.jobId).toBeDefined()

    // AgentMachine created with migrated fields
    const agent = await AgentMachine.findByPk(res.body.machineId)
    expect(agent).not.toBeNull()
    expect(agent.shutdownDelay).toBe(30)
    expect(agent.notes).toBe('My server')
    expect(agent.upsGroupId).toBe(device.id)
  })

  it('preserves ConnectedMachine when SSH fails (async rollback)', async () => {
    const sshService = require('../services/sshService')
    sshService.installAgent.mockRejectedValueOnce(new Error('SSH timeout'))

    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/${machine.id}/install-agent`)
      .set(auth)
    // Route responds OK immediately (async) — failure happens in background
    expect(res.status).toBe(200)

    // Wait for background reject to complete
    await new Promise(r => setTimeout(r, 50))

    const still = await ConnectedMachine.findByPk(machine.id)
    expect(still).not.toBeNull()

    const orphan = await AgentMachine.findOne({ where: { hostname: machine.host, state: 'pending' } })
    expect(orphan).toBeNull() // rolled back
  })

  it('returns 404 for unknown machine', async () => {
    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/9999/install-agent`)
      .set(auth)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/devices/:id/machines/:mid/reset-host-key', () => {
  let device, machine

  beforeEach(async () => {
    device  = await Device.create({ name: 'Test UPS', host: '192.168.0.10', port: 3493, upsName: 'ups' })
    machine = await ConnectedMachine.create({
      deviceId: device.id, name: 'm', host: '192.168.0.100', sshHostKey: 'SHA256:abc',
    })
  })

  it('clears the pinned host key (admin)', async () => {
    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/${machine.id}/reset-host-key`)
      .set(auth)
    expect(res.status).toBe(200)
    await machine.reload()
    expect(machine.sshHostKey).toBeNull()
  })

  it('is forbidden for operator', async () => {
    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/${machine.id}/reset-host-key`)
      .set(operatorAuth)
    expect(res.status).toBe(403)
    await machine.reload()
    expect(machine.sshHostKey).toBe('SHA256:abc')
  })

  it('returns 404 for unknown machine', async () => {
    const res = await request(app)
      .post(`/api/devices/${device.id}/machines/9999/reset-host-key`)
      .set(auth)
    expect(res.status).toBe(404)
  })

  it('exposes sshHostKey in list responses', async () => {
    const res = await request(app)
      .get(`/api/devices/${device.id}/machines`)
      .set(auth)
    expect(res.status).toBe(200)
    expect(res.body[0].sshHostKey).toBe('SHA256:abc')
    expect(res.body[0].sshPassword).toBeUndefined()
  })
})
