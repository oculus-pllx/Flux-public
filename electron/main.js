const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

const PORT = 5174
const isDev = !app.isPackaged

let mainWindow = null
let tray = null
let serverStarted = false
let healthInterval = null

function makeTrayIcon(state) {
  const names = { running: 'icon-running.png', stopped: 'icon-stopped.png', unknown: 'icon.png' }
  const iconPath = path.join(__dirname, 'assets', names[state] || 'icon.png')
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath)
  const colors = { running: [34, 197, 94], stopped: [220, 38, 38], unknown: [99, 102, 241] }
  const [r, g, b] = colors[state] || colors.unknown
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function buildTrayMenu(serviceRunning) {
  if (isDev) {
    return Menu.buildFromTemplate([
      { label: 'Open Flux', click: () => { mainWindow?.show(); mainWindow?.focus() } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
    ])
  }
  return Menu.buildFromTemplate([
    { label: 'Open Flux', click: () => shell.openExternal(`http://localhost:${PORT}`) },
    { type: 'separator' },
    serviceRunning
      ? { label: 'Stop Service', click: () => exec('net stop FluxUPS') }
      : { label: 'Start Service', click: () => exec('net start FluxUPS') },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ])
}

function updateTrayState(state) {
  if (!tray) return
  tray.setImage(makeTrayIcon(state))
  tray.setToolTip(`Flux UPS Monitor — ${state}`)
  tray.setContextMenu(buildTrayMenu(state === 'running'))
}

function startHealthPolling() {
  const poll = () => {
    const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
      updateTrayState(res.statusCode === 200 ? 'running' : 'stopped')
    })
    req.on('error', () => updateTrayState('stopped'))
    req.setTimeout(2000, () => { req.destroy(); updateTrayState('stopped') })
  }
  poll()
  healthInterval = setInterval(poll, 5000)
}

function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const check = () => {
      const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(500, () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (++attempts >= retries) return reject(new Error('Backend failed to start'))
      setTimeout(check, 500)
    }
    check()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Flux',
    backgroundColor: '#0f1117',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  mainWindow.loadURL('http://localhost:7483')
  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
}

function createTray() {
  tray = new Tray(makeTrayIcon('unknown'))
  tray.setToolTip('Flux UPS Monitor')
  tray.setContextMenu(buildTrayMenu(false))
  if (isDev) {
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
  } else {
    tray.on('double-click', () => shell.openExternal(`http://localhost:${PORT}`))
  }
}

app.whenReady().then(async () => {
  createTray()

  if (isDev) {
    if (!serverStarted) {
      serverStarted = true
      require('../backend/server')
      await waitForServer().catch((err) => console.error('Backend failed to start:', err.message))
    }
    createWindow()
    updateTrayState('running')
  } else {
    startHealthPolling()
  }

  app.on('activate', () => {
    if (isDev && BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (healthInterval) clearInterval(healthInterval)
})
