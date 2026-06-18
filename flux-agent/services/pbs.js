const https = require('https')
const http = require('http')

/**
 * pbsConfig: { url, tokenId, tokenSecret }
 * PBS default port is 8007.
 */
function apiRequest(pbsConfig, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(pbsConfig.url + '/api2/json' + path)
    const isHttps = u.protocol === 'https:'
    const options = {
      hostname: u.hostname,
      port: Number(u.port) || (isHttps ? 8007 : 80),
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
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed.data)
          else reject(new Error(`PBS ${res.statusCode}: ${data}`))
        } catch { reject(new Error(`PBS parse error: ${data}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/** List all currently running tasks (backup jobs, GC, etc.). */
async function listRunningJobs(pbsConfig) {
  const data = await apiRequest(pbsConfig, 'GET', '/nodes/localhost/tasks?running=1')
  return data || []
}

/** Send a stop command to a specific task by UPID. */
function abortJob(pbsConfig, upid) {
  return apiRequest(pbsConfig, 'POST', `/nodes/localhost/tasks/${encodeURIComponent(upid)}/status`, {
    command: 'stop',
  })
}

/** Get the current status of a task. Returns 'stopped' | 'running' | etc. */
async function getTaskStatus(pbsConfig, upid) {
  const data = await apiRequest(pbsConfig, 'GET', `/nodes/localhost/tasks/${encodeURIComponent(upid)}/status`)
  return data.status
}

/**
 * Poll until a task is stopped or timeout expires.
 * Returns true if stopped in time, false on timeout.
 */
async function waitJobStopped(pbsConfig, upid, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const status = await getTaskStatus(pbsConfig, upid)
      if (status === 'stopped') return true
    } catch { /* task may disappear once stopped */ }
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

/**
 * Abort all running jobs and wait for them to stop.
 * Options:
 *   timeoutMs (default 120000) — max wait per job
 *   forceShutdown (default true) — if true, proceed even if jobs don't stop in time
 *
 * Returns { aborted: number, timedOut: number }
 * Throws only if forceShutdown=false and jobs timed out.
 */
async function abortAllJobs(pbsConfig, { timeoutMs = 120000, forceShutdown = true } = {}) {
  const jobs = await listRunningJobs(pbsConfig)
  if (jobs.length === 0) return { aborted: 0, timedOut: 0 }

  // Abort all jobs simultaneously
  await Promise.all(jobs.map((j) => abortJob(pbsConfig, j.upid).catch(() => {})))

  // Wait for all to stop
  const results = await Promise.all(jobs.map((j) => waitJobStopped(pbsConfig, j.upid, timeoutMs)))
  const timedOut = results.filter((r) => !r).length

  if (timedOut > 0 && !forceShutdown) {
    throw new Error(`${timedOut} PBS job(s) did not stop within ${timeoutMs}ms`)
  }

  return { aborted: jobs.length, timedOut }
}

module.exports = { apiRequest, listRunningJobs, abortJob, getTaskStatus, waitJobStopped, abortAllJobs }
