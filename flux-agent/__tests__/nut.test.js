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

    it('retries polling when NUT is briefly unavailable after restart', async () => {
      setupExec(new Error('Error: Connection failure: Connection refused'))
      setupExec(null, 'ups.status: OL\nups.model: Smart-UPS 1500')

      const { pollStatusWithRetry } = require('../services/nut')
      const status = await pollStatusWithRetry('myups', { attempts: 2, delayMs: 1 })

      expect(status['ups.status']).toBe('OL')
      expect(mockExec).toHaveBeenNthCalledWith(1, 'upsc myups', expect.any(Function))
      expect(mockExec).toHaveBeenNthCalledWith(2, 'upsc myups', expect.any(Function))
    })
  })

  describe('discoverConfig', () => {
    it('discovers the first local UPS from upsc -l', async () => {
      setupExec(null, 'apc2200: APC Smart-UPS 2200 HID\nrackups: Rack UPS')

      const { discoverConfig } = require('../services/nut')
      const config = await discoverConfig()

      expect(config).toEqual({ upsName: 'apc2200', sourceType: 'usb' })
    })

    it('throws a clear error when no local UPS is listed', async () => {
      setupExec(null, '')

      const { discoverConfig } = require('../services/nut')

      await expect(discoverConfig()).rejects.toThrow('No local NUT UPS found')
    })
  })

  describe('restartServices', () => {
    it('restarts the specific NUT driver and NUT server', async () => {
      setupExec(null, '')
      setupExec(null, '')

      const { restartServices } = require('../services/nut')
      await restartServices('myups')

      expect(mockExec).toHaveBeenNthCalledWith(1, "systemctl restart 'nut-driver@myups'", expect.any(Function))
      expect(mockExec).toHaveBeenNthCalledWith(2, 'systemctl restart nut-server', expect.any(Function))
    })

    it('falls back to upsdrvctl when the systemd driver restart fails', async () => {
      setupExec(new Error('driver restart failed'))
      setupExec(null, '')
      setupExec(null, '')

      const { restartServices } = require('../services/nut')
      await restartServices('myups')

      expect(mockExec).toHaveBeenNthCalledWith(1, "systemctl restart 'nut-driver@myups'", expect.any(Function))
      expect(mockExec).toHaveBeenNthCalledWith(2, "upsdrvctl start 'myups'", expect.any(Function))
      expect(mockExec).toHaveBeenNthCalledWith(3, 'systemctl restart nut-server', expect.any(Function))
    })
  })

  describe('checkHealth', () => {
    it('reports ok for a visible USB UPS with reachable NUT services', async () => {
      setupExec(null, 'battery.charge: 100\nups.status: OL')
      setupExec(null, 'active') // nut-server
      setupExec(null, 'active') // nut-driver@myups
      setupExec(null, 'Bus 001 Device 002: ID 051d:0003 American Power Conversion UPS')

      const { checkHealth } = require('../services/nut')
      const health = await checkHealth({
        upsName: 'myups',
        sourceType: 'usb',
        vendorid: '051D',
        productid: '0003',
      }, { now: () => new Date('2026-06-24T14:00:00.000Z') })

      expect(health).toMatchObject({
        state: 'ok',
        sourceType: 'usb',
        message: 'USB data source healthy',
        checkedAt: '2026-06-24T14:00:00.000Z',
        checks: {
          upscReachable: true,
          nutServerActive: true,
          nutDriverActive: true,
          usbDevicePresent: true,
        },
      })
    })

    it('reports degraded when NUT answers but the configured USB device is missing', async () => {
      setupExec(null, 'battery.charge: 100\nups.status: OL')
      setupExec(null, 'active') // nut-server
      setupExec(null, 'active') // nut-driver@myups
      setupExec(new Error('no device')) // lsusb

      const { checkHealth } = require('../services/nut')
      const health = await checkHealth({
        upsName: 'myups',
        sourceType: 'usb',
        vendorid: '051D',
        productid: '0003',
      }, { now: () => new Date('2026-06-24T14:01:00.000Z') })

      expect(health.state).toBe('degraded')
      expect(health.message).toBe('USB UPS device 051d:0003 is not visible on this host')
      expect(health.checks.upscReachable).toBe(true)
      expect(health.checks.usbDevicePresent).toBe(false)
    })

    it('infers USB vendor and product IDs from NUT variables when config omits them', async () => {
      setupExec(null, [
        'driver.parameter.vendorid: 051D',
        'driver.parameter.productid: 0003',
        'ups.status: OL',
      ].join('\n'))
      setupExec(null, 'active') // nut-server
      setupExec(null, 'active') // nut-driver@myups
      setupExec(new Error('no device')) // lsusb

      const { checkHealth } = require('../services/nut')
      const health = await checkHealth({
        upsName: 'myups',
        sourceType: 'usb',
      }, { now: () => new Date('2026-06-24T14:01:30.000Z') })

      expect(health.state).toBe('degraded')
      expect(health.message).toBe('USB UPS device 051d:0003 is not visible on this host')
      expect(health.checks.usbDevicePresent).toBe(false)
    })

    it('reports error when NUT polling fails', async () => {
      setupExec(new Error('Error: Data stale'))
      setupExec(null, 'active') // nut-server
      setupExec(new Error('inactive')) // nut-driver@myups
      setupExec(new Error('no device')) // lsusb

      const { checkHealth } = require('../services/nut')
      const health = await checkHealth({
        upsName: 'myups',
        sourceType: 'usb',
        vendorid: '051D',
      }, { now: () => new Date('2026-06-24T14:02:00.000Z') })

      expect(health.state).toBe('error')
      expect(health.message).toBe('NUT polling failed: Error: Data stale')
      expect(health.checks.upscReachable).toBe(false)
      expect(health.checks.nutDriverActive).toBe(false)
      expect(health.checks.usbDevicePresent).toBe(false)
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
