const { exec } = require('child_process')
const fs = require('fs')

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** Returns true if NUT is installed (service active OR upsc binary present). */
async function isNutInstalled() {
  try {
    await run('systemctl is-active nut-server')
    return true
  } catch {
    try {
      await run('which upsc')
      return true
    } catch {
      return false
    }
  }
}

/** Install NUT via apt-get. Requires root. */
async function installNut() {
  await run('apt-get install -y nut')
}

/**
 * Write /etc/nut/ups.conf.
 * nutConfig: { upsName, driver, port, desc }
 */
function writeUpsConf(nutConfig) {
  const content = [
    `[${nutConfig.upsName}]`,
    `  driver = ${nutConfig.driver}`,
    `  port = ${nutConfig.port || 'auto'}`,
    `  desc = "${nutConfig.desc || 'UPS'}"`,
    '',
  ].join('\n')
  fs.writeFileSync('/etc/nut/ups.conf', content, { mode: 0o640 })
}

/**
 * Write /etc/nut/upsd.conf.
 * nutConfig: { upsdPort }  (default 3493)
 */
function writeUpsdConf(nutConfig) {
  const port = nutConfig.upsdPort || 3493
  const content = [
    'MAXAGE 15',
    `LISTEN 0.0.0.0 ${port}`,
    '',
  ].join('\n')
  fs.writeFileSync('/etc/nut/upsd.conf', content, { mode: 0o640 })
}

/**
 * Write /etc/nut/upsd.users.
 * nutConfig: { upsdUser: { name, password, upsmonPassword } }
 */
function writeUpsdUsers(nutConfig) {
  const u = nutConfig.upsdUser || { name: 'fluxmon', password: 'fluxmon', upsmonPassword: 'fluxmon' }
  const content = [
    `[${u.name}]`,
    `  password = ${u.password}`,
    '  upsmon master',
    '',
    '[upsmon]',
    `  password = ${u.upsmonPassword || u.password}`,
    '  upsmon master',
    '',
  ].join('\n')
  fs.writeFileSync('/etc/nut/upsd.users', content, { mode: 0o640 })
}

/** Restart the nut-server systemd service. */
async function restartNut() {
  await run('systemctl restart nut-server')
}

async function restartServices(upsName) {
  if (upsName) await run(`systemctl restart ${shellQuote(`nut-driver@${upsName}`)}`)
  await restartNut()
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

function nutConfigDir() {
  if (fs.existsSync('/etc/ups')) return '/etc/ups'
  return '/etc/nut'
}

function backupNutConfig(options = {}) {
  const dir = nutConfigDir()
  const backupDir = `${dir}/flux-backup-${options.timestamp || timestamp()}`
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })

  for (const file of ['ups.conf', 'upsd.conf', 'upsd.users', 'upsmon.conf', 'nut.conf']) {
    const src = `${dir}/${file}`
    if (fs.existsSync(src)) fs.copyFileSync(src, `${backupDir}/${file}`)
  }

  return backupDir
}

/**
 * Poll UPS status via upsc.
 * Returns an object of NUT variable names to values, e.g.:
 *   { 'ups.status': 'OL', 'battery.charge': '100', ... }
 */
async function pollStatus(upsName) {
  const output = await run(`upsc ${upsName}`)
  const status = {}
  for (const line of output.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      status[key] = val
    }
  }
  return status
}

async function discoverConfig(options = {}) {
  const runner = options.run || run
  const output = await runner('upsc -l')
  const first = output.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(':')[0].trim())
    .find(Boolean)

  if (!first) throw new Error('No local NUT UPS found')
  return { upsName: first, sourceType: 'usb' }
}

async function commandOk(cmd, runner = run) {
  try {
    await runner(cmd)
    return true
  } catch {
    return false
  }
}

function normalizeUsbId(value) {
  return String(value || '').trim().toLowerCase()
}

function usbDeviceLabel(nutConfig, status = {}) {
  const vendorid = normalizeUsbId(
    nutConfig.vendorid || nutConfig.vendorId || status['driver.parameter.vendorid'] || status['ups.vendorid']
  )
  const productid = normalizeUsbId(
    nutConfig.productid || nutConfig.productId || status['driver.parameter.productid'] || status['ups.productid']
  )
  if (vendorid && productid) return `${vendorid}:${productid}`
  if (vendorid) return vendorid
  return ''
}

async function checkHealth(nutConfig, options = {}) {
  const runner = options.run || run
  const now = options.now || (() => new Date())
  const sourceType = nutConfig?.sourceType || (nutConfig?.driver === 'snmp-ups' ? 'snmp' : 'usb')
  const checkedAt = now().toISOString()
  const checks = {
    upscReachable: false,
    nutServerActive: false,
    nutDriverActive: false,
  }

  let pollError = null
  let status = {}
  try {
    status = await pollStatusWithRunner(nutConfig.upsName, runner)
    checks.upscReachable = true
  } catch (err) {
    pollError = err
  }

  checks.nutServerActive = await commandOk('systemctl is-active --quiet nut-server', runner)

  if (nutConfig?.upsName) {
    checks.nutDriverActive = await commandOk(`systemctl is-active --quiet ${shellQuote(`nut-driver@${nutConfig.upsName}`)}`, runner)
  }

  if (sourceType === 'usb') {
    const usbId = usbDeviceLabel(nutConfig, status)
    if (usbId) {
      checks.usbDevicePresent = await commandOk(`lsusb -d ${shellQuote(usbId.includes(':') ? usbId : `${usbId}:`)}`, runner)
    } else {
      checks.usbDevicePresent = null
    }

    if (!checks.upscReachable) {
      return {
        state: 'error',
        sourceType,
        message: `NUT polling failed: ${pollError.message}`,
        checkedAt,
        checks,
      }
    }

    if (checks.usbDevicePresent === false) {
      return {
        state: 'degraded',
        sourceType,
        message: `USB UPS device ${usbId} is not visible on this host`,
        checkedAt,
        checks,
      }
    }

    return {
      state: 'ok',
      sourceType,
      message: 'USB data source healthy',
      checkedAt,
      checks,
    }
  }

  if (!checks.upscReachable) {
    return {
      state: 'error',
      sourceType,
      message: `NUT polling failed: ${pollError.message}`,
      checkedAt,
      checks,
    }
  }

  return {
    state: 'ok',
    sourceType,
    message: `${sourceType.toUpperCase()} data source healthy`,
    checkedAt,
    checks,
  }
}

async function pollStatusWithRunner(upsName, runner) {
  const output = await runner(`upsc ${shellQuote(upsName)}`)
  const status = {}
  for (const line of output.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      status[key] = val
    }
  }
  return status
}

/**
 * Full NUT setup: install if missing, write all config files, restart service.
 * nutConfig: { upsName, driver, port, desc, upsdPort, upsdUser }
 */
async function setup(nutConfig) {
  const installed = await isNutInstalled()
  if (!installed) await installNut()
  writeUpsConf(nutConfig)
  writeUpsdConf(nutConfig)
  writeUpsdUsers(nutConfig)
  await restartNut()
}

async function applyManagedConfig(nutConfig, options = {}) {
  if (!nutConfig || nutConfig.managedByFlux !== true) {
    return { applied: false, reason: 'not-managed' }
  }

  const backupDir = backupNutConfig(options)
  await setup(nutConfig)
  return { applied: true, backupDir }
}

module.exports = {
  isNutInstalled,
  installNut,
  writeUpsConf,
  writeUpsdConf,
  writeUpsdUsers,
  restartNut,
  restartServices,
  backupNutConfig,
  pollStatus,
  discoverConfig,
  checkHealth,
  setup,
  applyManagedConfig,
}
