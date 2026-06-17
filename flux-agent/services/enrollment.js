const fs = require('fs')
const path = require('path')

let CONFIG_PATH = process.platform === 'win32'
  ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'FluxAgent', 'config.json')
  : '/etc/flux-agent/config.json'

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function getMachineKey() {
  return getConfig().machineKey || null
}

function isEnrolled() {
  const cfg = getConfig()
  return Boolean(cfg.machineKey && cfg.fluxUrl)
}

module.exports = {
  get CONFIG_PATH() { return CONFIG_PATH },
  set CONFIG_PATH(v) { CONFIG_PATH = v },
  getConfig,
  saveConfig,
  getMachineKey,
  isEnrolled
}
