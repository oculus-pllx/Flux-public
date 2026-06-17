const { execSync } = require('child_process')
const fs = require('fs')
const Setting = require('../models/Setting')

function probe(cmd) {
  try { execSync(cmd, { timeout: 3000, stdio: 'pipe' }); return true } catch { return false }
}

function classify({ dockerenv, virt, pveManager, pbs, nutServer }) {
  if (pbs) return 'pbs'
  if (pveManager) return 'pve-node'
  if (dockerenv && virt === 'kvm') return 'docker-on-pve-vm'
  if (virt === 'kvm' || virt === 'qemu' || virt === 'lxc') return 'vm-on-pve'
  return 'physical'
}

async function detect() {
  try {
    const existing = await Setting.findOne({ where: { key: 'deployment_profile' } })
    if (existing && existing.value) return // already set, respect the saved value

    const dockerenv = fs.existsSync('/.dockerenv')
    let virt = 'none'
    try { virt = execSync('systemd-detect-virt 2>/dev/null', { timeout: 3000 }).toString().trim() } catch {}
    const pveManager = probe('dpkg -l pve-manager 2>/dev/null | grep -q "^ii"')
    const pbs = probe('dpkg -l proxmox-backup-server 2>/dev/null | grep -q "^ii"')
    const nutServer = probe('systemctl is-active --quiet nut-server 2>/dev/null')

    const profile = classify({ dockerenv, virt, pveManager, pbs, nutServer })
    await Setting.upsert({ key: 'deployment_profile', value: profile })
    console.log(`[detector] Deployment profile: ${profile}`)
  } catch (err) {
    console.warn('[detector] Self-detection failed:', err.message)
  }
}

module.exports = { detect, classify }
