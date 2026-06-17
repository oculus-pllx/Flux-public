const mockExec = jest.fn()
const mockFs = {
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  copyFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
}

jest.mock('child_process', () => ({ exec: mockExec }))
jest.mock('fs', () => mockFs)

function setupExec(err, stdout = '') {
  mockExec.mockImplementationOnce((cmd, cb) => cb(err, stdout, err ? err.message : ''))
}

describe('nut service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockFs.writeFileSync.mockClear()
    mockFs.mkdirSync.mockClear()
    mockFs.copyFileSync.mockClear()
    mockFs.existsSync.mockReturnValue(false)
  })

  describe('isNutInstalled', () => {
    it('returns true when nut-server service is active', async () => {
      setupExec(null, 'active')  // systemctl is-active
      const { isNutInstalled } = require('../services/nut')
      const result = await isNutInstalled()
      expect(result).toBe(true)
    })

    it('returns true when upsc is available even if service is inactive', async () => {
      setupExec(new Error('not-active'))  // systemctl fails
      setupExec(null, '/usr/bin/upsc')    // which upsc
      const { isNutInstalled } = require('../services/nut')
      const result = await isNutInstalled()
      expect(result).toBe(true)
    })

    it('returns false when neither nut-server nor upsc are available', async () => {
      setupExec(new Error('not found'))  // systemctl
      setupExec(new Error('not found'))  // which upsc
      const { isNutInstalled } = require('../services/nut')
      const result = await isNutInstalled()
      expect(result).toBe(false)
    })
  })

  describe('writeUpsConf', () => {
    it('writes /etc/nut/ups.conf with correct NUT format', () => {
      const { writeUpsConf } = require('../services/nut')
      writeUpsConf({ upsName: 'myups', driver: 'usbhid-ups', port: 'auto', desc: 'Main UPS' })
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/etc/nut/ups.conf',
        expect.stringContaining('[myups]'),
        expect.objectContaining({ mode: 0o640 }),
      )
      const content = mockFs.writeFileSync.mock.calls[0][1]
      expect(content).toContain('driver = usbhid-ups')
      expect(content).toContain('port = auto')
    })
  })

  describe('writeUpsdConf', () => {
    it('writes /etc/nut/upsd.conf with LISTEN directive', () => {
      const { writeUpsdConf } = require('../services/nut')
      writeUpsdConf({ upsdPort: 3493 })
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/etc/nut/upsd.conf',
        expect.stringContaining('LISTEN 0.0.0.0 3493'),
        expect.objectContaining({ mode: 0o640 }),
      )
    })
  })

  describe('writeUpsdUsers', () => {
    it('writes /etc/nut/upsd.users with user block', () => {
      const { writeUpsdUsers } = require('../services/nut')
      writeUpsdUsers({
        upsdUser: { name: 'fluxmon', password: 'pass1', upsmonPassword: 'pass2' },
      })
      const content = mockFs.writeFileSync.mock.calls[0][1]
      expect(content).toContain('[fluxmon]')
      expect(content).toContain('password = pass1')
    })
  })

  describe('pollStatus', () => {
    it('parses upsc output into key-value object', async () => {
      const upscOutput = [
        'battery.charge: 100',
        'battery.voltage: 13.60',
        'ups.status: OL',
        'ups.load: 25',
      ].join('\n')
      setupExec(null, upscOutput)
      const { pollStatus } = require('../services/nut')
      const status = await pollStatus('myups')
      expect(status['ups.status']).toBe('OL')
      expect(status['battery.charge']).toBe('100')
      expect(status['ups.load']).toBe('25')
    })
  })

  describe('applyManagedConfig', () => {
    it('does not write or restart NUT when managedByFlux is not enabled', async () => {
      const { applyManagedConfig } = require('../services/nut')
      const result = await applyManagedConfig({ upsName: 'ups', driver: 'usbhid-ups' })

      expect(result).toEqual({ applied: false, reason: 'not-managed' })
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(mockExec).not.toHaveBeenCalled()
    })

    it('backs up existing config before applying managed config', async () => {
      mockFs.existsSync.mockImplementation((p) => p === '/etc/nut' || p.endsWith('ups.conf') || p.endsWith('nut.conf'))
      setupExec(null, 'active') // isNutInstalled
      setupExec(null, '')       // restartNut

      const { applyManagedConfig } = require('../services/nut')
      const result = await applyManagedConfig({
        managedByFlux: true,
        upsName: 'ups',
        driver: 'usbhid-ups',
        port: 'auto',
        desc: 'Main UPS',
        upsdPort: 3493,
        upsdUser: { name: 'fluxmon', password: 'secret' },
      }, { timestamp: '20260617-200000' })

      expect(result.applied).toBe(true)
      expect(result.backupDir).toBe('/etc/nut/flux-backup-20260617-200000')
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/etc/nut/flux-backup-20260617-200000', { recursive: true, mode: 0o700 })
      expect(mockFs.copyFileSync).toHaveBeenCalledWith('/etc/nut/ups.conf', '/etc/nut/flux-backup-20260617-200000/ups.conf')
      const copyOrder = mockFs.copyFileSync.mock.invocationCallOrder[0]
      const writeOrder = mockFs.writeFileSync.mock.invocationCallOrder[0]
      expect(copyOrder).toBeLessThan(writeOrder)
    })

    it('does not write NUT config when backup fails', async () => {
      mockFs.existsSync.mockImplementation((p) => p === '/etc/nut' || p.endsWith('ups.conf'))
      mockFs.copyFileSync.mockImplementation(() => { throw new Error('copy failed') })

      const { applyManagedConfig } = require('../services/nut')
      await expect(applyManagedConfig({
        managedByFlux: true,
        upsName: 'ups',
        driver: 'usbhid-ups',
      }, { timestamp: '20260617-200001' })).rejects.toThrow('copy failed')

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })
})
