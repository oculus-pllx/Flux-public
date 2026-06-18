const { executeShutdown } = require('./shutdown')

/**
 * Run the role-appropriate shutdown sequence.
 *
 * @param {object} params
 * @param {string} params.role - 'controlled' | 'ups-host' | 'pve-node' | 'pbs' | 'both'
 * @param {object} params.cfg - agent config (pveConfig, pbsConfig, machineKey, etc.)
 * @param {function} params.send - function to send WebSocket messages to Flux
 */
async function runShutdownSequence({ role, cfg, send, shutdown = null }) {
  const { machineKey } = cfg

  function step(s, done, total) {
    send({
      type: 'shutdown-step',
      machineKey,
      step: s,
      done,
      total,
      ...(shutdown?.shutdownId ? { shutdownId: shutdown.shutdownId } : {}),
      ...(shutdown?.deviceId ? { deviceId: shutdown.deviceId } : {}),
    })
  }

  try {
    // Proxmox-capable roles stop VMs/CTs before OS shutdown.
    if ((role === 'pve-node' || role === 'ups-host' || role === 'both') && cfg.pveConfig) {
      const proxmox = require('./proxmox')
      await proxmox.enableNodeMaintenance(cfg.pveConfig)
      step('enabling HA maintenance', 1, 1)
      await proxmox.stopAllGuests(cfg.pveConfig, ({ done, total }) => {
        step('stopping guests', done, total)
      })
    }

    // pbs and 'both': abort running backup jobs before OS shutdown
    if ((role === 'pbs' || role === 'both') && cfg.pbsConfig) {
      const pbs = require('./pbs')
      const timeoutMs = (cfg.pbsConfig.jobAbortTimeout || 120) * 1000
      const forceShutdown = cfg.pbsConfig.forceShutdown !== false
      const result = await pbs.abortAllJobs(cfg.pbsConfig, { timeoutMs, forceShutdown })
      step('aborting PBS jobs', result.aborted, result.aborted)
    }

    // All roles: execute OS shutdown
    await executeShutdown(0)
  } catch (err) {
    send({ type: 'shutdown-error', machineKey, error: err.message })
    // Always attempt OS shutdown even after errors
    await executeShutdown(0).catch(() => {})
  }
}

module.exports = { runShutdownSequence }
