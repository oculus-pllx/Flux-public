const https = require('https')
const http = require('http')

function apiRequest(pbsConfig, method, path, body = null) {
  if (!pbsConfig || !pbsConfig.tokenId || !pbsConfig.tokenSecret || !pbsConfig.url) {
    return Promise.reject(new Error('pbsService: pbsConfig must include url, tokenId, and tokenSecret'))
  }
  return new Promise((resolve, reject) => {
    const u = new URL(pbsConfig.url + '/api2/json' + path)
    const isHttps = u.protocol === 'https:'
    const options = {
      hostname: u.hostname,
      port: Number(u.port) || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method,
      headers: {
        Authorization: `PBSAPIToken=${pbsConfig.tokenId}:${pbsConfig.tokenSecret}`,
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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed.data)
          } else {
            reject(new Error(`PBS ${res.statusCode}: ${data}`))
          }
        } catch {
          reject(new Error(`PBS parse error: ${data}`))
        }
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function testConnection(pbsConfig) {
  const tasks = await apiRequest(pbsConfig, 'GET', '/nodes/localhost/tasks?running=1')
  return { runningJobCount: Array.isArray(tasks) ? tasks.length : 0 }
}

module.exports = {
  apiRequest,
  testConnection,
}
