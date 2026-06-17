const https = require('https')
const http = require('http')

/**
 * Low-level PVE API request.
 * pveConfig: { url, tokenId, tokenSecret, node }
 */
function apiRequest(pveConfig, method, path, body = null) {
  if (!pveConfig || !pveConfig.tokenId || !pveConfig.tokenSecret || !pveConfig.url) {
    return Promise.reject(new Error('proxmoxService: pveConfig must include url, tokenId, and tokenSecret'))
  }
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
      rejectUnauthorized: false, // PVE uses self-signed certs
    }

    const lib = isHttps ? https : http
    const req = lib.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed.data)
          } else {
            reject(new Error(`PVE ${res.statusCode}: ${data}`))
          }
        } catch {
          reject(new Error(`PVE parse error: ${data}`))
        }
      })
    })

    req.on('error', reject)
    // PVE API v2 accepts Content-Type: application/json for PUT/POST operations
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/** Freeze Proxmox HA cluster-wide. Any node's API can be used. */
async function freezeHa(pveConfig, policy = 'freeze') {
  await apiRequest(pveConfig, 'PUT', '/cluster/options', {
    ha: `shutdown_policy=${policy}`,
  })
}

async function restoreHaPolicy(pveConfig, previousHaPolicy) {
  if (!previousHaPolicy) return
  await apiRequest(pveConfig, 'PUT', '/cluster/options', {
    ha: previousHaPolicy,
  })
}

/** Get current cluster options (includes ha.shutdown_policy). */
async function getClusterOptions(pveConfig) {
  return apiRequest(pveConfig, 'GET', '/cluster/options')
}

/**
 * Poll until HA shutdown_policy is set to 'freeze', or timeout.
 * timeoutMs defaults to 30000 (matches ClusterGroup.haFreezeTimeout default).
 */
async function waitHaFrozen(pveConfig, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const opts = await getClusterOptions(pveConfig)
    const ha = (opts && opts.ha) ? String(opts.ha) : ''
    if (ha.includes('shutdown_policy=freeze')) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`HA freeze confirmation timed out after ${timeoutMs}ms`)
}

module.exports = { apiRequest, freezeHa, restoreHaPolicy, getClusterOptions, waitHaFrozen }
