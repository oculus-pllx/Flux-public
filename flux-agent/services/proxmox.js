const https = require('https')
const http = require('http')
const { exec } = require('child_process')

/**
 * pveConfig: { url, tokenId, tokenSecret, node }
 * url example: 'https://192.168.0.10:8006'
 */
function apiRequest(pveConfig, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(pveConfig.url + '/api2/json' + path)
    const isHttps = u.protocol === 'https:'
    const options = {
      hostname: u.hostname,
      port: Number(u.port) || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        Authorization: `PVEAPIToken=${pveConfig.tokenId}=${pveConfig.tokenSecret}`,
        'Content-Type': 'application/json',
      },
      rejectUnauthorized: false,
    }
    const lib = isHttps ? https : http
    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed.data)
          else reject(new Error(`PVE ${res.statusCode}: ${data}`))
        } catch { reject(new Error(`PVE parse error: ${data}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function runLocal(command) {
  return new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function pveNodeName(pveConfig) {
  if (!pveConfig || !pveConfig.node) throw new Error('pveConfig.node is required')
  return String(pveConfig.node).replace(/[^A-Za-z0-9_.-]/g, '')
}

function enableNodeMaintenance(pveConfig) {
  return runLocal(`ha-manager crm-command node-maintenance enable ${pveNodeName(pveConfig)}`)
}

function disableNodeMaintenance(pveConfig) {
  return runLocal(`ha-manager crm-command node-maintenance disable ${pveNodeName(pveConfig)}`)
}

/** List all QEMU VMs on the configured node. */
function listVMs(pveConfig) {
  return apiRequest(pveConfig, 'GET', `/nodes/${pveConfig.node}/qemu`)
}

/** List all LXC containers on the configured node. */
function listCTs(pveConfig) {
  return apiRequest(pveConfig, 'GET', `/nodes/${pveConfig.node}/lxc`)
}

/**
 * Send graceful ACPI shutdown to a guest.
 * type: 'qemu' | 'lxc'
 */
function stopGuest(pveConfig, type, vmid) {
  return apiRequest(pveConfig, 'POST', `/nodes/${pveConfig.node}/${type}/${vmid}/status/shutdown`, {})
}

/** Get current status of a guest. Returns 'running' | 'stopped' | etc. */
async function getGuestStatus(pveConfig, type, vmid) {
  const data = await apiRequest(pveConfig, 'GET', `/nodes/${pveConfig.node}/${type}/${vmid}/status/current`)
  return data.status
}

/**
 * Poll until guest is stopped or timeout expires.
 * Returns true if stopped, false if timed out. Never throws.
 */
async function waitGuestStopped(pveConfig, type, vmid, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const status = await getGuestStatus(pveConfig, type, vmid)
      if (status === 'stopped') return true
    } catch { /* guest may be unreachable as it powers down */ }
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

/**
 * Stop all VMs and CTs on this node simultaneously.
 * Calls onStep({ step, done, total }) as guests stop.
 * Never throws — always proceeds to let caller run OS shutdown.
 */
async function stopAllGuests(pveConfig, onStep) {
  const [vms, cts] = await Promise.all([listVMs(pveConfig), listCTs(pveConfig)])
  const guests = [
    ...(vms || []).map((v) => ({ type: 'qemu', vmid: v.vmid, name: v.name || `vm-${v.vmid}` })),
    ...(cts || []).map((c) => ({ type: 'lxc', vmid: c.vmid, name: c.name || `ct-${c.vmid}` })),
  ].filter((g) => g.vmid != null)

  if (guests.length === 0) return

  const total = guests.length
  let done = 0

  // Dispatch shutdown to all guests simultaneously (fire and forget errors)
  await Promise.all(guests.map((g) => stopGuest(pveConfig, g.type, g.vmid).catch(() => {})))

  // Wait for each guest to stop, reporting progress
  await Promise.all(guests.map(async (g) => {
    await waitGuestStopped(pveConfig, g.type, g.vmid)
    done++
    if (onStep) onStep({ step: 'stopping guests', done, total })
  }))
}

module.exports = {
  apiRequest,
  listVMs,
  listCTs,
  stopGuest,
  getGuestStatus,
  waitGuestStopped,
  stopAllGuests,
  enableNodeMaintenance,
  disableNodeMaintenance,
}
