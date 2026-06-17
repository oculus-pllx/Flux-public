const mockKeyBuffer = Buffer.from('fake-ed25519-host-key')
let mockVerifierResults = []

jest.mock('ssh2', () => ({
  Client: class extends require('events').EventEmitter {
    connect(config) {
      if (config.hostVerifier) {
        const ok = config.hostVerifier(mockKeyBuffer)
        mockVerifierResults.push(ok)
        if (!ok) {
          process.nextTick(() => this.emit('error', new Error('Host verification failed')))
          return
        }
      }
      process.nextTick(() => this.emit('ready'))
    }
    exec(cmd, cb) {
      const stream = new (require('events').EventEmitter)()
      stream.stderr = new (require('events').EventEmitter)()
      cb(null, stream)
      process.nextTick(() => { stream.emit('data', 'ok'); stream.emit('close') })
    }
    end() {}
  },
}))

const crypto = require('crypto')
const sshService = require('../services/sshService')
const EXPECTED_FP = 'SHA256:' + crypto.createHash('sha256').update(mockKeyBuffer).digest('base64').replace(/=+$/, '')

beforeEach(() => { mockVerifierResults = [] })

test('first connection pins the fingerprint on a Sequelize-like machine', async () => {
  const updates = []
  const machine = { host: '10.0.0.5', sshAuthType: 'password', sshPassword: 'x',
    sshHostKey: null, update: async (v) => updates.push(v) }
  await sshService.runCommand(machine, 'echo ok')
  expect(updates).toEqual([{ sshHostKey: EXPECTED_FP }])
})

test('matching pinned key connects without re-saving', async () => {
  const updates = []
  const machine = { host: '10.0.0.5', sshAuthType: 'password', sshPassword: 'x',
    sshHostKey: EXPECTED_FP, update: async (v) => updates.push(v) }
  await expect(sshService.runCommand(machine, 'echo ok')).resolves.toBe('ok')
  expect(updates).toEqual([])
})

test('mismatched pinned key rejects with descriptive error', async () => {
  const machine = { host: '10.0.0.5', sshAuthType: 'password', sshPassword: 'x',
    sshHostKey: 'SHA256:doesnotmatch' }
  await expect(sshService.runCommand(machine, 'echo ok'))
    .rejects.toThrow(/Host key for 10\.0\.0\.5 changed.*reset its trusted host key/s)
  expect(mockVerifierResults).toEqual([false])
})

test('plain-object machines (wizard) connect TOFU without persistence', async () => {
  const machine = { host: '10.0.0.9', sshAuthType: 'password', sshPassword: 'x' }
  await expect(sshService.runCommand(machine, 'echo ok')).resolves.toBe('ok')
  expect(mockVerifierResults).toEqual([true])
})

test('installAgent also verifies and pins the host key', async () => {
  const updates = []
  const machine = { host: '10.0.0.7', sshAuthType: 'password', sshPassword: 'x',
    sshHostKey: null, update: async (v) => updates.push(v) }
  // mock exec emits 'ok' (no FLUX_INSTALL_OK), so installAgent rejects — but
  // the verifier must still have run and pinned the key.
  await expect(sshService.installAgent(machine, { fluxUrl: 'http://flux.local', token: 't' }))
    .rejects.toThrow(/Install did not complete/)
  expect(mockVerifierResults).toEqual([true])
  expect(updates).toEqual([{ sshHostKey: EXPECTED_FP }])
})
