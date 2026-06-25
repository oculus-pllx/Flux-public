process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request = require('supertest')
const express = require('express')
const jwt = require('jsonwebtoken')

jest.mock('../services/proxmoxService', () => ({
  listNodes: jest.fn(),
}))

jest.mock('../services/agentHub', () => ({
  sendToMachine: jest.fn(),
}))

const { sequelize } = require('../config/database')
const AgentMachine = require('../models/AgentMachine')
const proxmoxService = require('../services/proxmoxService')
const agentHub = require('../services/agentHub')

const app = express()
app.use(express.json())
app.use('/api/settings', require('../routes/settings'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

beforeAll(async () => {
  await sequelize.sync({ force: true })
})

beforeEach(async () => {
  await sequelize.truncate({ cascade: true })
  proxmoxService.listNodes.mockReset()
  agentHub.sendToMachine.mockReset()
})

afterAll(async () => {
  await sequelize.close()
})

describe('central Proxmox/PBS settings storage', () => {
  it('creates and lists Proxmox cluster configs without exposing token secrets', async () => {
    const created = await request(app)
      .post('/api/settings/proxmox-pbs/proxmox-clusters')
      .set(auth)
      .send({
        name: 'SMS Cluster',
        clusterId: 'sms-cluster',
        apiBaseUrl: 'https://sms-pve-1:8006',
        tokenId: 'root@pam!flux-ups',
        tokenSecret: 'super-secret',
        haFreezeTimeout: 45,
        enabled: true,
      })

    expect(created.status).toBe(201)
    expect(created.body.name).toBe('SMS Cluster')
    expect(created.body.clusterId).toBe('sms-cluster')
    expect(created.body.hasTokenSecret).toBe(true)
    expect(created.body.tokenSecret).toBeUndefined()

    const listed = await request(app)
      .get('/api/settings/proxmox-pbs/proxmox-clusters')
      .set(auth)

    expect(listed.status).toBe(200)
    expect(listed.body).toHaveLength(1)
    expect(listed.body[0].tokenId).toBe('root@pam!flux-ups')
    expect(listed.body[0].hasTokenSecret).toBe(true)
    expect(listed.body[0].tokenSecret).toBeUndefined()
  })

  it('preserves a Proxmox token secret when updating without a replacement secret', async () => {
    const created = await request(app)
      .post('/api/settings/proxmox-pbs/proxmox-clusters')
      .set(auth)
      .send({
        name: 'SMS Cluster',
        clusterId: 'sms-cluster',
        apiBaseUrl: 'https://sms-pve-1:8006',
        tokenId: 'root@pam!flux-ups',
        tokenSecret: 'keep-me',
      })

    const updated = await request(app)
      .put(`/api/settings/proxmox-pbs/proxmox-clusters/${created.body.id}`)
      .set(auth)
      .send({
        name: 'SMS Cluster Updated',
        apiBaseUrl: 'https://sms-pve-2:8006',
      })

    expect(updated.status).toBe(200)
    expect(updated.body.name).toBe('SMS Cluster Updated')
    expect(updated.body.apiBaseUrl).toBe('https://sms-pve-2:8006')
    expect(updated.body.hasTokenSecret).toBe(true)
    expect(updated.body.tokenSecret).toBeUndefined()
  })

  it('creates and updates PBS configs without exposing token secrets', async () => {
    const created = await request(app)
      .post('/api/settings/proxmox-pbs/pbs-configs')
      .set(auth)
      .send({
        name: 'SMS PBS',
        url: 'https://sms-pbs:8007',
        tokenId: 'flux@pbs!flux-ups',
        tokenSecret: 'pbs-secret',
        jobAbortTimeout: 180,
        forceShutdown: false,
        upsGroupId: 8,
        enabled: true,
      })

    expect(created.status).toBe(201)
    expect(created.body.name).toBe('SMS PBS')
    expect(created.body.hasTokenSecret).toBe(true)
    expect(created.body.tokenSecret).toBeUndefined()

    const updated = await request(app)
      .put(`/api/settings/proxmox-pbs/pbs-configs/${created.body.id}`)
      .set(auth)
      .send({
        name: 'SMS PBS Updated',
        forceShutdown: true,
      })

    expect(updated.status).toBe(200)
    expect(updated.body.name).toBe('SMS PBS Updated')
    expect(updated.body.forceShutdown).toBe(true)
    expect(updated.body.hasTokenSecret).toBe(true)
    expect(updated.body.tokenSecret).toBeUndefined()
  })
})

describe('central Proxmox discovery and selected apply', () => {
  async function createCluster(overrides = {}) {
    const res = await request(app)
      .post('/api/settings/proxmox-pbs/proxmox-clusters')
      .set(auth)
      .send({
        name: 'SMS Cluster',
        clusterId: 'sms-cluster',
        apiBaseUrl: 'https://sms-pve-1:8006',
        tokenId: 'root@pam!flux-ups',
        tokenSecret: 'cluster-secret',
        enabled: true,
        ...overrides,
      })
    expect(res.status).toBe(201)
    return res.body
  }

  it('discovers Proxmox nodes and previews hostname matches without exposing secrets', async () => {
    const cluster = await createCluster()
    await AgentMachine.bulkCreate([
      { machineKey: 'pve1-key', hostname: 'sms-pve-1.local', role: 'pve-node' },
      { machineKey: 'pve2-key', hostname: 'sms-pve-2', role: 'pve-node' },
      { machineKey: 'duplicate-a', hostname: 'sms-pve-dup', role: 'pve-node' },
      { machineKey: 'duplicate-b', hostname: 'sms-pve-dup.example.com', role: 'pve-node' },
      { machineKey: 'pbs-key', hostname: 'sms-pbs', role: 'pbs' },
    ])
    proxmoxService.listNodes.mockResolvedValue([
      { node: 'sms-pve-1' },
      { node: 'sms-pve-dup' },
      { node: 'sms-pve-missing' },
    ])

    const res = await request(app)
      .post(`/api/settings/proxmox-pbs/proxmox-clusters/${cluster.id}/discover`)
      .set(auth)
      .send()

    expect(res.status).toBe(200)
    expect(proxmoxService.listNodes).toHaveBeenCalledWith({
      url: 'https://sms-pve-1:8006',
      tokenId: 'root@pam!flux-ups',
      tokenSecret: 'cluster-secret',
    })
    expect(res.body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        node: 'sms-pve-1',
        status: 'matched',
        agent: expect.objectContaining({ hostname: 'sms-pve-1.local' }),
      }),
      expect.objectContaining({
        node: 'sms-pve-dup',
        status: 'ambiguous',
        candidates: expect.arrayContaining([
          expect.objectContaining({ hostname: 'sms-pve-dup' }),
          expect.objectContaining({ hostname: 'sms-pve-dup.example.com' }),
        ]),
      }),
      expect.objectContaining({
        node: 'sms-pve-missing',
        status: 'unmatched',
      }),
    ]))
    expect(JSON.stringify(res.body)).not.toContain('cluster-secret')
  })

  it('applies derived PVE config only to selected agents and reports push status', async () => {
    const cluster = await createCluster()
    const selected = await AgentMachine.create({
      machineKey: 'selected-key',
      hostname: 'sms-pve-1',
      role: 'pve-node',
      upsGroupId: 8,
      shutdownOrder: 4,
      shutdownDelay: 90,
      notes: 'preserve',
    })
    const unselected = await AgentMachine.create({
      machineKey: 'unselected-key',
      hostname: 'sms-pve-2',
      role: 'pve-node',
    })
    agentHub.sendToMachine.mockReturnValueOnce(false)

    const res = await request(app)
      .post(`/api/settings/proxmox-pbs/proxmox-clusters/${cluster.id}/apply`)
      .set(auth)
      .send({
        targets: [
          { node: 'sms-pve-1', agentMachineId: selected.id },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.applied).toEqual([
      expect.objectContaining({
        node: 'sms-pve-1',
        agentMachineId: selected.id,
        pushed: false,
        pushStatus: 'offline',
      }),
    ])

    await selected.reload()
    expect(selected.clusterId).toBe('sms-cluster')
    expect(selected.pveConfig).toEqual({
      url: 'https://sms-pve-1:8006',
      tokenId: 'root@pam!flux-ups',
      tokenSecret: 'cluster-secret',
      node: 'sms-pve-1',
    })
    expect(selected.upsGroupId).toBe(8)
    expect(selected.shutdownOrder).toBe(4)
    expect(selected.shutdownDelay).toBe(90)
    expect(selected.notes).toBe('preserve')

    await unselected.reload()
    expect(unselected.clusterId).toBeNull()
    expect(unselected.pveConfig).toBeNull()
  })

  it('pushes updated PVE config to selected online agents', async () => {
    const cluster = await createCluster()
    const machine = await AgentMachine.create({
      machineKey: 'online-key',
      hostname: 'sms-pve-3',
      role: 'pve-node',
    })
    agentHub.sendToMachine.mockReturnValueOnce(true)

    const res = await request(app)
      .post(`/api/settings/proxmox-pbs/proxmox-clusters/${cluster.id}/apply`)
      .set(auth)
      .send({
        targets: [
          { node: 'sms-pve-3', agentMachineId: machine.id },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.applied[0]).toEqual(expect.objectContaining({
      agentMachineId: machine.id,
      pushed: true,
      pushStatus: 'sent',
    }))
    expect(agentHub.sendToMachine).toHaveBeenCalledWith('online-key', {
      type: 'config-update',
      clusterId: 'sms-cluster',
      pveConfig: {
        url: 'https://sms-pve-1:8006',
        tokenId: 'root@pam!flux-ups',
        tokenSecret: 'cluster-secret',
        node: 'sms-pve-3',
      },
    })
  })
})
