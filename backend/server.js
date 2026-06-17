require('dotenv').config({ path: process.env.ENV_FILE || require('path').resolve(__dirname, '../.env') })
const { version } = require('./package.json')

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Check that ENV_FILE points to a valid .env.')
  process.exit(1)
}

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const morgan = require('morgan')
const path = require('path')
const { initDatabase } = require('./config/database')
const errorHandler = require('./middleware/errorHandler')

const app = express()
const PORT = process.env.PORT || 5174

app.use(helmet({
  contentSecurityPolicy: false,         // SPA with inline styles; CSP needs its own pass
  crossOriginEmbedderPolicy: false,
}))

// Reflect any origin when FRONTEND_URL unset (Docker/LAN access). Set FRONTEND_URL to lock down.
app.use(cors({ origin: process.env.FRONTEND_URL || true }))
app.use(express.json())
app.use(morgan('dev'))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version, timestamp: new Date().toISOString() })
})

app.use('/api/auth', require('./routes/auth'))
app.use('/api/devices', require('./routes/devices'))
app.use('/api/devices/:id/control', require('./routes/control'))
app.use('/api/devices/:id/machines', require('./routes/machines'))
app.use('/api/alerts', require('./routes/alerts'))
app.use('/api/users', require('./routes/users'))
app.use('/api/metrics', require('./routes/metrics'))
app.use('/api/settings', require('./routes/settings'))
app.use('/api/agents', require('./routes/agents'))
app.use('/api/system', require('./routes/system'))

// Serve install-agent.sh and agent bundle for bootstrapped installs
const fs = require('fs')
app.get('/install-agent.sh', (req, res) => {
  const scriptPath = path.resolve(__dirname, '../install-agent.sh')
  if (!fs.existsSync(scriptPath)) return res.status(404).type('text/plain').send('# Not found')
  res.type('text/plain').sendFile(scriptPath)
})
app.get('/install-agent.tar.gz', (req, res) => {
  const tarPath = '/install-agent.tar.gz'
  if (!fs.existsSync(tarPath)) return res.status(404).type('text/plain').send('# Not found')
  res.type('application/gzip').sendFile(tarPath)
})

// Serve built React frontend in production (Electron or standalone)
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../frontend/dist')
  app.use(express.static(frontendDist))
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

app.use(errorHandler)

async function start() {
  await initDatabase()

  const server = app.listen(PORT, () => {
    console.log(`Flux backend running on port ${PORT}`)
  })

  // Attach WebSocket hub for agent connections
  const agentHub = require('./services/agentHub')
  agentHub.attach(server)

  // Agent update check: run once on boot, then every 6 hours
  const agentUpdateService = require('./services/agentUpdateService')
  agentUpdateService.checkAndNotify()
  setInterval(() => agentUpdateService.checkAndNotify(), 6 * 60 * 60 * 1000)

  // Detect this server's own deployment profile
  const detectorService = require('./services/detectorService')
  detectorService.detect()

  const pollingService = require('./services/pollingService')
  await pollingService.startPolling()
}

start()
