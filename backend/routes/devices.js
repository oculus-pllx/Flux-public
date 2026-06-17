const crypto = require('crypto')
const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const Device = require('../models/Device')
const pollingService = require('../services/pollingService')
const {
  assertHost,
  assertIntegerRange,
  assertNoControl,
  assertNutSecret,
  assertNutToken,
} = require('../utils/validation')

router.use(authenticate)

function sanitizeDevice(device) {
  const obj = device.toJSON()
  delete obj.nutPassword
  obj.hasNutCredentials = Boolean(device.nutUsername && device.nutPassword)
  return obj
}

function devicePayload(body, { preserveBlankPassword = false } = {}) {
  const allowed = [
    'name', 'host', 'port', 'upsName', 'groupId', 'pollInterval',
    'nutUsername', 'nutPassword', 'active',
  ]
  const payload = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key]
  }
  if (preserveBlankPassword && payload.nutPassword === '') delete payload.nutPassword

  if (payload.name !== undefined) assertNoControl(payload.name, 'Device name')
  if (payload.host !== undefined) assertHost(payload.host, 'Device host')
  if (payload.port !== undefined) payload.port = assertIntegerRange(payload.port, 'NUT port', 1, 65535)
  if (payload.upsName !== undefined) assertNutToken(payload.upsName, 'UPS name')
  if (payload.pollInterval !== undefined) payload.pollInterval = assertIntegerRange(payload.pollInterval, 'Poll interval', 5, 3600)
  if (payload.nutUsername !== undefined) assertNutSecret(payload.nutUsername, 'NUT username')
  if (payload.nutPassword !== undefined) assertNutSecret(payload.nutPassword, 'NUT password')
  return payload
}

router.get('/', async (req, res, next) => {
  try {
    const devices = await Device.findAll()
    res.json(devices.map(sanitizeDevice))
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    res.json(sanitizeDevice(device))
  } catch (err) { next(err) }
})

function sshMachineFromBody(body) {
  const { host, sshPort, sshUser, sshAuthType, sshPassword, sshKeyPath, sshKeyContent } = body
  return { host, sshPort: sshPort || 22, sshUser: sshUser || 'root', sshAuthType, sshPassword, sshKeyPath, sshKeyContent }
}

// Read NUT config from a remote host over SSH. Throws a 422 error with
// `payload.nutMissing` when no UPS is found so callers can offer an install.
async function discoverNut(machine) {
  const sshService = require('../services/sshService')

  const NUT_DIRS = '/etc/nut /etc/ups /usr/local/etc/nut'
  const [namesRaw, upsdConf, upsdUsers, nutCheck] = await Promise.all([
    sshService.runCommand(machine, `upsc -l 2>/dev/null; for d in ${NUT_DIRS}; do [ -f "$d/ups.conf" ] && grep -oE '^\\[[^]]+\\]' "$d/ups.conf" 2>/dev/null | tr -d '[]'; done; true`),
    sshService.runCommand(machine, `for d in ${NUT_DIRS}; do [ -f "$d/upsd.conf" ] && cat "$d/upsd.conf" 2>/dev/null && break; done; true`),
    sshService.runCommand(machine, `for d in ${NUT_DIRS}; do [ -f "$d/upsd.users" ] && cat "$d/upsd.users" 2>/dev/null && break; done; true`),
    sshService.runCommand(machine, `(command -v upsd || command -v upsc || command -v upsdrvctl) >/dev/null 2>&1 && echo FLUX_NUT_PRESENT || echo FLUX_NUT_MISSING`),
  ])

  const upsNames = [...new Set(namesRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))]
  if (upsNames.length === 0) {
    const nutMissing = nutCheck.includes('FLUX_NUT_MISSING')
    const err = new Error(nutMissing
      ? 'NUT is not installed on this host. Flux can install and configure it over SSH.'
      : 'No UPS found. Tried upsc -l and ups.conf in /etc/nut, /etc/ups, /usr/local/etc/nut. Is the NUT service running?')
    err.status = 422
    err.payload = { nutMissing }
    throw err
  }

  // LISTEN address from upsd.conf — prefer concrete non-loopback, fall back to SSH host.
  // Wildcard binds are not connectable remote endpoints.
  let nutHost = machine.host
  let nutPort = 3493
  for (const line of upsdConf.split('\n')) {
    const m = line.trim().match(/^LISTEN\s+(\S+)\s+(\d+)/)
    if (m && !['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::'].includes(m[1])) {
      nutHost = m[1]; nutPort = Number(m[2]); break
    }
    if (m) nutPort = Number(m[2])
  }

  // Monitor user from upsd.users — find user with upsmon master/slave/primary/secondary
  let nutUsername = null, nutPassword = null
  let curUser = null, curPass = null, curMonitor = false
  for (const line of upsdUsers.split('\n')) {
    const sec = line.match(/^\[(\w+)\]/)
    if (sec) {
      if (curUser && curMonitor) { nutUsername = curUser; nutPassword = curPass; break }
      curUser = sec[1]; curPass = null; curMonitor = false
    } else if (curUser) {
      const pw = line.match(/^\s*password\s*=\s*(.+)/); if (pw) curPass = pw[1].trim()
      if (/upsmon\s+(master|slave|primary|secondary)/i.test(line)) curMonitor = true
    }
  }
  if (curUser && curMonitor && !nutUsername) { nutUsername = curUser; nutPassword = curPass }

  return { upsNames, nutHost, nutPort, nutUsername, nutPassword }
}

// Discover NUT config on a remote host via SSH
router.post('/discover-nut', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    res.json(await discoverNut(sshMachineFromBody(req.body)))
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message, ...(err.payload || {}) })
    next(err)
  }
})

// Install + configure a NUT server on the host the UPS is attached to,
// then discover the resulting config
router.post('/install-nut', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = sshMachineFromBody(req.body)
    const sshService = require('../services/sshService')
    const nutUsername = 'fluxmon'
    const nutPassword = crypto.randomBytes(16).toString('hex')
    await sshService.installNutServer(machine, { nutUsername, nutPassword })

    try {
      const discovered = await discoverNut(machine)
      res.json({ ...discovered, nutUsername, nutPassword, installed: true })
    } catch (err) {
      if (err.status === 422) {
        return res.status(422).json({
          error: 'NUT was installed and configured, but no UPS was detected. Check the USB/serial connection, then run Discover again.',
          installed: true,
        })
      }
      throw err
    }
  } catch (err) { next(err) }
})

router.post('/', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.create(devicePayload(req.body))
    pollingService.scheduleDevice(device)
    res.status(201).json(sanitizeDevice(device))
  } catch (err) { next(err) }
})

router.put('/:id', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    await device.update(devicePayload(req.body, { preserveBlankPassword: true }))
    pollingService.scheduleDevice(device)
    res.json(sanitizeDevice(device))
  } catch (err) { next(err) }
})

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    pollingService.stopDevice(device.id)
    await device.destroy()
    res.status(204).send()
  } catch (err) { next(err) }
})

router.post('/:id/poll', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    const nutService = require('../services/nutService')
    const data = await nutService.pollDevice(
      device.host,
      device.port,
      device.upsName,
      device.nutUsername,
      device.nutPassword
    )
    await device.update({ lastSeen: new Date(), lastStatus: data })
    res.json({ ok: true, data })
  } catch (err) { next(err) }
})

module.exports = router
