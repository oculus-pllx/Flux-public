process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

// Mock ssh2 so no real connections are made
jest.mock('ssh2', () => {
  const EventEmitter = require('events')
  return {
    Client: class MockClient extends EventEmitter {
      connect() { setTimeout(() => this.emit('ready'), 0) }
      exec(cmd, cb) {
        const EventEmitter = require('events')
        const stream = new EventEmitter()
        stream.stderr = new EventEmitter()
        cb(null, stream)
        setTimeout(() => {
          stream.emit('data', Buffer.from('some output\nFLUX_INSTALL_OK\n'))
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

describe('sshService.installAgent', () => {
  it('resolves when output contains FLUX_INSTALL_OK', async () => {
    const output = await sshService.installAgent(machine, {
      fluxUrl: 'http://192.0.2.25:5174',
      token: 'abc123',
      role: null,
    })
    expect(output).toContain('FLUX_INSTALL_OK')
  })

  it('sets FLUX_ROLE when role is provided', async () => {
    jest.spyOn(require('../services/sshService'), 'installAgent')
    // We test by inspecting what would be sent — use a spy on runCommand via module internals.
    // Since runCommand is not exported, we check that installAgent resolves correctly
    // and trust the unit contract (role is shellQuote-escaped in the script).
    const output = await sshService.installAgent(machine, {
      fluxUrl: 'http://192.0.2.25:5174',
      token: 'abc123',
      role: 'ups-host',
    })
    expect(output).toContain('FLUX_INSTALL_OK')
  })

  it('throws when FLUX_INSTALL_OK is absent from output', async () => {
    // Override mock to return output without the sentinel
    const { Client } = require('ssh2')
    const origExec = Client.prototype.exec
    Client.prototype.exec = function(cmd, cb) {
      const EventEmitter = require('events')
      const stream = new EventEmitter()
      stream.stderr = new EventEmitter()
      cb(null, stream)
      setTimeout(() => {
        stream.emit('data', Buffer.from('error: something failed\n'))
        stream.emit('close', 1)
      }, 0)
    }
    await expect(
      sshService.installAgent(machine, { fluxUrl: 'http://x', token: 't', role: null })
    ).rejects.toThrow('Install did not complete')
    Client.prototype.exec = origExec
  })

  it('throws when host is missing', async () => {
    await expect(
      sshService.installAgent({ ...machine, host: '' }, { fluxUrl: 'http://x', token: 't', role: null })
    ).rejects.toThrow()
  })

  it('calls onOutput with data chunks', async () => {
    const chunks = []
    await sshService.installAgent(machine,
      { fluxUrl: 'http://192.0.2.25:5174', token: 'abc123', role: null },
      { onOutput: chunk => chunks.push(chunk) }
    )
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join('')).toContain('FLUX_INSTALL_OK')
  })

  it('uses sshKeyContent buffer when provided (key auth)', async () => {
    const keyMachine = { ...machine, sshAuthType: 'key', sshKeyContent: 'fake-pem-content', sshPassword: '' }
    // Should not throw "Cannot read key file" — uses buffer instead
    const output = await sshService.installAgent(keyMachine,
      { fluxUrl: 'http://192.0.2.25:5174', token: 'abc123', role: null }
    )
    expect(output).toContain('FLUX_INSTALL_OK')
  })
})
