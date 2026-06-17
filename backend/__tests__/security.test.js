process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const request  = require('supertest')
const express  = require('express')
const jwt      = require('jsonwebtoken')
const path     = require('path')
const { sequelize } = require('../config/database')

require('../models/User')

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

// ── App factory (lets us set env vars before requiring routes) ─────────────────
function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth',  require('../routes/auth'))
  app.use('/api/users', require('../routes/users'))
  app.use(require('../middleware/errorHandler'))
  return app
}

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

// ── S1: SSH key path traversal ─────────────────────────────────────────────────
// Test readKeyFileSafe directly — no SSH mock or module reset needed

describe('S1 — SSH key path traversal', () => {
  const { readKeyFileSafe } = require('../services/sshService')
  const os = require('os')
  const fs = require('fs')

  afterEach(() => { delete process.env.SSH_KEY_DIR })

  it('rejects sshKeyPath when SSH_KEY_DIR is not set', () => {
    delete process.env.SSH_KEY_DIR
    const result = readKeyFileSafe('/etc/passwd')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toMatch(/SSH_KEY_DIR/)
  })

  it('rejects sshKeyPath outside SSH_KEY_DIR', () => {
    process.env.SSH_KEY_DIR = '/etc/flux/keys'
    const result = readKeyFileSafe('/etc/flux/keys/../../passwd')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toMatch(/outside/)
  })

  it('accepts sshKeyPath inside SSH_KEY_DIR', () => {
    const tmpDir = os.tmpdir()
    const keyFile = path.join(tmpDir, 'flux-test.key')
    fs.writeFileSync(keyFile, 'fake-key-content')
    process.env.SSH_KEY_DIR = tmpDir
    const result = readKeyFileSafe(keyFile)
    expect(result).not.toBeInstanceOf(Error)
    expect(result.toString()).toContain('fake-key-content')
    fs.unlinkSync(keyFile)
  })
})

// ── S2: JWT query string — only allowed on specific routes ─────────────────────

describe('S2 — JWT in query string', () => {
  it('rejects query token on standard API routes', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/api/users')
      .query({ token: adminToken })
    expect(res.status).toBe(401)
  })
})

// ── S3: Rate limiting on login ─────────────────────────────────────────────────

describe('S3 — Login rate limiting', () => {
  it('returns 429 after too many failed login attempts', async () => {
    const app = makeApp()
    const attempt = () =>
      request(app).post('/api/auth/login').send({ username: 'nobody', password: 'wrong' })

    let lastRes
    for (let i = 0; i < 15; i++) {
      lastRes = await attempt()
    }
    expect(lastRes.status).toBe(429)
  })
})

// ── S4: Error messages in production ──────────────────────────────────────────

describe('S4 — Error messages in production', () => {
  it('hides internal error details in production', async () => {
    const origEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const app = express()
    app.get('/boom', () => { throw Object.assign(new Error('secret db path /var/data/flux.db'), { status: 500 }) })
    app.use(require('../middleware/errorHandler'))

    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body.error).not.toMatch(/secret/)
    expect(res.body.error).toMatch(/server error/i)

    process.env.NODE_ENV = origEnv
  })

  it('shows error details outside production', async () => {
    const origEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const app = express()
    app.get('/boom', () => { throw Object.assign(new Error('debug detail'), { status: 500 }) })
    app.use(require('../middleware/errorHandler'))

    const res = await request(app).get('/boom')
    expect(res.body.error).toMatch(/debug detail/)

    process.env.NODE_ENV = origEnv
  })
})

// ── S5: User creation input validation ────────────────────────────────────────

describe('S5 — User creation validation', () => {
  it('rejects user with missing username', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ email: 'a@b.com', password: 'password123', role: 'viewer' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/username/)
  })

  it('rejects username shorter than 3 chars', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ username: 'ab', email: 'a@b.com', password: 'password123', role: 'viewer' })
    expect(res.status).toBe(400)
  })

  it('rejects invalid email', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ username: 'testuser', email: 'notanemail', password: 'password123', role: 'viewer' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/email/)
  })

  it('rejects password shorter than 8 chars', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ username: 'testuser', email: 'a@b.com', password: 'short', role: 'viewer' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/password/)
  })

  it('rejects invalid role', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ username: 'testuser', email: 'a@b.com', password: 'password123', role: 'superadmin' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/role/)
  })

  it('creates user with valid fields', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/users').set(auth)
      .send({ username: 'validuser', email: 'valid@test.com', password: 'password123', role: 'viewer' })
    expect(res.status).toBe(201)
    expect(res.body.username).toBe('validuser')
    expect(res.body.password).toBeUndefined()
  })
})
