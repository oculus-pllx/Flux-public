jest.mock('https')
jest.mock('http')
jest.mock('child_process', () => ({ exec: jest.fn() }))
const https = require('https')
const http = require('http')
const { exec } = require('child_process')

function mockRes(statusCode, data) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(JSON.stringify({ data }))
      if (event === 'end') cb()
    }),
  }
}

function setupOnce(statusCode, data) {
  const req = { on: jest.fn(), write: jest.fn(), end: jest.fn() }
  https.request.mockImplementationOnce((opts, cb) => {
    setImmediate(() => cb(mockRes(statusCode, data)))
    return req
  })
  http.request.mockImplementationOnce((opts, cb) => {
    setImmediate(() => cb(mockRes(statusCode, data)))
    return req
  })
}

const PVE = {
  url: 'https://192.168.0.10:8006',
  tokenId: 'flux@pam!t',
  tokenSecret: 's',
  node: 'pve',
}

const {
  listVMs,
  listCTs,
  stopGuest,
  getGuestStatus,
  waitGuestStopped,
  stopAllGuests,
  enableNodeMaintenance,
  disableNodeMaintenance,
} = require('../services/proxmox')

describe('flux-agent proxmox service', () => {
	  beforeEach(() => {
	    jest.clearAllMocks()
	    exec.mockImplementation((cmd, cb) => cb(null, '', ''))
	  })

  it('listVMs calls GET /nodes/{node}/qemu and returns array', async () => {
    const vms = [{ vmid: 100, name: 'test-vm', status: 'running' }]
    setupOnce(200, vms)
    const result = await listVMs(PVE)
    expect(result).toEqual(vms)
    const [opts] = https.request.mock.calls[0]
    expect(opts.path).toBe('/api2/json/nodes/pve/qemu')
    expect(opts.method).toBe('GET')
  })

  it('listCTs calls GET /nodes/{node}/lxc and returns array', async () => {
    const cts = [{ vmid: 200, name: 'test-ct', status: 'running' }]
    setupOnce(200, cts)
    const result = await listCTs(PVE)
    expect(result).toEqual(cts)
    const [opts] = https.request.mock.calls[0]
    expect(opts.path).toBe('/api2/json/nodes/pve/lxc')
  })

  it('stopGuest calls POST /nodes/{node}/qemu/{vmid}/status/shutdown', async () => {
    setupOnce(200, null)
    await stopGuest(PVE, 'qemu', 100)
    const [opts] = https.request.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(opts.path).toBe('/api2/json/nodes/pve/qemu/100/status/shutdown')
  })

  it('getGuestStatus returns status string', async () => {
    setupOnce(200, { status: 'stopped', vmid: 100 })
    const status = await getGuestStatus(PVE, 'qemu', 100)
    expect(status).toBe('stopped')
  })

  it('waitGuestStopped returns true when guest stops before timeout', async () => {
    // First poll returns 'running', second returns 'stopped'
    setupOnce(200, { status: 'running' })
    setupOnce(200, { status: 'stopped' })
    const result = await waitGuestStopped(PVE, 'qemu', 100, 10000)
    expect(result).toBe(true)
  }, 30000)

  it('waitGuestStopped returns false (not throws) on timeout', async () => {
    // Always returns 'running' - set up multiple responses for polling
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() }
    https.request.mockImplementation((opts, cb) => {
      setImmediate(() => cb(mockRes(200, { status: 'running' })))
      return mockReq
    })
    http.request.mockImplementation((opts, cb) => {
      setImmediate(() => cb(mockRes(200, { status: 'running' })))
      return mockReq
    })
    const result = await waitGuestStopped(PVE, 'qemu', 100, 50)
    expect(result).toBe(false)
  }, 10000)

	  it('stopAllGuests sends shutdown to all VMs and CTs', async () => {
    // listVMs → [vm100], listCTs → [ct200]
    setupOnce(200, [{ vmid: 100, name: 'vm', status: 'running' }])  // listVMs
    setupOnce(200, [{ vmid: 200, name: 'ct', status: 'running' }])  // listCTs
    setupOnce(200, null)  // stopGuest vm100
    setupOnce(200, null)  // stopGuest ct200
    setupOnce(200, { status: 'stopped' })  // waitGuestStopped vm100
    setupOnce(200, { status: 'stopped' })  // waitGuestStopped ct200

    const steps = []
    const promise = stopAllGuests(PVE, ({ step, done, total }) => steps.push({ step, done, total }))
    await promise
    expect(steps.length).toBeGreaterThan(0)
	  }, 30000)

	  it('enableNodeMaintenance runs ha-manager for the configured node', async () => {
	    await enableNodeMaintenance(PVE)
	    expect(exec).toHaveBeenCalledWith(
	      'ha-manager crm-command node-maintenance enable pve',
	      expect.any(Function),
	    )
	  })

	  it('disableNodeMaintenance runs ha-manager for the configured node', async () => {
	    await disableNodeMaintenance(PVE)
	    expect(exec).toHaveBeenCalledWith(
	      'ha-manager crm-command node-maintenance disable pve',
	      expect.any(Function),
	    )
	  })
	})
