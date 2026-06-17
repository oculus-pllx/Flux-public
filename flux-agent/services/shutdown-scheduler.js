const fs = require('fs')
const path = require('path')

const DEFAULT_STATE_FILE = '/etc/flux-agent/pending-shutdown.json'
let pendingTimer = null
let pendingShutdown = null

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function readPending(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return null
  }
}

function removePending(stateFile) {
  try { fs.unlinkSync(stateFile) } catch {}
}

function clearTimer() {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
}

function roleFromConfig(cfg) {
  return cfg.role || 'controlled'
}

function armTimer({ pending, cfg, send, stateFile }) {
  clearTimer()
  pendingShutdown = pending
  const delayMs = Math.max(0, new Date(pending.executeAt).getTime() - Date.now())
  pendingTimer = setTimeout(async () => {
    clearTimer()
    removePending(stateFile)
    pendingShutdown = null
    const { runShutdownSequence } = require('./sequencer')
    await runShutdownSequence({ role: roleFromConfig(cfg), cfg, send, shutdown: pending })
  }, delayMs)
}

async function scheduleShutdown({ message, cfg, send, stateFile = DEFAULT_STATE_FILE }) {
  if (!message.shutdownId) throw new Error('shutdownId is required')
  if (!message.executeAt) throw new Error('executeAt is required')

  const pending = {
    shutdownId: message.shutdownId,
    deviceId: message.deviceId,
    reason: message.reason || 'ups-critical',
    executeAt: message.executeAt,
    delaySeconds: message.delaySeconds,
  }

  ensureDir(stateFile)
  fs.writeFileSync(stateFile, JSON.stringify(pending, null, 2), { mode: 0o600 })
  armTimer({ pending, cfg, send, stateFile })
  send({ type: 'shutdown-scheduled', machineKey: cfg.machineKey, shutdownId: pending.shutdownId })
  return pending
}

async function loadPendingShutdown({ cfg, send, stateFile = DEFAULT_STATE_FILE }) {
  const pending = readPending(stateFile)
  if (!pending) return null
  armTimer({ pending, cfg, send, stateFile })
  return pending
}

async function cancelShutdown({ message, cfg, send, stateFile = DEFAULT_STATE_FILE }) {
  const pending = pendingShutdown || readPending(stateFile)
  if (!pending) return false
  if (message.shutdownId && pending.shutdownId !== message.shutdownId) {
    send({
      type: 'shutdown-cancel-ignored',
      machineKey: cfg.machineKey,
      shutdownId: message.shutdownId,
      pendingShutdownId: pending.shutdownId,
    })
    return false
  }

  clearTimer()
  pendingShutdown = null
  removePending(stateFile)
  send({ type: 'shutdown-cancelled', machineKey: cfg.machineKey, shutdownId: pending.shutdownId })
  return true
}

function clearForTest() {
  clearTimer()
  pendingShutdown = null
}

module.exports = {
  scheduleShutdown,
  loadPendingShutdown,
  cancelShutdown,
  clearForTest,
  DEFAULT_STATE_FILE,
}
