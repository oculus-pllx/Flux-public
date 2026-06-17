const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')
const path = require('path')

const DEFAULT_INSTALL_DIR = process.platform === 'win32'
  ? 'C:\\Program Files\\Flux Agent'
  : '/opt/flux-agent'
const TEMP_FILE = process.platform === 'win32'
  ? path.join(require('os').tmpdir(), 'flux-agent-update.tgz')
  : '/tmp/flux-agent-update.tgz'

/**
 * Download assetUrl to dest. Follows redirects up to a depth of 5.
 */
function download(assetUrl, dest, _redirects = 0) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(assetUrl)
    } catch (e) {
      return reject(new Error(`Invalid download URL: ${assetUrl}`))
    }
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'User-Agent': 'flux-agent-updater' },
    }
    const req = https.request(opts, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        if (_redirects >= 5) return reject(new Error('Too many redirects'))
        return download(res.headers.location, dest, _redirects + 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`))
      }
      const ws = fs.createWriteStream(dest)
      res.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Extract tarball at src into installDir using tar xzf.
 */
function apply(src, installDir) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['xzf', src, '-C', installDir, '--strip-components=1'], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/**
 * Download + extract + exit (systemd/sc.exe restart picks up new code).
 */
async function selfUpdate(assetUrl) {
  const installDir = DEFAULT_INSTALL_DIR
  console.log(`[updater] Downloading ${assetUrl} → ${TEMP_FILE}`)
  try {
    await download(assetUrl, TEMP_FILE)
    console.log(`[updater] Extracting to ${installDir}`)
    await apply(TEMP_FILE, installDir)
    console.log('[updater] Update applied. Exiting for service restart...')
    process.exit(0)
  } catch (err) {
    try { fs.unlinkSync(TEMP_FILE) } catch (_) {}
    throw err
  }
}

module.exports = { download, apply, selfUpdate }
