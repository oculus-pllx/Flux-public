process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request = require('supertest')
const express = require('express')
const jwt = require('jsonwebtoken')
const { sequelize } = require('../config/database')

// Require all models so sequelize.sync creates their tables
require('../models/Group')
require('../models/Device')
require('../models/ConnectedMachine')
require('../models/AgentMachine')
require('../models/ClusterGroup')
require('../models/User')
require('../models/AlertTrigger')
require('../models/Setting')

const app = express()
app.use(express.json())
app.use('/api/system', require('../routes/system'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }
const operatorToken = jwt.sign({ id: 2, role: 'operator' }, 'test-secret')
const opAuth = { Authorization: `Bearer ${operatorToken}` }

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

describe('GET /api/system/backup', () => {
  afterEach(async () => {
    const Setting = require('../models/Setting')
    const User = require('../models/User')
    await Setting.destroy({ where: {} })
    await User.destroy({ where: {} })
  })

  it('returns 403 for non-admin users', async () => {
    const res = await request(app).get('/api/system/backup').set(opAuth)
    expect(res.status).toBe(403)
  })

  it('returns JSON with all expected top-level keys', async () => {
    const res = await request(app).get('/api/system/backup').set(auth)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('version')
    expect(res.body).toHaveProperty('createdAt')
    expect(res.body).toHaveProperty('counts')
    expect(res.body).toHaveProperty('data')
    const keys = ['groups', 'devices', 'connectedMachines', 'agentMachines',
                  'clusterGroups', 'users', 'alertTriggers', 'settings']
    for (const k of keys) {
      expect(res.body.data).toHaveProperty(k)
      expect(Array.isArray(res.body.data[k])).toBe(true)
    }
  })

  it('sets Content-Disposition attachment header', async () => {
    const res = await request(app).get('/api/system/backup').set(auth)
    expect(res.headers['content-disposition']).toMatch(/attachment.*flux-backup-\d{4}-\d{2}-\d{2}\.json/)
  })

  it('includes seeded data in backup', async () => {
    const Setting = require('../models/Setting')
    await Setting.create({ key: 'smtp_host', value: 'smtp.example.com' })
    const res = await request(app).get('/api/system/backup').set(auth)
    expect(res.body.data.settings.some(s => s.key === 'smtp_host')).toBe(true)
    expect(res.body.counts.settings).toBeGreaterThanOrEqual(1)
  })

})

describe('POST /api/system/restore', () => {
  afterEach(async () => {
    const Setting = require('../models/Setting')
    const User = require('../models/User')
    await Setting.destroy({ where: {} })
    await User.destroy({ where: {} })
  })

  async function getValidBackup() {
    const res = await request(app).get('/api/system/backup').set(auth)
    return res.body
  }

  it('returns 403 for non-admin users', async () => {
    const backup = await getValidBackup()
    const buf = Buffer.from(JSON.stringify(backup))
    const res = await request(app)
      .post('/api/system/restore')
      .set(opAuth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })
    expect(res.status).toBe(403)
  })

  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/system/restore').set(auth)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no file/i)
  })

  it('returns 400 for malformed JSON', async () => {
    const buf = Buffer.from('this is not json')
    const res = await request(app)
      .post('/api/system/restore')
      .set(auth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid json/i)
  })

  it('returns 400 when required top-level keys are missing', async () => {
    const buf = Buffer.from(JSON.stringify({ version: '1.0.0' }))
    const res = await request(app)
      .post('/api/system/restore')
      .set(auth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing/i)
  })

  it('returns 400 when data is missing a required array key', async () => {
    const buf = Buffer.from(JSON.stringify({
      version: '2.0.0',
      createdAt: new Date().toISOString(),
      data: { groups: [], devices: [] }  // missing 6 of the 8 required keys
    }))
    const res = await request(app)
      .post('/api/system/restore')
      .set(auth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing or invalid data\./i)
  })

  it('restores data and returns counts, and destroys pre-existing data not in backup', async () => {
    const Setting = require('../models/Setting')
    // Seed two rows
    await Setting.create({ key: 'smtp_host', value: 'smtp.example.com' })
    await Setting.create({ key: 'smtp_port', value: '587' })

    // Take backup (contains both rows)
    const backup = await getValidBackup()

    // Now add a row that does NOT exist in the backup
    await Setting.create({ key: 'extra_key', value: 'should_be_gone' })

    // Confirm the extra row is there before restore
    const beforeCount = await Setting.count()
    expect(beforeCount).toBe(3)

    const buf = Buffer.from(JSON.stringify(backup))
    const res = await request(app)
      .post('/api/system/restore')
      .set(auth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.counts.settings).toBe(2)

    // smtp_host and smtp_port should be restored
    const host = await Setting.findOne({ where: { key: 'smtp_host' } })
    expect(host).not.toBeNull()
    expect(host.value).toBe('smtp.example.com')

    // extra_key should be gone (destroy ran before insert)
    const extra = await Setting.findOne({ where: { key: 'extra_key' } })
    expect(extra).toBeNull()
  })

  it('restores users (with password hashes) and verifies login still works', async () => {
    const User = require('../models/User')
    const bcrypt = require('bcryptjs')

    // Create a user with a known password — User.beforeCreate will hash it once
    await User.create({ username: 'restoretest', email: 'restore@test.com', password: 'testpass123' })

    // Take backup (user with hashed password is included)
    const backup = await getValidBackup()
    expect(backup.data.users.length).toBeGreaterThan(0)
    expect(backup.data.users[0]).toHaveProperty('password')  // hash is present

    // Destroy user
    await User.destroy({ where: { username: 'restoretest' } })
    const before = await User.findOne({ where: { username: 'restoretest' } })
    expect(before).toBeNull()

    // Restore
    const buf = Buffer.from(JSON.stringify(backup))
    const res = await request(app)
      .post('/api/system/restore')
      .set(auth)
      .attach('file', buf, { filename: 'backup.json', contentType: 'application/json' })
    expect(res.status).toBe(200)

    // User should be back
    const restored = await User.findOne({ where: { username: 'restoretest' } })
    expect(restored).not.toBeNull()

    // And their password hash should still work
    const passwordMatches = await bcrypt.compare('testpass123', restored.password)
    expect(passwordMatches).toBe(true)
  })
})
