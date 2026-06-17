process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/sshService', () => ({
  runCommand: jest.fn(),
  installNutServer: jest.fn(),
}))
jest.mock('../services/pollingService', () => ({
  scheduleDevice: jest.fn(),
  stopDevice: jest.fn(),
}))

const request = require('supertest')
const express = require('express')
const jwt     = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const sshService = require('../services/sshService')

const app = express()
app.use(express.json())
app.use('/api/devices', require('../routes/devices'))

const adminToken  = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const viewerToken = jwt.sign({ id: 2, role: 'viewer' }, 'test-secret')
const auth = { Authorization: `Bearer ${adminToken}` }

const sshBody = {
  host: '192.168.0.100', sshPort: 22, sshUser: 'root',
  sshAuthType: 'password', sshPassword: 'secret',
}

// Route runs several SSH probes in parallel; answer by command content
function mockSsh({ upsNames = '', upsdConf = '', upsdUsers = '', nutPresent = true } = {}) {
  sshService.runCommand.mockImplementation((machine, cmd) => {
    if (cmd.includes('FLUX_NUT_PRESENT')) {
      return Promise.resolve(nutPresent ? 'FLUX_NUT_PRESENT' : 'FLUX_NUT_MISSING')
    }
    if (cmd.includes('upsc -l')) return Promise.resolve(upsNames)
    if (cmd.includes('upsd.conf')) return Promise.resolve(upsdConf)
    if (cmd.includes('upsd.users')) return Promise.resolve(upsdUsers)
    return Promise.resolve('')
  })
}

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })
beforeEach(() => jest.clearAllMocks())

describe('POST /api/devices/discover-nut', () => {
  it('returns 422 with nutMissing:true when NUT is not installed', async () => {
    mockSsh({ nutPresent: false })
    const res = await request(app).post('/api/devices/discover-nut').set(auth).send(sshBody)
    expect(res.status).toBe(422)
    expect(res.body.nutMissing).toBe(true)
  })

  it('returns 422 with nutMissing:false when NUT installed but no UPS configured', async () => {
    mockSsh({ nutPresent: true })
    const res = await request(app).post('/api/devices/discover-nut').set(auth).send(sshBody)
    expect(res.status).toBe(422)
    expect(res.body.nutMissing).toBe(false)
  })

  it('uses the SSH host when NUT listens on all interfaces', async () => {
    mockSsh({
      upsNames: 'ups\n',
      upsdConf: 'LISTEN 0.0.0.0 3493\n',
      upsdUsers: '[fluxmon]\n  password = pw1\n  upsmon master\n',
    })
    const res = await request(app).post('/api/devices/discover-nut').set(auth).send(sshBody)
    expect(res.status).toBe(200)
    expect(res.body.upsNames).toEqual(['ups'])
    expect(res.body.nutHost).toBe(sshBody.host)
    expect(res.body.nutUsername).toBe('fluxmon')
  })
})

describe('POST /api/devices/install-nut', () => {
  it('installs NUT then returns discovered config with generated credentials', async () => {
    sshService.installNutServer.mockResolvedValue('FLUX_NUT_SERVER_OK')
    mockSsh({ upsNames: 'ups\n' })
    const res = await request(app).post('/api/devices/install-nut').set(auth).send(sshBody)
    expect(res.status).toBe(200)
    expect(res.body.installed).toBe(true)
    expect(res.body.upsNames).toEqual(['ups'])
    expect(res.body.nutUsername).toBe('fluxmon')
    expect(res.body.nutPassword).toMatch(/^[0-9a-f]{24,}$/)
    // installNutServer received the same generated credentials
    const [, creds] = sshService.installNutServer.mock.calls[0]
    expect(creds.nutPassword).toBe(res.body.nutPassword)
  })

  it('returns 422 installed:true when install succeeds but no UPS is detected', async () => {
    sshService.installNutServer.mockResolvedValue('FLUX_NUT_SERVER_OK')
    mockSsh({ upsNames: '' })
    const res = await request(app).post('/api/devices/install-nut').set(auth).send(sshBody)
    expect(res.status).toBe(422)
    expect(res.body.installed).toBe(true)
    expect(res.body.error).toMatch(/no UPS/i)
  })

  it('rejects viewers', async () => {
    const res = await request(app).post('/api/devices/install-nut')
      .set({ Authorization: `Bearer ${viewerToken}` }).send(sshBody)
    expect(res.status).toBe(403)
    expect(sshService.installNutServer).not.toHaveBeenCalled()
  })

  it('propagates SSH install failure as 500', async () => {
    sshService.installNutServer.mockRejectedValue(new Error('apt failed'))
    const res = await request(app).post('/api/devices/install-nut').set(auth).send(sshBody)
    expect(res.status).toBe(500)
  })
})
