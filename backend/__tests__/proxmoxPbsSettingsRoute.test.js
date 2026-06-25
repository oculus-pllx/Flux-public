process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request = require('supertest')
const express = require('express')
const jwt = require('jsonwebtoken')
const { sequelize } = require('../config/database')

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
