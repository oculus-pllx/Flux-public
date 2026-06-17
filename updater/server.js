// Flux updater sidecar: token-guarded, internal-network-only HTTP service
// that updates the Flux containers via the host Docker daemon.
const http = require('http')
const { spawn } = require('child_process')
const fs = require('fs')

const PORT     = 9275
const TOKEN    = process.env.UPDATER_TOKEN || ''
const REPO_DIR = process.env.REPO_DIR || process.cwd()
const LOG_FILE = '/tmp/update.log'

let state = { state: 'idle', at: null }
let running = false

function runUpdate() {
  if (running) return false
  running = true
  state = { state: 'running', at: new Date().toISOString() }
  fs.writeFileSync(LOG_FILE, '')
  const log = fs.createWriteStream(LOG_FILE, { flags: 'a' })
  // Only backend+frontend are rebuilt — the sidecar never replaces itself mid-run.
  const proc = spawn('sh', ['-c',
    'git -C "$REPO_DIR" pull && docker compose -f "$REPO_DIR/docker-compose.yml" up -d --build backend frontend',
  ], { env: { ...process.env, REPO_DIR, GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new' } })
  proc.stdout.pipe(log)
  proc.stderr.pipe(log)
  proc.on('close', (code) => {
    running = false
    state = { state: code === 0 ? 'success' : 'failed', code, at: new Date().toISOString() }
  })
  return true
}

http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (!TOKEN || req.headers['x-updater-token'] !== TOKEN) {
    res.writeHead(401)
    return res.end('{"error":"unauthorized"}')
  }
  if (req.method === 'POST' && req.url === '/update') {
    const started = runUpdate()
    res.writeHead(started ? 202 : 409)
    return res.end(JSON.stringify(started ? { started: true } : { error: 'update already running' }))
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200)
    return res.end(JSON.stringify(state))
  }
  if (req.method === 'GET' && req.url === '/log') {
    let log = ''
    try { log = fs.readFileSync(LOG_FILE, 'utf8') } catch {}
    res.writeHead(200)
    return res.end(JSON.stringify({ log: log.slice(-20000) }))
  }
  res.writeHead(404)
  res.end('{}')
}).listen(PORT, () => console.log(`[updater] listening on ${PORT}`))
