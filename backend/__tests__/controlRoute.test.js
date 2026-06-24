process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const mockClient = {
  listCommands: jest.fn(),
  runCommand: jest.fn(),
}

jest.mock('../services/nutService', () => ({
  getClient: jest.fn(() => mockClient),
  pollDevice: jest.fn(),
}))

const request = require('supertest')
const express = require('express')
const jwt = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const Device = require('../models/Device')
const nutService = require('../services/nutService')

const app = express()
app.use(express.json())
app.use('/api/devices/:id/control', require('../routes/control'))

const adminToken = jwt.sign({ id: 1, role: 'admin' }, 'test-secret')
const operatorToken = jwt.sign({ id: 2, role: 'operator' }, 'test-secret')
const viewerToken = jwt.sign({ id: 3, role: 'viewer' }, 'test-secret')
const adminAuth = { Authorization: `Bearer ${adminToken}` }
const operatorAuth = { Authorization: `Bearer ${operatorToken}` }
const viewerAuth = { Authorization: `Bearer ${viewerToken}` }

async function createDevice(overrides = {}) {
  return Device.create({
    name: 'APC',
    host: '10.11.200.24',
    port: 3493,
    upsName: 'ups',
    pollInterval: 30,
    nutUsername: 'fluxmon',
    nutPassword: 'secret',
    ...overrides,
  })
}

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })
beforeEach(async () => {
  jest.clearAllMocks()
  await Device.destroy({ where: {} })
})

describe('POST /api/devices/:id/control/beeper/silence', () => {
  it('prefers persistent beeper.disable when the UPS exposes it', async () => {
    const device = await createDevice()
    mockClient.listCommands.mockResolvedValue(['beeper.mute', 'beeper.disable'])
    mockClient.runCommand.mockResolvedValue(true)

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/silence`)
      .set(adminAuth)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, command: 'beeper.disable' })
    expect(mockClient.runCommand).toHaveBeenCalledWith('ups', 'beeper.disable')
  })

  it('falls back to temporary beeper.mute when disable is unavailable', async () => {
    const device = await createDevice()
    mockClient.listCommands.mockResolvedValue(['beeper.mute'])
    mockClient.runCommand.mockResolvedValue(true)

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/silence`)
      .set(operatorAuth)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, command: 'beeper.mute' })
    expect(mockClient.runCommand).toHaveBeenCalledWith('ups', 'beeper.mute')
  })

  it('returns 422 when the UPS exposes no beeper silence command', async () => {
    const device = await createDevice()
    mockClient.listCommands.mockResolvedValue(['load.off'])

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/silence`)
      .set(adminAuth)

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/beeper\.disable or beeper\.mute/)
    expect(mockClient.runCommand).not.toHaveBeenCalled()
  })

  it('requires NUT credentials', async () => {
    const device = await createDevice({ nutUsername: null, nutPassword: null })

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/silence`)
      .set(adminAuth)

    expect(res.status).toBe(422)
    expect(mockClient.listCommands).not.toHaveBeenCalled()
    expect(mockClient.runCommand).not.toHaveBeenCalled()
  })

  it('rejects viewers', async () => {
    const device = await createDevice()

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/silence`)
      .set(viewerAuth)

    expect(res.status).toBe(403)
    expect(mockClient.listCommands).not.toHaveBeenCalled()
    expect(mockClient.runCommand).not.toHaveBeenCalled()
  })
})

describe('POST /api/devices/:id/control/beeper/toggle', () => {
  it('enables the beeper when the saved UPS status is disabled', async () => {
    const device = await createDevice({ lastStatus: { 'ups.beeper.status': 'disabled' } })
    mockClient.listCommands.mockResolvedValue(['beeper.enable', 'beeper.disable'])
    mockClient.runCommand.mockResolvedValue(true)
    nutService.pollDevice.mockResolvedValue({ 'ups.beeper.status': 'enabled', 'ups.status': 'OL' })

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/toggle`)
      .set(adminAuth)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      command: 'beeper.enable',
      device: {
        id: device.id,
        lastStatus: { 'ups.beeper.status': 'enabled', 'ups.status': 'OL' },
        hasNutCredentials: true,
      },
    })
    expect(mockClient.runCommand).toHaveBeenCalledWith('ups', 'beeper.enable')
    expect(nutService.pollDevice).toHaveBeenCalledWith('10.11.200.24', 3493, 'ups', 'fluxmon', 'secret')

    await device.reload()
    expect(device.lastStatus['ups.beeper.status']).toBe('enabled')
  })

  it('silences the beeper when the saved UPS status is not disabled', async () => {
    const device = await createDevice({ lastStatus: { 'ups.beeper.status': 'enabled' } })
    mockClient.listCommands.mockResolvedValue(['beeper.enable', 'beeper.disable'])
    mockClient.runCommand.mockResolvedValue(true)
    nutService.pollDevice.mockResolvedValue({ 'ups.beeper.status': 'disabled', 'ups.status': 'OL' })

    const res = await request(app)
      .post(`/api/devices/${device.id}/control/beeper/toggle`)
      .set(adminAuth)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      command: 'beeper.disable',
      device: {
        id: device.id,
        lastStatus: { 'ups.beeper.status': 'disabled', 'ups.status': 'OL' },
        hasNutCredentials: true,
      },
    })
    expect(mockClient.runCommand).toHaveBeenCalledWith('ups', 'beeper.disable')
  })
})
