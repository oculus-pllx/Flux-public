const WebSocket = require('ws')

let ws = null
let heartbeatTimer = null
let reconnectTimer = null
let reconnectAttempt = 0
let currentConfig = null

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 60000]
let HEARTBEAT_MS = 30000

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
    return true
  }
  return false
}

function connect(config) {
  currentConfig = config
  return new Promise((resolve, reject) => {
    ws = new WebSocket(config.fluxUrl)

    ws.once('open', () => {
      reconnectAttempt = 0
      ws.send(JSON.stringify({
        type: 'register',
        machineKey: config.machineKey,
        hostname: config.hostname,
        role: config.role,
        virtualization: config.virtualization,
        os: config.os,
        agentVersion: config.agentVersion,
        capabilities: config.capabilities || [],
        clusterId: config.clusterId || null,
        clusterVotes: config.clusterVotes || 1,
        upsGroupId: config.upsGroupId || null,
      }))

      heartbeatTimer = setInterval(() => {
        send({ type: 'ping', machineKey: config.machineKey })
      }, HEARTBEAT_MS)

      resolve()
    })

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      if (config.onMessage) config.onMessage(msg)
    })

    ws.on('close', () => {
      clearInterval(heartbeatTimer)
      if (reconnectTimer) return // already reconnecting
      scheduleReconnect()
    })

    ws.on('error', (err) => {
      console.error('[ws-client] error:', err.message)
      if (ws.readyState === WebSocket.CONNECTING) reject(err)
    })
  })
}

function scheduleReconnect() {
  if (!currentConfig) return
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt++, RECONNECT_DELAYS.length - 1)]
  console.log(`[ws-client] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`)
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try { await connect(currentConfig) } catch {}
  }, delay)
}

function disconnect() {
  currentConfig = null
  clearInterval(heartbeatTimer)
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (ws) { ws.removeAllListeners(); ws.close(); ws = null }
}

module.exports = {
  connect,
  disconnect,
  send,
  get HEARTBEAT_MS() { return HEARTBEAT_MS },
  set HEARTBEAT_MS(v) { HEARTBEAT_MS = v },
}
