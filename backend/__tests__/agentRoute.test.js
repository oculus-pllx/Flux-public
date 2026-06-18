process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request = require('supertest')
const express = require('express')
const jwt = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const AgentMachine = require('../models/AgentMachine')
const AgentMachineEvent = require('../models/AgentMachineEvent')
const Device = require('../models/Device')

const app = express()
app.use(express.json())
app.use('/api/agents', require('../routes/agents'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

describe('POST /api/agents/enrollment-token', () => {
  it('generates an enrollment token for admin', async () => {
    const res = await request(app)
      .post('/api/agents/enrollment-token')
      .set(auth)
      .send({ hostname: 'new-machine' })
    expect(res.status).toBe(201)
    expect(res.body.token).toHaveLength(64) // 32 bytes hex
    expect(res.body.expiresAt).toBeDefined()
    expect(res.body.machineId).toBeDefined()
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/agents/enrollment-token').send({ hostname: 'x' })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/agents', () => {
  it('lists all agent machines', async () => {
    await AgentMachine.create({ machineKey: 'list-key', hostname: 'listed-host', role: 'controlled' })
    const res = await request(app).get('/api/agents').set(auth)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.some(m => m.hostname === 'listed-host')).toBe(true)
  })
})

describe('POST /api/agents/:id/reenroll', () => {
  it('generates a new enrollment token for existing machine', async () => {
    const m = await AgentMachine.create({ machineKey: 'reenroll-key', hostname: 're-host', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/reenroll`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.token).toHaveLength(64)
    const updated = await AgentMachine.findByPk(m.id)
    expect(updated.enrollmentToken).toBe(res.body.token)
  })
})

describe('PUT /api/agents/:id', () => {
  it('updates configurable fields', async () => {
    const m = await AgentMachine.create({ machineKey: 'upd-key', hostname: 'upd-host', role: 'controlled' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ shutdownDelay: 60, shutdownTimeout: 180, upsGroupId: 2, updatePolicy: 'scheduled' })
    expect(res.status).toBe(200)
    expect(res.body.shutdownDelay).toBe(60)
    expect(res.body.updatePolicy).toBe('scheduled')
  })

  it('updates machine role when explicitly configured', async () => {
    const m = await AgentMachine.create({ machineKey: 'role-key', hostname: 'role-host', role: 'pve-node' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ role: 'ups-host' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('ups-host')
    await m.reload()
    expect(m.role).toBe('ups-host')
  })

  it('rejects invalid machine roles', async () => {
    const m = await AgentMachine.create({ machineKey: 'bad-role-key', hostname: 'bad-role-host', role: 'controlled' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ role: 'admin' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/role/i)
  })

  it('assigns an existing control machine to a UPS group', async () => {
    const ups = await Device.create({ name: 'APC 2200', host: '10.11.200.23', upsName: 'apc2200' })
    const m = await AgentMachine.create({
      machineKey: 'control-key',
      hostname: 'control-host',
      role: 'controlled',
      upsGroupId: null,
    })

    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ upsGroupId: ups.id })

    expect(res.status).toBe(200)
    expect(res.body.upsGroupId).toBe(ups.id)
    await m.reload()
    expect(m.upsGroupId).toBe(ups.id)
  })

  it('updates cluster metadata from the machine detail form', async () => {
    const m = await AgentMachine.create({
      machineKey: 'cluster-key',
      hostname: 'cluster-host',
      role: 'pve-node',
      clusterId: null,
      clusterVotes: 1,
    })

    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ clusterId: 'sms-pve', clusterVotes: 2 })

    expect(res.status).toBe(200)
    expect(res.body.clusterId).toBe('sms-pve')
    expect(res.body.clusterVotes).toBe(2)
    await m.reload()
    expect(m.clusterId).toBe('sms-pve')
    expect(m.clusterVotes).toBe(2)
  })
})

describe('PUT /api/agents/:id — upsOutlet field', () => {
  it('saves upsOutlet string', async () => {
    const m = await AgentMachine.create({ machineKey: 'outlet-key', hostname: 'outlet-host', role: 'controlled' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ upsOutlet: 'Slot A' })
    expect(res.status).toBe(200)
    expect(res.body.upsOutlet).toBe('Slot A')
  })

  it('clears upsOutlet when set to null', async () => {
    const m = await AgentMachine.create({ machineKey: 'outlet-clear-key', hostname: 'outlet-clear-host', role: 'controlled', upsOutlet: 'Old Label' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ upsOutlet: null })
    expect(res.status).toBe(200)
    expect(res.body.upsOutlet).toBeNull()
  })
})

describe('PUT /api/agents/:id — upsOutletBatteryBacked field', () => {
  it('saves upsOutletBatteryBacked = false (surge only)', async () => {
    const m = await AgentMachine.create({ machineKey: 'surge-key', hostname: 'surge-host', role: 'controlled' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ upsOutletBatteryBacked: false })
    expect(res.status).toBe(200)
    expect(res.body.upsOutletBatteryBacked).toBe(false)
  })

  it('saves upsOutletBatteryBacked = null (unknown)', async () => {
    const m = await AgentMachine.create({ machineKey: 'outlet-null-key', hostname: 'outlet-null-host', role: 'controlled' })
    const res = await request(app).put(`/api/agents/${m.id}`).set(auth)
      .send({ upsOutletBatteryBacked: null })
    expect(res.status).toBe(200)
    expect(res.body.upsOutletBatteryBacked).toBeNull()
  })
})
