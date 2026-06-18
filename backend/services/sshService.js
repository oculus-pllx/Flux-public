const { Client } = require('ssh2')
const crypto = require('crypto')
const fs   = require('fs')
const path = require('path')
const {
  assertHost,
  assertIntegerRange,
  assertNoControl,
  assertNutSecret,
  assertNutToken,
  escapeUpsmonQuoted,
  shellQuote,
} = require('../utils/validation')

function readKeyFileSafe(keyPath) {
  const allowedDir = process.env.SSH_KEY_DIR || ''
  if (!allowedDir) {
    return new Error('SSH key files are disabled. Set SSH_KEY_DIR or use key content instead.')
  }
  const resolved  = path.resolve(keyPath)
  const allowedAbs = path.resolve(allowedDir)
  if (resolved !== allowedAbs && !resolved.startsWith(allowedAbs + path.sep)) {
    return new Error(`SSH key path is outside the allowed directory (${allowedDir})`)
  }
  try {
    return fs.readFileSync(resolved)
  } catch {
    return new Error(`Cannot read key file: ${keyPath}`)
  }
}

function hostKeyFingerprint(key) {
  const raw = Buffer.isBuffer(key) ? key : (key && key.data) || Buffer.from(String(key))
  return 'SHA256:' + crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')
}

// Trust-on-first-use: pin the host key fingerprint on first connect, reject
// any later connection presenting a different key. Plain objects (wizard
// pre-save probes) verify TOFU-style but are never persisted.
function makeHostVerifier(machine) {
  const seen = { fp: null, mismatch: false }
  const hostVerifier = (key) => {
    seen.fp = hostKeyFingerprint(key)
    if (machine.sshHostKey && machine.sshHostKey !== seen.fp) {
      seen.mismatch = true
      return false
    }
    return true
  }
  return { seen, hostVerifier }
}

function pinHostKey(machine, seen) {
  if (!machine.sshHostKey && seen.fp && typeof machine.update === 'function') {
    machine.update({ sshHostKey: seen.fp }).catch(() => {})
  }
}

function hostKeyError(machine, seen, err) {
  if (!seen.mismatch) return err
  return new Error(
    `Host key for ${machine.host} changed (expected ${machine.sshHostKey}, got ${seen.fp}). ` +
    'If the machine was reinstalled, reset its trusted host key.')
}

function runCommand(machine, command) {
  assertHost(machine.host, 'Machine host')
  const sshPort = assertIntegerRange(machine.sshPort || 22, 'SSH port', 1, 65535)
  assertNoControl(machine.sshUser || 'root', 'SSH user')
  // Scripts are multi-line by design; only NUL is forbidden. User-supplied
  // fragments are individually validated/quoted before they reach here.
  if (typeof command !== 'string' || command.includes('\0')) {
    throw new Error('SSH command must be a string without NUL bytes')
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let output = ''

    const authOpts = {
      host:     machine.host,
      port:     sshPort,
      username: machine.sshUser || 'root',
    }

    if (machine.sshAuthType === 'key') {
      if (machine.sshKeyContent) {
        authOpts.privateKey = Buffer.from(machine.sshKeyContent)
      } else if (machine.sshKeyPath) {
        const keyBuf = readKeyFileSafe(machine.sshKeyPath)
        if (keyBuf instanceof Error) return reject(keyBuf)
        authOpts.privateKey = keyBuf
      } else {
        return reject(new Error('Key auth requested but no sshKeyContent or sshKeyPath provided'))
      }
    } else {
      authOpts.password = machine.sshPassword || ''
    }

    const { seen, hostVerifier } = makeHostVerifier(machine)

    conn.on('ready', () => {
      pinHostKey(machine, seen)
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('close', () => { conn.end(); resolve(output.trim()) })
        stream.on('data', d => { output += d.toString() })
        stream.stderr.on('data', d => { output += d.toString() })
      })
    })

    conn.on('error', err => reject(hostKeyError(machine, seen, err)))
    conn.connect({ ...authOpts, hostVerifier, readyTimeout: 8000 })
  })
}

async function shutdown(machine) {
  return runCommand(machine, machine.shutdownCommand || 'sudo shutdown -h now')
}

async function testConnection(machine) {
  return runCommand(machine, 'echo ok')
}

async function deployNutMonitor(machine, { nutHost, nutPort, upsName, nutUsername, nutPassword }) {
  assertHost(nutHost, 'NUT host')
  nutPort = assertIntegerRange(nutPort || 3493, 'NUT port', 1, 65535)
  assertNutToken(upsName, 'UPS name')
  assertNutSecret(nutUsername, 'NUT username')
  assertNutSecret(nutPassword, 'NUT password')

  const shutdownCmd = escapeUpsmonQuoted(machine.shutdownCommand || 'sudo shutdown -h now')
  const monitor = `MONITOR ${upsName}@${nutHost}:${nutPort} 1 ${nutUsername} ${nutPassword} slave`
  const upsmonLines = [
    monitor,
    'MINSUPPLIES 1',
    `SHUTDOWNCMD "${shutdownCmd}"`,
    'POWERDOWNFLAG /etc/killpower',
    'POLLFREQ 5',
    'POLLFREQALERT 5',
    'HOSTSYNC 15',
    'DEADTIME 15',
    'RUN_AS_USER root',
  ].map(shellQuote).join(' ')

  const script = `set -e
if ! command -v upsmon >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y nut-client
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nut
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nut
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --noconfirm network-ups-tools
  elif command -v apk >/dev/null 2>&1; then
    apk add nut
  else
    echo "ERROR: unsupported package manager" >&2; exit 1
  fi
fi
mkdir -p /etc/nut
echo "MODE=netclient" > /etc/nut/nut.conf
printf '%s\\n' ${upsmonLines} > /etc/nut/upsmon.conf
chmod 640 /etc/nut/upsmon.conf
if systemctl list-unit-files nut-monitor.service >/dev/null 2>&1; then
  systemctl enable nut-monitor && systemctl restart nut-monitor
elif systemctl list-unit-files nut.service >/dev/null 2>&1; then
  systemctl enable nut && systemctl restart nut
else
  upsmon -c reload 2>/dev/null || true
fi
echo "FLUX_DEPLOY_OK"`

  const output = await runCommand(machine, script)
  if (!output.includes('FLUX_DEPLOY_OK')) {
    throw new Error(`Deploy did not complete. Output: ${output}`)
  }
  return output
}

// Install and configure a NUT *server* on the host the UPS is physically
// attached to: packages, ups.conf (auto-detected driver), netserver mode,
// LISTEN on all interfaces, and a monitor user Flux can poll with.
async function installNutServer(machine, { nutUsername, nutPassword }) {
  assertNutToken(nutUsername, 'NUT username')
  assertNutSecret(nutPassword, 'NUT password')
  if (!nutPassword) throw new Error('NUT password is required')
  const user = shellQuote(nutUsername)
  const pass = shellQuote(nutPassword)

  const script = `set -e
if ! command -v upsd >/dev/null 2>&1 && ! command -v upsdrvctl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y nut
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nut
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nut
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --noconfirm network-ups-tools
  elif command -v apk >/dev/null 2>&1; then
    apk add nut
  else
    echo "ERROR: unsupported package manager" >&2; exit 1
  fi
fi
CONF_DIR=/etc/nut
[ -f /etc/ups/ups.conf ] && CONF_DIR=/etc/ups
mkdir -p "$CONF_DIR"
if ! grep -qE '^\\[' "$CONF_DIR/ups.conf" 2>/dev/null; then
  SCAN=""
  if command -v nut-scanner >/dev/null 2>&1; then SCAN=$(nut-scanner -Uq 2>/dev/null || true); fi
  if printf '%s' "$SCAN" | grep -q '^\\['; then
    printf '%s\\n' "$SCAN" | sed '0,/^\\[.*\\]$/s//[ups]/' >> "$CONF_DIR/ups.conf"
  else
    printf '[ups]\\n  driver = usbhid-ups\\n  port = auto\\n' >> "$CONF_DIR/ups.conf"
  fi
fi
if grep -q '^MODE=' "$CONF_DIR/nut.conf" 2>/dev/null; then
  sed -i 's/^MODE=.*/MODE=netserver/' "$CONF_DIR/nut.conf"
else
  echo 'MODE=netserver' >> "$CONF_DIR/nut.conf"
fi
grep -qE '^LISTEN' "$CONF_DIR/upsd.conf" 2>/dev/null || printf 'LISTEN 0.0.0.0 3493\\n' >> "$CONF_DIR/upsd.conf"
touch "$CONF_DIR/upsd.users"
FLUX_NUT_USER=${user}
if grep -qF "[$FLUX_NUT_USER]" "$CONF_DIR/upsd.users"; then
  awk -v u="[$FLUX_NUT_USER]" 'index($0, u) == 1 { skip = 1; next } /^\\[/ { skip = 0 } !skip' \\
    "$CONF_DIR/upsd.users" > "$CONF_DIR/upsd.users.flux" && mv "$CONF_DIR/upsd.users.flux" "$CONF_DIR/upsd.users"
fi
printf '\\n[%s]\\n  password = %s\\n  upsmon primary\\n  actions = SET\\n  instcmds = ALL\\n' "$FLUX_NUT_USER" ${pass} >> "$CONF_DIR/upsd.users"
chmod 640 "$CONF_DIR/upsd.users" 2>/dev/null || true
udevadm trigger 2>/dev/null || true
upsdrvctl start >/dev/null 2>&1 || true
if systemctl list-unit-files nut-server.service >/dev/null 2>&1; then
  systemctl enable nut-server >/dev/null 2>&1 || true
  systemctl restart nut-server
elif systemctl list-unit-files nut.service >/dev/null 2>&1; then
  systemctl enable nut >/dev/null 2>&1 || true
  systemctl restart nut
else
  upsd 2>/dev/null || true
fi
echo "FLUX_NUT_SERVER_OK"`

  const output = await runCommand(machine, script)
  if (!output.includes('FLUX_NUT_SERVER_OK')) {
    throw new Error(`NUT server install did not complete. Output: ${output.slice(-1000)}`)
  }
  return output
}

function nutSourceConfig(source) {
  const sourceType = source.sourceType || 'usb'
  assertNutToken(source.upsName, 'UPS name')

  if (sourceType === 'usb') {
    const port = source.port || 'auto'
    assertNutToken(port, 'USB port')
    const lines = [
      `[${source.upsName}]`,
      '  driver = usbhid-ups',
      `  port = ${port}`,
    ]
    if (source.vendorid) {
      assertNutToken(source.vendorid, 'USB vendor ID')
      lines.push(`  vendorid = ${source.vendorid}`)
    }
    if (source.productid) {
      assertNutToken(source.productid, 'USB product ID')
      lines.push(`  productid = ${source.productid}`)
    }
    lines.push('  desc = "Flux managed USB HID UPS"')
    return { sourceType, config: `${lines.join('\n')}\n` }
  }

  if (sourceType === 'snmp') {
    assertHost(source.snmpHost, 'SNMP host')
    const snmpVersion = source.snmpVersion || 'v1'
    if (!['v1', 'v2c'].includes(snmpVersion)) throw new Error('SNMP version must be v1 or v2c')
    const community = source.community || 'public'
    assertNutSecret(community, 'SNMP community')
    const mibs = source.mibs || 'apcc'
    assertNutToken(mibs, 'SNMP MIB')
    const lines = [
      `[${source.upsName}]`,
      '  driver = snmp-ups',
      `  port = ${source.snmpHost}`,
      `  community = ${community}`,
      `  snmp_version = ${snmpVersion}`,
      `  mibs = ${mibs}`,
      '  desc = "Flux managed APC network UPS"',
    ]
    return { sourceType, config: `${lines.join('\n')}\n` }
  }

  throw new Error('NUT source type must be usb or snmp')
}

async function configureNutSource(machine, source) {
  const { sourceType, config } = nutSourceConfig(source)
  const upsName = shellQuote(source.upsName)

  const script = `set -e
if ! command -v upsd >/dev/null 2>&1 && ! command -v upsdrvctl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y nut
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nut
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nut
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --noconfirm network-ups-tools
  elif command -v apk >/dev/null 2>&1; then
    apk add nut
  else
    echo "ERROR: unsupported package manager" >&2; exit 1
  fi
fi
UPS_NAME=${upsName}
CONF_DIR=/etc/nut
[ -f /etc/ups/ups.conf ] && CONF_DIR=/etc/ups
mkdir -p "$CONF_DIR"
BACKUP_DIR="$CONF_DIR/flux-source-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
for f in ups.conf upsd.conf nut.conf upsd.users; do
  [ -f "$CONF_DIR/$f" ] && cp -p "$CONF_DIR/$f" "$BACKUP_DIR/$f"
done
touch "$CONF_DIR/ups.conf" "$CONF_DIR/upsd.conf" "$CONF_DIR/nut.conf"
awk -v name="$UPS_NAME" '
  $0 == "[" name "]" { skip = 1; next }
  /^\\[/ { skip = 0 }
  !skip { print }
' "$CONF_DIR/ups.conf" > "$CONF_DIR/ups.conf.flux"
cat > "$CONF_DIR/ups.conf.new" <<'FLUX_UPS_STANZA'
${config}FLUX_UPS_STANZA
cat "$CONF_DIR/ups.conf.new" >> "$CONF_DIR/ups.conf.flux"
mv "$CONF_DIR/ups.conf.flux" "$CONF_DIR/ups.conf"
rm -f "$CONF_DIR/ups.conf.new"
if grep -q '^MODE=' "$CONF_DIR/nut.conf" 2>/dev/null; then
  sed -i 's/^MODE=.*/MODE=netserver/' "$CONF_DIR/nut.conf"
else
  echo 'MODE=netserver' >> "$CONF_DIR/nut.conf"
fi
grep -qE '^LISTEN[[:space:]]+' "$CONF_DIR/upsd.conf" 2>/dev/null || printf 'LISTEN 0.0.0.0 3493\\n' >> "$CONF_DIR/upsd.conf"
restart_nut() {
  upsdrvctl stop "$UPS_NAME" >/dev/null 2>&1 || true
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl list-unit-files "nut-driver@$UPS_NAME.service" >/dev/null 2>&1; then
    systemctl enable "nut-driver@$UPS_NAME.service" >/dev/null 2>&1 || true
    systemctl restart "nut-driver@$UPS_NAME.service" >/dev/null 2>&1 || upsdrvctl start "$UPS_NAME" >/dev/null 2>&1 || true
  else
    upsdrvctl start "$UPS_NAME" >/dev/null 2>&1 || true
  fi
  if systemctl list-unit-files nut-server.service >/dev/null 2>&1; then
    systemctl enable nut-server >/dev/null 2>&1 || true
    systemctl restart nut-server
  elif systemctl list-unit-files nut.service >/dev/null 2>&1; then
    systemctl enable nut >/dev/null 2>&1 || true
    systemctl restart nut
  else
    upsd 2>/dev/null || true
  fi
}
rollback_nut() {
  for f in ups.conf upsd.conf nut.conf upsd.users; do
    [ -f "$BACKUP_DIR/$f" ] && cp -p "$BACKUP_DIR/$f" "$CONF_DIR/$f"
  done
  restart_nut >/dev/null 2>&1 || true
}
restart_nut
for i in 1 2 3 4 5 6 7 8 9 10; do
  if upsc "$UPS_NAME" >/dev/null 2>&1; then
    echo "FLUX_NUT_SOURCE_OK"
    exit 0
  fi
  sleep 1
done
rollback_nut
echo "FLUX_NUT_SOURCE_ROLLBACK"
exit 1`

  const output = await runCommand(machine, script)
  if (!output.includes('FLUX_NUT_SOURCE_OK')) {
    throw new Error(`NUT source switch did not complete. Output: ${output.slice(-1000)}`)
  }
  return output
}

async function getNutMonitorStatus(machine) {
  const script = `if systemctl is-active --quiet nut-monitor 2>/dev/null; then
  echo "running:nut-monitor"
elif systemctl is-active --quiet nut 2>/dev/null; then
  echo "running:nut"
elif test -f /etc/nut/upsmon.conf; then
  echo "deployed:service-not-running"
else
  echo "not-deployed"
fi`
  const output = await runCommand(machine, script)
  return output.trim()
}

async function installAgent(machine, { fluxUrl, token, role }, { onOutput } = {}) {
  assertHost(machine.host, 'Machine host')
  assertNoControl(fluxUrl, 'Flux URL')
  assertNoControl(token, 'Enrollment token')

  const lines = [
    'set -e',
    `export FLUX_URL=${shellQuote(fluxUrl)}`,
    `export FLUX_TOKEN=${shellQuote(token)}`,
  ]
  if (role) {
    assertNoControl(role, 'Role')
    lines.push(`export FLUX_ROLE=${shellQuote(role)}`)
  }
  lines.push(`curl -fsSL ${shellQuote(fluxUrl + '/install-agent.sh')} > /tmp/_flux_install.sh`)
  lines.push('bash /tmp/_flux_install.sh')
  lines.push('echo FLUX_INSTALL_OK')

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let output = ''
    const authOpts = {
      host: machine.host,
      port: assertIntegerRange(machine.sshPort || 22, 'SSH port', 1, 65535),
      username: machine.sshUser || 'root',
      readyTimeout: 8000,
    }
    if (machine.sshAuthType === 'key') {
      if (machine.sshKeyContent) {
        authOpts.privateKey = Buffer.from(machine.sshKeyContent)
      } else if (machine.sshKeyPath) {
        const keyBuf = readKeyFileSafe(machine.sshKeyPath)
        if (keyBuf instanceof Error) return reject(keyBuf)
        authOpts.privateKey = keyBuf
      } else {
        return reject(new Error('Key auth requested but no sshKeyContent or sshKeyPath provided'))
      }
    } else {
      authOpts.password = machine.sshPassword || ''
    }
    const { seen, hostVerifier } = makeHostVerifier(machine)
    conn.on('ready', () => {
      pinHostKey(machine, seen)
      conn.exec(lines.join('\n'), (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('close', () => {
          conn.end()
          if (!output.includes('FLUX_INSTALL_OK'))
            reject(new Error(`Install did not complete. Output: ${output.slice(-500)}`))
          else
            resolve(output)
        })
        const handleData = (data) => {
          const text = data.toString()
          output += text
          if (onOutput) onOutput(text)
        }
        stream.on('data', handleData)
        stream.stderr.on('data', handleData)
      })
    })
    conn.on('error', err => reject(hostKeyError(machine, seen, err)))
    conn.connect({ ...authOpts, hostVerifier })
  })
}

module.exports = { shutdown, testConnection, runCommand, deployNutMonitor, installNutServer, configureNutSource, getNutMonitorStatus, installAgent, readKeyFileSafe }
