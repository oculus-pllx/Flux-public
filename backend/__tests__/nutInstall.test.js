process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

// Mock ssh2 with a controllable response per exec call
let mockExecResponses = []
let mockExecCommands = []
jest.mock('ssh2', () => {
  const EventEmitter = require('events')
  return {
    Client: class MockClient extends EventEmitter {
      connect() { setTimeout(() => this.emit('ready'), 0) }
      exec(cmd, cb) {
        mockExecCommands.push(cmd)
        const stream = new EventEmitter()
        stream.stderr = new EventEmitter()
        cb(null, stream)
        const response = mockExecResponses.length ? mockExecResponses.shift() : 'FLUX_NUT_SERVER_OK\n'
        setTimeout(() => {
          stream.emit('data', Buffer.from(response))
          stream.emit('close', 0)
        }, 0)
      }
      end() {}
    }
  }
})

const sshService = require('../services/sshService')

const machine = {
  host: '192.168.0.100',
  sshPort: 22,
  sshUser: 'root',
  sshAuthType: 'password',
  sshPassword: 'secret',
}

beforeEach(() => { mockExecResponses = []; mockExecCommands = [] })

describe('sshService.deployNutMonitor (regression: multi-line scripts)', () => {
  it('accepts its own multi-line script and resolves on FLUX_DEPLOY_OK', async () => {
    mockExecResponses = ['installing...\nFLUX_DEPLOY_OK\n']
    const output = await sshService.deployNutMonitor(machine, {
      nutHost: '192.168.0.55', nutPort: 3493, upsName: 'ups',
      nutUsername: 'fluxmon', nutPassword: 'fluxmon',
    })
    expect(output).toContain('FLUX_DEPLOY_OK')
  })

  it('skips package install when upsmon is already present', async () => {
    mockExecResponses = ['FLUX_DEPLOY_OK\n']
    await sshService.deployNutMonitor(machine, {
      nutHost: '192.168.0.55', nutPort: 3493, upsName: 'ups',
      nutUsername: 'fluxmon', nutPassword: 'fluxmon',
    })
    const script = mockExecCommands[0]
    expect(script).toContain('command -v upsmon')
    expect(script).toContain('apt-get update')
  })
})

describe('sshService.getNutMonitorStatus (regression: multi-line scripts)', () => {
  it('returns the status line', async () => {
    mockExecResponses = ['running:nut-monitor\n']
    const status = await sshService.getNutMonitorStatus(machine)
    expect(status).toBe('running:nut-monitor')
  })
})

describe('sshService.installNutServer', () => {
  it('resolves when output contains FLUX_NUT_SERVER_OK', async () => {
    mockExecResponses = ['setting up nut...\nFLUX_NUT_SERVER_OK\n']
    const output = await sshService.installNutServer(machine, {
      nutUsername: 'fluxmon', nutPassword: 'abc123def456',
    })
    expect(output).toContain('FLUX_NUT_SERVER_OK')
  })

  it('script installs packages, configures netserver mode, LISTEN, and monitor user', async () => {
    mockExecResponses = ['FLUX_NUT_SERVER_OK\n']
    await sshService.installNutServer(machine, {
      nutUsername: 'fluxmon', nutPassword: 'abc123def456',
    })
    const script = mockExecCommands[0]
    expect(script).toContain('apt-get update')
    expect(script).toContain('MODE=netserver')
    expect(script).toContain('LISTEN 0.0.0.0 3493')
    expect(script).toContain('upsmon primary')
    expect(script).toContain('actions = SET')
    expect(script).toContain('instcmds = ALL')
    expect(script).toContain("'fluxmon'")
    expect(script).toContain('usbhid-ups')
  })

  it('throws when sentinel is missing from output', async () => {
    mockExecResponses = ['E: Unable to locate package nut\n']
    await expect(
      sshService.installNutServer(machine, { nutUsername: 'fluxmon', nutPassword: 'x1' })
    ).rejects.toThrow('NUT server install did not complete')
  })

  it('rejects invalid nut username', async () => {
    await expect(
      sshService.installNutServer(machine, { nutUsername: 'bad user!', nutPassword: 'x1' })
    ).rejects.toThrow()
  })
})

describe('sshService.configureNutSource', () => {
  it('writes an APC SNMP source, backs up config, restarts NUT, and verifies with upsc', async () => {
    mockExecResponses = ['switching...\nFLUX_NUT_SOURCE_OK\n']
    const output = await sshService.configureNutSource(machine, {
      sourceType: 'snmp',
      upsName: 'apc2200',
      snmpHost: '10.250.0.2',
      snmpVersion: 'v1',
      community: 'public',
      mibs: 'apcc',
    })

    expect(output).toContain('FLUX_NUT_SOURCE_OK')
    const script = mockExecCommands[0]
    expect(script).toContain('flux-source-backup-')
    expect(script).toContain('[apc2200]')
    expect(script).toContain('driver = snmp-ups')
    expect(script).toContain('port = 10.250.0.2')
    expect(script).toContain('community = public')
    expect(script).toContain('snmp_version = v1')
    expect(script).toContain('mibs = apcc')
    expect(script).toContain('systemctl restart nut-server')
    expect(script).toContain('upsc "$UPS_NAME"')
  })

  it('throws when source switch verification does not produce the success sentinel', async () => {
    mockExecResponses = ['FLUX_NUT_SOURCE_ROLLBACK\nupsc failed\n']

    await expect(
      sshService.configureNutSource(machine, {
        sourceType: 'usb',
        upsName: 'apc2200',
        vendorid: '051D',
        productid: '0003',
      })
    ).rejects.toThrow('NUT source switch did not complete')
  })
})
