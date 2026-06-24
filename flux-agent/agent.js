const wsClient = require('./services/ws-client')
const enrollment = require('./services/enrollment')
const { detectVirtualization, detectRole, detectOS } = require('./services/detector')

const AGENT_VERSION = require('./package.json').version

async function handleMessage(msg) {
  const cfg = enrollment.getConfig()

  switch (msg.type) {
    case 'shutdown': {
      const delay = msg.delaySeconds || 0
      const currentCfg = enrollment.getConfig()
      const currentRole = currentCfg.role || detectRole()
      console.log(`[agent] Shutdown received. Role=${currentRole}, delay=${delay}s`)
      wsClient.send({ type: 'shutdown-ack', machineKey: currentCfg.machineKey })
      setTimeout(async () => {
        const { runShutdownSequence } = require('./services/sequencer')
        await runShutdownSequence({
          role: currentRole,
          cfg: currentCfg,
          send: (payload) => wsClient.send(payload),
        })
      }, delay * 1000)
      break
    }

    case 'schedule-shutdown': {
      const scheduler = require('./services/shutdown-scheduler')
      const currentCfg = enrollment.getConfig()
      await scheduler.scheduleShutdown({
        message: msg,
        cfg: currentCfg,
        send: (payload) => wsClient.send(payload),
      })
      break
    }

    case 'cancel-shutdown': {
      const scheduler = require('./services/shutdown-scheduler')
      const currentCfg = enrollment.getConfig()
      await scheduler.cancelShutdown({
        message: msg,
        cfg: currentCfg,
        send: (payload) => wsClient.send(payload),
      })
      break
    }

    case 'disable-ha-maintenance': {
      const currentCfg = enrollment.getConfig()
      if (currentCfg.pveConfig) {
        const proxmox = require('./services/proxmox')
        try {
          await proxmox.disableNodeMaintenance(currentCfg.pveConfig)
          wsClient.send({
            type: 'ha-maintenance-disabled',
            machineKey: currentCfg.machineKey,
            shutdownId: msg.shutdownId,
            deviceId: msg.deviceId,
          })
        } catch (err) {
          wsClient.send({
            type: 'ha-maintenance-disable-error',
            machineKey: currentCfg.machineKey,
            shutdownId: msg.shutdownId,
            deviceId: msg.deviceId,
            error: err.message,
          })
        }
      }
      break
    }

    case 'ping': {
      wsClient.send({ type: 'pong', machineKey: cfg.machineKey })
      break
    }

    case 'config-update': {
      const current = enrollment.getConfig()
      const updated = { ...current, ...msg }
      // Don't persist the WebSocket message type field into config
      delete updated.type
      enrollment.saveConfig(updated)
      console.log('[agent] Config updated.')

      if (updated.nutConfig?.managedByFlux === true) {
        const nut = require('./services/nut')
        try {
          const result = await nut.applyManagedConfig(updated.nutConfig)
          wsClient.send({
            type: 'nut-config-applied',
            machineKey: updated.machineKey,
            backupDir: result.backupDir,
          })
        } catch (err) {
          wsClient.send({
            type: 'nut-config-error',
            machineKey: updated.machineKey,
            error: err.message,
          })
        }
      }

      // nutConfig updates are picked up automatically from getConfig() each tick.
      break
    }

    case 'nut-reprobe': {
      const currentCfg = enrollment.getConfig()
      const nut = require('./services/nut')
      try {
        const nutConfig = currentCfg.nutConfig || await nut.discoverConfig()
        const upsName = msg.upsName || nutConfig.upsName
        await nut.restartServices(upsName)
        const effectiveConfig = { ...nutConfig, upsName }
        const upsVars = await nut.pollStatus(upsName)
        const nutHealth = await nut.checkHealth(effectiveConfig)
        wsClient.send({
          type: 'nut-reprobe-result',
          requestId: msg.requestId,
          machineKey: currentCfg.machineKey,
          deviceId: msg.deviceId,
          ok: true,
          restarted: true,
          upsVars,
          nutHealth,
          variableInventory: {
            count: Object.keys(upsVars).length,
            keys: Object.keys(upsVars).sort(),
          },
        })
      } catch (err) {
        wsClient.send({
          type: 'nut-reprobe-result',
          requestId: msg.requestId,
          machineKey: currentCfg.machineKey,
          deviceId: msg.deviceId,
          ok: false,
          error: err.message,
        })
      }
      break
    }

    case 'update-available': {
      const { updatePolicy } = enrollment.getConfig()
      console.log(`[agent] Update available: v${msg.version} (policy: ${updatePolicy || 'manual'})`)
      if (updatePolicy === 'auto') {
        if (!msg.assetUrl) { console.error('[agent] update-available: missing assetUrl'); break }
        console.log('[agent] Auto-update policy: applying now...')
        const { selfUpdate } = require('./services/updater')
        selfUpdate(msg.assetUrl).catch((err) => {
          console.error('[agent] Auto-update failed:', err.message)
        })
      }
      break
    }

    case 'update': {
      if (!msg.assetUrl) { console.error('[agent] update: missing assetUrl'); break }
      console.log('[agent] Manual update triggered by Flux server.')
      const { selfUpdate } = require('./services/updater')
      selfUpdate(msg.assetUrl).catch((err) => {
        console.error('[agent] Update failed:', err.message)
      })
      break
    }

    default:
      break
  }
}

function toWsUrl(base) {
  return base.replace(/\/?$/, '/api/agent')
             .replace(/^http:\/\//, 'ws://')
             .replace(/^https:\/\//, 'wss://')
}

async function main() {
  const cfg = enrollment.getConfig()

  if (!cfg.fluxUrl) {
    console.error('[agent] No fluxUrl configured. Run installer to enroll.')
    process.exit(1)
  }

  const role = cfg.role || detectRole()
  const virtualization = detectVirtualization()
  const os = detectOS()

  console.log(`[agent] Starting flux-agent v${AGENT_VERSION}`)
  console.log(`[agent] Role: ${role} | Virt: ${virtualization} | OS: ${os}`)

  // First-time enrollment: no machineKey yet — connect with enroll message
  if (!cfg.machineKey && cfg.enrollmentToken) {
    const WebSocket = require('ws')
    const enrollWs = new WebSocket(toWsUrl(cfg.fluxUrl))
    enrollWs.on('open', () => {
      enrollWs.send(JSON.stringify({ type: 'enroll', token: cfg.enrollmentToken }))
    })
    enrollWs.on('message', (raw) => {
      const msg = JSON.parse(raw)
      if (msg.type === 'enrolled') {
        enrollment.saveConfig({ ...cfg, machineKey: msg.machineKey, enrollmentToken: null })
        console.log('[agent] Enrolled. Restarting service...')
        enrollWs.close()
        process.exit(0)
      } else {
        console.error('[agent] Enrollment failed:', raw.toString())
        process.exit(1)
      }
    })
    enrollWs.on('error', (err) => { console.error('[agent] Enrollment error:', err.message); process.exit(1) })
    return
  }

  const connectConfig = {
    fluxUrl: toWsUrl(cfg.fluxUrl),
    machineKey: cfg.machineKey,
    hostname: require('os').hostname(),
    role,
    virtualization,
    os,
    agentVersion: AGENT_VERSION,
    capabilities: [],
    onMessage: handleMessage,
  }

  await wsClient.connect(connectConfig)
  console.log('[agent] Connected to Flux server.')

  const scheduler = require('./services/shutdown-scheduler')
  await scheduler.loadPendingShutdown({
    cfg: enrollment.getConfig(),
    send: (payload) => wsClient.send(payload),
  })

  // NUT status polling for ups-host role.
  // We only poll — never reconfigure a NUT server that is already running.
  if (role === 'ups-host' || role === 'both') {
    const nut = require('./services/nut')

    const nutPollInterval = setInterval(async () => {
      const currentCfg = enrollment.getConfig()
      let nutConfig = currentCfg.nutConfig
      try {
        nutConfig = nutConfig || await nut.discoverConfig()
        const upsVars = await nut.pollStatus(nutConfig.upsName)
        const nutHealth = await nut.checkHealth(nutConfig)
        wsClient.send({
          type: 'status',
          machineKey: currentCfg.machineKey,
          nutStatus: upsVars['ups.status'] || 'UNKNOWN',
          upsVars,
          nutHealth,
        })
      } catch (err) {
        console.error('[agent] NUT poll failed:', err.message)
        if (!nutConfig) return
        try {
          const nutHealth = await nut.checkHealth(nutConfig)
          wsClient.send({
            type: 'status',
            machineKey: currentCfg.machineKey,
            nutStatus: 'UNKNOWN',
            upsVars: {},
            nutHealth,
          })
        } catch (healthErr) {
          console.error('[agent] NUT health check failed:', healthErr.message)
        }
      }
    }, 30000)

    process.on('SIGTERM', () => clearInterval(nutPollInterval))
    process.on('SIGINT', () => clearInterval(nutPollInterval))
  }

  process.on('SIGTERM', () => { wsClient.disconnect(); process.exit(0) })
  process.on('SIGINT',  () => { wsClient.disconnect(); process.exit(0) })
}

main().catch(err => { console.error('[agent] Fatal:', err.message); process.exit(1) })
