jest.mock('../services/shutdown', () => ({ executeShutdown: jest.fn().mockResolvedValue() }))
jest.mock('../services/proxmox', () => ({
  enableNodeMaintenance: jest.fn().mockResolvedValue(),
  stopAllGuests: jest.fn().mockResolvedValue(),
}))
jest.mock('../services/pbs', () => ({
  abortAllJobs: jest.fn().mockResolvedValue({ aborted: 2, timedOut: 0 }),
}))

const { executeShutdown } = require('../services/shutdown')
const proxmox = require('../services/proxmox')
const pbs = require('../services/pbs')

// require after mocks are set up
const { runShutdownSequence } = require('../services/sequencer')

describe('runShutdownSequence', () => {
  let sent

  beforeEach(() => {
    sent = []
	    jest.clearAllMocks()
	    executeShutdown.mockResolvedValue()
	    proxmox.enableNodeMaintenance.mockResolvedValue()
	    proxmox.stopAllGuests.mockResolvedValue()
    pbs.abortAllJobs.mockResolvedValue({ aborted: 2, timedOut: 0 })
  })

  it('controlled role: calls executeShutdown immediately, no PVE/PBS calls', async () => {
    await runShutdownSequence({
      role: 'controlled',
      cfg: { machineKey: 'mk', pveConfig: null, pbsConfig: null },
      send: (m) => sent.push(m),
    })
    expect(executeShutdown).toHaveBeenCalledWith(0)
    expect(proxmox.stopAllGuests).not.toHaveBeenCalled()
    expect(pbs.abortAllJobs).not.toHaveBeenCalled()
  })

  it('ups-host role: calls executeShutdown immediately, no PVE/PBS calls', async () => {
    await runShutdownSequence({
      role: 'ups-host',
      cfg: { machineKey: 'mk', pveConfig: null, pbsConfig: null },
      send: (m) => sent.push(m),
    })
    expect(executeShutdown).toHaveBeenCalledWith(0)
    expect(proxmox.stopAllGuests).not.toHaveBeenCalled()
  })

  it('pve-node role: stops guests before OS shutdown', async () => {
    const pveConfig = { url: 'https://pve:8006', tokenId: 'x', tokenSecret: 'y', node: 'pve' }
    await runShutdownSequence({
      role: 'pve-node',
      cfg: { machineKey: 'mk', pveConfig, pbsConfig: null },
      send: (m) => sent.push(m),
    })
	    expect(proxmox.enableNodeMaintenance).toHaveBeenCalledWith(pveConfig)
	    expect(proxmox.stopAllGuests).toHaveBeenCalledWith(pveConfig, expect.any(Function))
    expect(pbs.abortAllJobs).not.toHaveBeenCalled()
    expect(executeShutdown).toHaveBeenCalledWith(0)

    // Verify stopAllGuests was called before executeShutdown
	    const maintenanceOrder = proxmox.enableNodeMaintenance.mock.invocationCallOrder[0]
	    const stopOrder = proxmox.stopAllGuests.mock.invocationCallOrder[0]
	    const shutdownOrder = executeShutdown.mock.invocationCallOrder[0]
	    expect(maintenanceOrder).toBeLessThan(stopOrder)
	    expect(stopOrder).toBeLessThan(shutdownOrder)
	  })

  it('pbs role: aborts jobs before OS shutdown', async () => {
    const pbsConfig = { url: 'https://pbs:8007', tokenId: 'x', tokenSecret: 'y', jobAbortTimeout: 60, forceShutdown: true }
    await runShutdownSequence({
      role: 'pbs',
      cfg: { machineKey: 'mk', pveConfig: null, pbsConfig },
      send: (m) => sent.push(m),
    })
    expect(pbs.abortAllJobs).toHaveBeenCalledWith(pbsConfig, {
      timeoutMs: 60000,
      forceShutdown: true,
    })
    expect(proxmox.stopAllGuests).not.toHaveBeenCalled()
    expect(executeShutdown).toHaveBeenCalledWith(0)
  })

	  it('sends shutdown-step messages during pve-node sequence', async () => {
    const pveConfig = { url: 'https://pve:8006', tokenId: 'x', tokenSecret: 'y', node: 'pve' }
    proxmox.stopAllGuests.mockImplementation(async (cfg, onStep) => {
      onStep({ step: 'stopping guests', done: 1, total: 2 })
      onStep({ step: 'stopping guests', done: 2, total: 2 })
    })
	    await runShutdownSequence({
	      role: 'pve-node',
	      cfg: { machineKey: 'mk', pveConfig, pbsConfig: null },
	      send: (m) => sent.push(m),
	      shutdown: { shutdownId: 'sd-ctx', deviceId: 44 },
	    })
	    const steps = sent.filter((m) => m.type === 'shutdown-step')
	    expect(steps.length).toBe(3)
	    expect(steps[0]).toMatchObject({
	      type: 'shutdown-step',
	      machineKey: 'mk',
	      step: 'enabling HA maintenance',
	      done: 1,
	      total: 1,
	      shutdownId: 'sd-ctx',
	      deviceId: 44,
	    })
	    expect(steps[1]).toMatchObject({ type: 'shutdown-step', machineKey: 'mk', step: 'stopping guests', done: 1, total: 2 })
	  })

  it('sends shutdown-error and still calls executeShutdown when stopAllGuests throws', async () => {
    proxmox.stopAllGuests.mockRejectedValue(new Error('PVE unavailable'))
    const pveConfig = { url: 'https://pve:8006', tokenId: 'x', tokenSecret: 'y', node: 'pve' }
    await runShutdownSequence({
      role: 'pve-node',
      cfg: { machineKey: 'mk', pveConfig, pbsConfig: null },
      send: (m) => sent.push(m),
    })
    const errors = sent.filter((m) => m.type === 'shutdown-error')
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('PVE unavailable')
    expect(executeShutdown).toHaveBeenCalledWith(0) // still proceeds
  })
})
