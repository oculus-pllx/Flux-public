const fs = require('fs')
const os = require('os')
const path = require('path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-agent-test-'))
const CONFIG_PATH = path.join(tmpDir, 'config.json')

let enrollment
beforeEach(() => {
  jest.resetModules()
  // Reload the module but with our test CONFIG_PATH injected
  const mod = require('../services/enrollment')
  mod.CONFIG_PATH = CONFIG_PATH
  enrollment = mod
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true })
})

describe('enrollment', () => {
  it('returns null machineKey when no config exists', () => {
    expect(enrollment.getMachineKey()).toBeNull()
  })

  it('saves and loads machineKey', () => {
    enrollment.saveConfig({ fluxUrl: 'ws://localhost:5174/api/agent', machineKey: 'test-uuid', role: 'controlled' })
    expect(enrollment.getMachineKey()).toBe('test-uuid')
    expect(enrollment.getConfig().fluxUrl).toBe('ws://localhost:5174/api/agent')
  })

  it('isEnrolled returns false when no config', () => {
    expect(enrollment.isEnrolled()).toBe(false)
  })

  it('isEnrolled returns true after saving config with machineKey', () => {
    enrollment.saveConfig({ fluxUrl: 'ws://localhost:5174/api/agent', machineKey: 'abc', role: 'controlled' })
    expect(enrollment.isEnrolled()).toBe(true)
  })
})
