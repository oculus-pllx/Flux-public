const fs   = require('fs')
const path = require('path')
const http = require('http')
const { getLatestRelease, compareVersions } = require('./githubService')

const CURRENT_VERSION = require('../package.json').version
const CACHE_TTL_MS    = 10 * 60 * 1000

function githubRepo() {
  return process.env.FLUX_GITHUB_REPO || 'oculus-pllx/Flux-public'
}

function manualCommand(repo = githubRepo()) {
  const branch = process.env.FLUX_GITHUB_BRANCH || 'main'
  return `tmp=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/${repo}/${branch}/install.sh -o "$tmp" && printf '\\n' | sudo bash "$tmp"; rm -f "$tmp"`
}

function dir()         { return process.env.FLUX_UPDATE_DIR || '/var/lib/flux' }
function triggerFile() { return path.join(dir(), 'update-requested') }
function statusFile()  { return path.join(dir(), 'update-status.json') }
function logFile()     { return path.join(dir(), 'update.log') }
function marker()      { return path.join(dir(), '.updater-installed') }

let releaseCache = null // { at, release }

function detectMode() {
  if (process.env.FLUX_UPDATE_MODE) return process.env.FLUX_UPDATE_MODE
  if (fs.existsSync('/.dockerenv')) {
    // Without a sidecar token the backend cannot trigger updates from inside
    // its container — fall back to manual instructions.
    return process.env.UPDATER_TOKEN ? 'docker' : 'manual'
  }
  if (fs.existsSync(marker())) return 'systemd'
  return 'manual'
}

async function getStatus() {
  const mode = detectMode()
  let release = null
  let error = null
  if (releaseCache && Date.now() - releaseCache.at < CACHE_TTL_MS) {
    release = releaseCache.release
  } else {
    try {
      release = await getLatestRelease(githubRepo())
      releaseCache = { at: Date.now(), release }
    } catch (e) { error = e.message }
  }
  return {
    currentVersion:  CURRENT_VERSION,
    latestVersion:   release ? release.version : null,
    updateAvailable: !!release && compareVersions(release.version, CURRENT_VERSION) > 0,
    publishedAt:     release ? release.publishedAt : null,
    notes:           release ? release.notes : '',
    mode,
    repo:            githubRepo(),
    manualCommand:   manualCommand(),
    ...(error ? { error } : {}),
  }
}

function sidecarRequest(method, urlPath) {
  return new Promise((resolve, reject) => {
    const base = process.env.UPDATER_URL || 'http://updater:9275'
    const req = http.request(base + urlPath, {
      method,
      headers: { 'x-updater-token': process.env.UPDATER_TOKEN || '' },
      timeout: 10000,
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        let body = {}
        try { body = JSON.parse(raw) } catch {}
        if (res.statusCode >= 400) {
          const err = new Error(body.error || `Updater returned ${res.statusCode}`)
          err.status = res.statusCode
          return reject(err)
        }
        resolve(body)
      })
    })
    req.on('timeout', () => req.destroy(new Error('Updater sidecar timed out')))
    req.on('error', reject)
    req.end()
  })
}

async function applyUpdate() {
  const mode = detectMode()
  if (mode === 'systemd') {
    fs.writeFileSync(statusFile(), JSON.stringify({ state: 'requested', at: new Date().toISOString() }))
    fs.writeFileSync(triggerFile(), new Date().toISOString())
    return { started: true, mode }
  }
  if (mode === 'docker') {
    await sidecarRequest('POST', '/update')
    return { started: true, mode }
  }
  const err = new Error(
    'One-click update is not available for this install. ' +
    'Docker: run `git pull && docker compose up -d --build` in the Flux directory. ' +
    `Systemd: run \`${manualCommand()}\` once to enable the updater.`
  )
  err.status = 400
  throw err
}

async function getUpdateLog() {
  const mode = detectMode()
  if (mode === 'docker') {
    const [status, log] = await Promise.all([
      sidecarRequest('GET', '/status'),
      sidecarRequest('GET', '/log'),
    ])
    return { ...status, log: log.log || '', mode }
  }
  let status = { state: 'idle' }
  let log = ''
  try { status = JSON.parse(fs.readFileSync(statusFile(), 'utf8')) } catch {}
  try { log = fs.readFileSync(logFile(), 'utf8').slice(-20000) } catch {}
  return { ...status, log, mode }
}

module.exports = { detectMode, getStatus, applyUpdate, getUpdateLog }
