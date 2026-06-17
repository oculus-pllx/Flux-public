const { execSync } = require('child_process')
const os = require('os')

function isWin() { return process.platform === 'win32' }

function detectVirtualization() {
  if (isWin()) {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-WmiObject Win32_ComputerSystem).Model"',
        { timeout: 5000, stdio: 'pipe' }
      ).toString().trim().toLowerCase()
      if (out.includes('virtual')) return 'kvm'
      const mfr = execSync(
        'powershell -NoProfile -Command "(Get-WmiObject Win32_ComputerSystem).Manufacturer"',
        { timeout: 5000, stdio: 'pipe' }
      ).toString().trim().toLowerCase()
      if (['qemu', 'vmware', 'microsoft'].some(v => mfr.includes(v))) return 'kvm'
      return 'none'
    } catch { return 'none' }
  }
  try {
    return execSync('systemd-detect-virt 2>/dev/null', { timeout: 3000, stdio: 'pipe' }).toString().trim()
  } catch { return 'none' }
}

function detectRole() {
  if (isWin()) return 'controlled'

  const checks = [
    { cmd: 'dpkg -l pve-manager 2>/dev/null | grep -q "^ii"', role: 'pve-node' },
    { cmd: 'dpkg -l proxmox-backup-server 2>/dev/null | grep -q "^ii"', role: 'pbs' },
    { cmd: 'systemctl is-active --quiet nut-server 2>/dev/null', role: 'ups-host' },
  ]
  for (const { cmd, role } of checks) {
    try { execSync(cmd, { timeout: 3000, stdio: 'pipe' }); return role } catch {}
  }
  return 'controlled'
}

function detectOS() {
  try {
    if (isWin()) {
      return execSync('powershell -NoProfile -Command "(Get-WmiObject Win32_OperatingSystem).Caption"',
        { timeout: 5000, stdio: 'pipe' }).toString().trim()
    }
    return execSync('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'',
      { timeout: 3000, stdio: 'pipe' }).toString().trim()
  } catch {
    return os.type()
  }
}

module.exports = {
  detectVirtualization,
  detectRole,
  detectOS,
  get isWindows() { return isWin() },
}
