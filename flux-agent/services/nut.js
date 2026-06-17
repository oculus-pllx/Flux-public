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
  backupNutConfig,
  pollStatus,
  setup,
  applyManagedConfig,
}
