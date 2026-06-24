process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/sshService', () => ({
  runCommand: jest.fn(),
  installNutServer: jest.fn(),
  configureNutSource: jest.fn(),
}))
jest.mock('../services/pollingService', () => ({
  scheduleDevice: jest.fn(),
  stopDevice: jest.fn(),
}))
jest.mock('../services/nutService', () => ({
  pollDevice: jest.fn(),
}))
jest.mock('../services/agentHub', () => ({
  requestMachine: jest.fn(),
}))

const request = require('supertest')
const express = require('express')
const jwt     = require('jsonwebtoken')
const { sequelize } = require('../config/database')
const sshService = require('../services/sshService')
const nutService = require('../services/nutService')
const agentHub = require('../services/agentHub')
const Device = require('../models/Device')
const AgentMachine = require('../models/AgentMachine')

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

describe('POST /api/devices/:id/configure-nut', () => {
  it('repairs NUT over SSH and saves full-control credentials on an existing device', async () => {
    const device = await Device.create({
      name: 'APC 2200',
      host: '10.11.200.23',
      port: 3493,
      upsName: 'apc2200',
      pollInterval: 30,
    })
    sshService.installNutServer.mockResolvedValue('FLUX_NUT_SERVER_OK')
    nutService.pollDevice.mockResolvedValue({ 'ups.status': 'OL', 'ups.beeper.status': 'disabled' })
    mockSsh({
      upsNames: 'apc2200\n',
      upsdConf: 'LISTEN 0.0.0.0 3493\n',
      upsdUsers: '[fluxctl]\n  password = secret123\n  upsmon primary\n  actions = SET\n  instcmds = ALL\n',
    })

    const res = await request(app)
      .post(`/api/devices/${device.id}/configure-nut`)
      .set(auth)
      .send({ ...sshBody, nutUsername: 'fluxctl', nutPassword: 'secret123' })

    expect(res.status).toBe(200)
    expect(sshService.installNutServer).toHaveBeenCalledWith(
      expect.objectContaining({ host: sshBody.host }),
      { nutUsername: 'fluxctl', nutPassword: 'secret123' }
    )
    expect(nutService.pollDevice).toHaveBeenCalledWith('192.168.0.100', 3493, 'apc2200', 'fluxctl', 'secret123')
    expect(res.body.device.host).toBe('192.168.0.100')
    expect(res.body.device.upsName).toBe('apc2200')
    expect(res.body.device.nutUsername).toBe('fluxctl')
    expect(res.body.device.hasNutCredentials).toBe(true)
    expect(res.body.device.nutPassword).toBeUndefined()

    await device.reload()
    expect(device.nutUsername).toBe('fluxctl')
    expect(device.nutPassword).toBe('secret123')
    expect(device.lastStatus).toEqual({ 'ups.status': 'OL', 'ups.beeper.status': 'disabled' })
  })
})

describe('POST /api/devices/:id/source', () => {
  it('switches the NUT source without replacing the existing UPS device', async () => {
    const device = await Device.create({
      name: 'APC 2200',
      host: '10.11.200.23',
      port: 3493,
      upsName: 'apc2200',
      pollInterval: 30,
      nutUsername: 'fluxmon',
      nutPassword: 'saved-secret',
    })
    sshService.configureNutSource.mockResolvedValue('FLUX_NUT_SOURCE_OK')
    nutService.pollDevice.mockResolvedValue({ 'ups.status': 'OL', 'battery.runtime': '1200' })
    mockSsh({
      upsNames: 'apc2200\n',
      upsdConf: 'LISTEN 0.0.0.0 3493\n',
      upsdUsers: '[fluxmon]\n  password = saved-secret\n  upsmon primary\n  actions = SET\n  instcmds = ALL\n',
    })

    const res = await request(app)
      .post(`/api/devices/${device.id}/source`)
      .set(auth)
      .send({
        ...sshBody,
        sourceType: 'snmp',
        upsName: 'apc2200',
        snmpHost: '10.250.0.2',
        snmpVersion: 'v1',
        community: 'public',
        mibs: 'apcc',
      })

    expect(res.status).toBe(200)
    expect(sshService.configureNutSource).toHaveBeenCalledWith(
      expect.objectContaining({ host: sshBody.host }),
      {
        sourceType: 'snmp',
        upsName: 'apc2200',
        snmpHost: '10.250.0.2',
        snmpVersion: 'v1',
        community: 'public',
        mibs: 'apcc',
      }
    )
    expect(nutService.pollDevice).toHaveBeenCalledWith('192.168.0.100', 3493, 'apc2200', 'fluxmon', 'saved-secret')
    expect(res.body.configured).toBe(true)
    expect(res.body.sourceType).toBe('snmp')
    expect(res.body.device.id).toBe(device.id)
    expect(res.body.device.upsName).toBe('apc2200')
    expect(res.body.device.host).toBe('192.168.0.100')
    expect(res.body.device.hasNutCredentials).toBe(true)
    expect(res.body.device.nutPassword).toBeUndefined()

    await device.reload()
    expect(device.id).toBe(res.body.device.id)
    expect(device.upsName).toBe('apc2200')
    expect(device.nutPassword).toBe('saved-secret')
    expect(device.lastStatus).toEqual({ 'ups.status': 'OL', 'battery.runtime': '1200' })
  })

  it('rejects invalid source types', async () => {
    const device = await Device.create({
      name: 'APC 2200',
      host: '10.11.200.23',
      port: 3493,
      upsName: 'apc2200',
      pollInterval: 30,
    })

    const res = await request(app)
      .post(`/api/devices/${device.id}/source`)
      .set(auth)
      .send({ ...sshBody, sourceType: 'telnet' })

    expect(res.status).toBe(400)
    expect(sshService.configureNutSource).not.toHaveBeenCalled()
  })
})

describe('POST /api/devices/:id/reprobe', () => {
  it('asks the linked UPS-host agent to restart NUT and saves all returned variables', async () => {
    const device = await Device.create({
      name: 'Rack UPS',
      host: '10.11.200.23',
      port: 3493,
      upsName: 'apc2200',
      pollInterval: 30,
      lastStatus: {
        'ups.model': 'Smart-UPS 2200',
        'ups.serial': 'OLD2200',
        'ups.status': 'OL',
        'battery.charge': '100',
      },
    })
    await AgentMachine.create({
      machineKey: 'ups-agent-key',
      hostname: 'sms-pve-3',
      role: 'ups-host',
      upsGroupId: device.id,
      active: true,
    })

    const upsVars = {
      'ups.model': 'Smart-UPS 1500',
      'ups.serial': 'NEW1500',
      'ups.status': 'OL',
      'battery.charge': '98',
      'ups.load': '22',
      'input.voltage': '121.0',
      'output.voltage': '121.0',
    }
    const nutHealth = {
      state: 'ok',
      sourceType: 'usb',
      message: 'USB data source healthy',
      checks: { upscReachable: true },
    }
    agentHub.requestMachine.mockResolvedValue({
      ok: true,
      upsVars,
      nutHealth,
      restarted: true,
      variableInventory: {
        count: Object.keys(upsVars).length,
        keys: Object.keys(upsVars).sort(),
      },
    })

    const res = await request(app)
      .post(`/api/devices/${device.id}/reprobe`)
      .set(auth)
      .send({})

    expect(res.status).toBe(200)
    expect(agentHub.requestMachine).toHaveBeenCalledWith(
      'ups-agent-key',
      expect.objectContaining({ type: 'nut-reprobe', deviceId: device.id, upsName: 'apc2200' }),
      expect.objectContaining({ timeoutMs: 45000 })
    )
    expect(res.body.identity.before).toMatchObject({ model: 'Smart-UPS 2200', serial: 'OLD2200' })
    expect(res.body.identity.after).toMatchObject({ model: 'Smart-UPS 1500', serial: 'NEW1500' })
    expect(res.body.variables.added).toEqual(['input.voltage', 'output.voltage', 'ups.load'])
    expect(res.body.variables.count).toBe(7)
    expect(res.body.device.lastStatus).toMatchObject(upsVars)
    expect(res.body.device.nutHealth).toEqual(nutHealth)

    await device.reload()
    expect(device.lastStatus).toEqual(upsVars)
    expect(device.nutHealth).toEqual(nutHealth)
  })

  it('returns 409 when no linked UPS-host agent is online for reprobe', async () => {
    const device = await Device.create({
      name: 'Rack UPS',
      host: '10.11.200.23',
      port: 3493,
      upsName: 'apc2200',
      pollInterval: 30,
    })

    const res = await request(app)
      .post(`/api/devices/${device.id}/reprobe`)
      .set(auth)
      .send({})

    expect(res.status).toBe(409)
    expect(agentHub.requestMachine).not.toHaveBeenCalled()
  })
})
