jest.mock('https')
const https = require('https')

// Helper: simulate a PVE API HTTP response
function mockResponse(statusCode, data) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(JSON.stringify({ data }))
      if (event === 'end') cb()
    }),
  }
}

function setupMock(statusCode, data) {
  const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() }
  https.request.mockImplementationOnce((opts, cb) => {
    process.nextTick(() => cb(mockResponse(statusCode, data)))
    return mockReq
  })
}

const PVE_CONFIG = {
  url: 'https://192.168.0.10:8006',
  tokenId: 'flux@pam!flux-agent',
  tokenSecret: 'secret123',
  node: 'pve',
}

describe('proxmoxService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('freezeHa', () => {
    it('sends PUT /api2/json/cluster/options with HA freeze body', async () => {
      setupMock(200, null)
      const { freezeHa } = require('../services/proxmoxService')
      await freezeHa(PVE_CONFIG)

      expect(https.request).toHaveBeenCalledTimes(1)
      const [opts] = https.request.mock.calls[0]
      expect(opts.method).toBe('PUT')
      expect(opts.path).toBe('/api2/json/cluster/options')
      expect(opts.headers.Authorization).toBe(
        `PVEAPIToken=${PVE_CONFIG.tokenId}=${PVE_CONFIG.tokenSecret}`
      )
      const mockReq = https.request.mock.results[0].value
      expect(mockReq.write).toHaveBeenCalledWith(
        JSON.stringify({ ha: 'shutdown_policy=freeze' })
      )
    })

    it('rejects on non-2xx response', async () => {
      setupMock(500, null)
      const { freezeHa } = require('../services/proxmoxService')
      await expect(freezeHa(PVE_CONFIG)).rejects.toThrow('PVE 500')
    })
  })

  describe('getClusterOptions', () => {
    it('resolves with parsed data on 200', async () => {
      const payload = { ha: 'shutdown_policy=freeze' }
      setupMock(200, payload)
      const { getClusterOptions } = require('../services/proxmoxService')
      const result = await getClusterOptions(PVE_CONFIG)
      expect(result).toEqual(payload)
    })
  })

  describe('waitHaFrozen', () => {
    it('resolves true when cluster options already show freeze', async () => {
      setupMock(200, { ha: 'shutdown_policy=freeze' })
      const { waitHaFrozen } = require('../services/proxmoxService')
      const result = await waitHaFrozen(PVE_CONFIG, 5000)
      expect(result).toBe(true)
    })

    it('throws when freeze confirmation times out', async () => {
      // Always returns non-freeze policy
      https.request.mockImplementation((opts, cb) => {
        process.nextTick(() => cb(mockResponse(200, { ha: 'shutdown_policy=migrate' })))
        return { on: jest.fn(), write: jest.fn(), end: jest.fn() }
      })
      const { waitHaFrozen } = require('../services/proxmoxService')
      await expect(waitHaFrozen(PVE_CONFIG, 100)).rejects.toThrow('timed out')
    })
  })
})
