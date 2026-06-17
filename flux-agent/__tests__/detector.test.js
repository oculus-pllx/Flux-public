jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))
jest.mock('fs', () => ({ existsSync: jest.fn() }))

const { execSync } = require('child_process')
const fs = require('fs')
const { detectVirtualization, detectRole, detectOS, isWindows } = require('../services/detector')

describe('detectVirtualization (Linux mock)', () => {
  beforeEach(() => {
    execSync.mockReset()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  })

  it('returns kvm when systemd-detect-virt says kvm', () => {
    execSync.mockReturnValue(Buffer.from('kvm\n'))
    expect(detectVirtualization()).toBe('kvm')
  })

  it('returns none on error', () => {
    execSync.mockImplementation(() => { throw new Error('not found') })
    expect(detectVirtualization()).toBe('none')
  })
})

describe('detectRole (Linux mock)', () => {
  beforeEach(() => {
    execSync.mockReset()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  })

  it('detects pve-node', () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('pve-manager')) return Buffer.from('')
      throw new Error()
    })
    expect(detectRole()).toBe('pve-node')
  })

  it('detects pbs', () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('pve-manager')) throw new Error()
      if (cmd.includes('proxmox-backup-server')) return Buffer.from('')
      throw new Error()
    })
    expect(detectRole()).toBe('pbs')
  })

  it('defaults to controlled when nothing detected', () => {
    execSync.mockImplementation(() => { throw new Error() })
    expect(detectRole()).toBe('controlled')
  })
})
