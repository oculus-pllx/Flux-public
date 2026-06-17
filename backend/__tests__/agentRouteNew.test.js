process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/agentHub', () => {
  const EventEmitter = require('events')
  const hub = new EventEmitter()
  hub.sendToMachine = jest.fn()
  hub.getConnectedCount = jest.fn().mockReturnValue(0)
  return hub
})

jest.mock('../services/sshService', () => ({
  installAgent: jest.fn().mockResolvedValue('...FLUX_INSTALL_OK'),
}))

const request  = require('supertest')
const express  = require('express')
const jwt      = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const AgentMachine  = require('../models/AgentMachine')

const app = express()
app.use(express.json())
app.use('/api/agents', require('../routes/agents'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

describe('POST /api/agents/:id/ping', () => {
  it('returns alive:false when agent machineKey is null', async () => {
    const m = await AgentMachine.create({ hostname: 'ping-host', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/ping`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.alive).toBe(false)
    expect(res.body.reason).toBe('Not enrolled')
  })

  it('returns alive:false when agent not connected', async () => {
    const agentHub = require('../services/agentHub')
    agentHub.sendToMachine.mockReturnValueOnce(false)
    const m = await AgentMachine.create({ machineKey: 'ping-key-dc', hostname: 'ping-dc', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/ping`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.alive).toBe(false)
  })

  it('returns alive:true with latencyMs when pong is emitted', async () => {
    const agentHub = require('../services/agentHub')
    agentHub.sendToMachine.mockImplementationOnce((key, msg) => {
      if (msg.type === 'ping') {
        // Simulate agent responding asynchronously
        setImmediate(() => agentHub.emit(`pong:${key}`))
      }
      return true
    })
    const m = await AgentMachine.create({ machineKey: 'ping-key-ok', hostname: 'ping-ok', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/ping`).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.alive).toBe(true)
    expect(typeof res.body.latencyMs).toBe('number')
  })
})

describe('POST /api/agents/:id/shutdown', () => {
  it('sends shutdown message and sets state to command-sent', async () => {
    const agentHub = require('../services/agentHub')
    agentHub.sendToMachine.mockReturnValueOnce(true)
    const m = await AgentMachine.create({ machineKey: 'sd-key', hostname: 'sd-host', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/shutdown`).set(auth).send({ delaySeconds: 30 })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const updated = await AgentMachine.findByPk(m.id)
    expect(updated.state).toBe('command-sent')
  })

  it('returns 400 when agent not enrolled', async () => {
    const m = await AgentMachine.create({ hostname: 'sd-unenrolled', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/shutdown`).set(auth)
    expect(res.status).toBe(400)
  })

  it('returns 400 when agent not connected', async () => {
    const agentHub = require('../services/agentHub')
    agentHub.sendToMachine.mockReturnValueOnce(false)
    const m = await AgentMachine.create({ machineKey: 'sd-nc', hostname: 'sd-nc-host', role: 'controlled' })
    const res = await request(app).post(`/api/agents/${m.id}/shutdown`).set(auth)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/agents/install-via-ssh', () => {
  it('returns 200 with machineId + jobId immediately (async)', async () => {
    const res = await request(app)
      .post('/api/agents/install-via-ssh')
      .set(auth)
      .send({ host: '192.168.0.100', sshPort: 22, sshUser: 'root',
              sshAuthType: 'password', sshPassword: 'secret',
              role: 'controlled', upsGroupId: null })
    expect(res.status).toBe(200)
    expect(res.body.machineId).toBeDefined()
    expect(res.body.jobId).toBeDefined()
    expect(res.body.token).toHaveLength(64)
    // Machine created in pending state
    const m = await AgentMachine.findByPk(res.body.machineId)
    expect(m).not.toBeNull()
    expect(m.state).toBe('pending')
  })

  it('returns 400 when host is missing', async () => {
    const res = await request(app)
      .post('/api/agents/install-via-ssh')
      .set(auth)
      .send({ sshAuthType: 'password', sshPassword: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/agents/install-jobs/:jobId', () => {
  it('returns job state with log', async () => {
    const installJobService = require('../services/installJobService')
    const jobId = installJobService.createJob(999)
    installJobService.appendChunk(jobId, 'Installing...\n')
    const res = await request(app)
      .get(`/api/agents/install-jobs/${jobId}`)
      .set(auth)
    expect(res.status).toBe(200)
    expect(res.body.done).toBe(false)
    expect(res.body.log).toContain('Installing...')
  })

  it('returns 404 for unknown jobId', async () => {
    const res = await request(app)
      .get('/api/agents/install-jobs/not-a-real-id')
      .set(auth)
    expect(res.status).toBe(404)
  })
})
