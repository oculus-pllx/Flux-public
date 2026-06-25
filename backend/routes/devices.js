const crypto = require('crypto')
const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const Device = require('../models/Device')
const AgentMachine = require('../models/AgentMachine')
const pollingService = require('../services/pollingService')
const {
  assertHost,
  assertIntegerRange,
  assertNoControl,
  assertNutSecret,
  assertNutToken,
  badRequest,
} = require('../utils/validation')

router.use(authenticate)

const DEVICE_ORDER = [['displayOrder', 'ASC'], ['name', 'ASC'], ['id', 'ASC']]

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
    const devices = await Device.findAll({ order: DEVICE_ORDER })
    res.json(devices.map(sanitizeDevice))
  } catch (err) { next(err) }
})

router.put('/order', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const ids = req.body.deviceIds
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'deviceIds must be a non-empty array' })
    }

    const deviceIds = ids.map(id => Number(id))
    if (deviceIds.some(id => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'deviceIds must contain only positive integer IDs' })
    }
    if (new Set(deviceIds).size !== deviceIds.length) {
      return res.status(400).json({ error: 'deviceIds must not contain duplicates' })
    }

    const devices = await Device.findAll({ where: { id: deviceIds } })
    if (devices.length !== deviceIds.length) {
      return res.status(404).json({ error: 'One or more devices were not found' })
    }

    await Promise.all(deviceIds.map((id, index) =>
      Device.update({ displayOrder: index + 1 }, { where: { id } })
    ))

    const ordered = await Device.findAll({ order: DEVICE_ORDER })
    res.json({ ok: true, devices: ordered.map(sanitizeDevice) })
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

function upsIdentity(status = {}) {
  return {
    model: status['ups.model'] || status['device.model'] || null,
    serial: status['ups.serial'] || status['device.serial'] || null,
    manufacturer: status['ups.mfr'] || status['device.mfr'] || null,
    firmware: status['ups.firmware'] || null,
  }
}

function variableSummary(before = {}, after = {}) {
  const beforeKeys = Object.keys(before).sort()
  const afterKeys = Object.keys(after).sort()
  const beforeSet = new Set(beforeKeys)
  const afterSet = new Set(afterKeys)
  return {
    count: afterKeys.length,
    keys: afterKeys,
    added: afterKeys.filter(key => !beforeSet.has(key)),
    removed: beforeKeys.filter(key => !afterSet.has(key)),
    categories: afterKeys.reduce((acc, key) => {
      const category = key.includes('.') ? key.split('.')[0] : 'other'
      acc[category] = (acc[category] || 0) + 1
      return acc
    }, {}),
  }
}

// Read NUT config from a remote host over SSH. A live `upsc -l` result is
// required for success; static ups.conf stanzas are diagnostics only.
async function discoverNut(machine) {
  const sshService = require('../services/sshService')

  const NUT_DIRS = '/etc/nut /etc/ups /usr/local/etc/nut'
  const parseUpsNames = raw => [...new Set(String(raw || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))]
  const [liveNamesRaw, configNamesRaw, upsdConf, upsdUsers, nutCheck, usbCheck] = await Promise.all([
    sshService.runCommand(machine, `upsc -l 2>/dev/null || true`),
    sshService.runCommand(machine, `for d in ${NUT_DIRS}; do [ -f "$d/ups.conf" ] && grep -oE '^\\[[^]]+\\]' "$d/ups.conf" 2>/dev/null | tr -d '[]'; done; true`),
    sshService.runCommand(machine, `for d in ${NUT_DIRS}; do [ -f "$d/upsd.conf" ] && cat "$d/upsd.conf" 2>/dev/null && break; done; true`),
    sshService.runCommand(machine, `for d in ${NUT_DIRS}; do [ -f "$d/upsd.users" ] && cat "$d/upsd.users" 2>/dev/null && break; done; true`),
    sshService.runCommand(machine, `(command -v upsd || command -v upsc || command -v upsdrvctl) >/dev/null 2>&1 && echo FLUX_NUT_PRESENT || echo FLUX_NUT_MISSING`),
    sshService.runCommand(machine, `lsusb 2>/dev/null | grep -Eiq '(051d|0463|09ae|0764|050d)' && echo FLUX_USB_UPS_PRESENT || echo FLUX_USB_UPS_MISSING`),
  ])

  const upsNames = parseUpsNames(liveNamesRaw)
  if (upsNames.length === 0) {
    const nutMissing = nutCheck.includes('FLUX_NUT_MISSING')
    const upsPhysicalPresent = usbCheck.includes('FLUX_USB_UPS_PRESENT')
    const repairable = !nutMissing && upsPhysicalPresent
    const err = new Error(nutMissing
      ? 'NUT is not installed on this host. Flux can install and configure it over SSH.'
      : repairable
        ? 'NUT is installed but not serving the connected UPS. Flux can configure or repair NUT on this host.'
        : 'No live UPS found from upsc -l. Is a UPS connected and is the NUT service running?')
    err.status = 422
    err.payload = {
      nutMissing,
      repairable,
      upsPhysicalPresent,
      configuredUpsNames: parseUpsNames(configNamesRaw),
    }
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

router.post('/:id/configure-nut', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })

    const machine = sshMachineFromBody(req.body)
    const sshService = require('../services/sshService')
    const nutUsername = req.body.nutUsername || device.nutUsername || 'fluxmon'
    const nutPassword = req.body.nutPassword || crypto.randomBytes(16).toString('hex')
    assertNutToken(nutUsername, 'NUT username')
    assertNutSecret(nutPassword, 'NUT password')

    await sshService.installNutServer(machine, { nutUsername, nutPassword })
    const discovered = await discoverNut(machine)
    const upsName = discovered.upsNames.includes(device.upsName)
      ? device.upsName
      : (discovered.upsNames[0] || device.upsName)
    const update = {
      host: discovered.nutHost,
      port: discovered.nutPort,
      upsName,
      nutUsername,
      nutPassword,
    }

    try {
      const nutService = require('../services/nutService')
      update.lastStatus = await nutService.pollDevice(
        update.host,
        update.port,
        update.upsName,
        update.nutUsername,
        update.nutPassword
      )
      update.lastSeen = new Date()
    } catch {}

    await device.update(update)
    pollingService.scheduleDevice(device)
    res.json({ device: sanitizeDevice(device), discovered, nutUsername, configured: true })
  } catch (err) { next(err) }
})

function sourcePayload(body, device) {
  const sourceType = body.sourceType || 'usb'
  if (!['usb', 'snmp'].includes(sourceType)) throw badRequest('NUT source type must be usb or snmp')
  const source = {
    sourceType,
    upsName: body.upsName || device.upsName,
  }
  assertNutToken(source.upsName, 'UPS name')

  if (sourceType === 'usb') {
    source.port = body.sourcePort || body.usbPort || 'auto'
    assertNutToken(source.port, 'USB port')
    if (body.vendorid) {
      assertNutToken(body.vendorid, 'USB vendor ID')
      source.vendorid = body.vendorid
    }
    if (body.productid) {
      assertNutToken(body.productid, 'USB product ID')
      source.productid = body.productid
    }
    return source
  }

  source.snmpHost = body.snmpHost
  assertHost(source.snmpHost, 'SNMP host')
  source.snmpVersion = body.snmpVersion || 'v1'
  if (!['v1', 'v2c'].includes(source.snmpVersion)) throw badRequest('SNMP version must be v1 or v2c')
  source.community = body.community || 'public'
  assertNutSecret(source.community, 'SNMP community')
  source.mibs = body.mibs || 'apcc'
  assertNutToken(source.mibs, 'SNMP MIB')
  return source
}

router.post('/:id/source', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })

    const machine = sshMachineFromBody(req.body)
    const source = sourcePayload(req.body, device)
    const sshService = require('../services/sshService')
    await sshService.configureNutSource(machine, source)

    const discovered = await discoverNut(machine)
    const upsName = discovered.upsNames.includes(source.upsName)
      ? source.upsName
      : (discovered.upsNames[0] || source.upsName)
    const update = {
      host: discovered.nutHost,
      port: discovered.nutPort,
      upsName,
    }

    try {
      const nutService = require('../services/nutService')
      update.lastStatus = await nutService.pollDevice(
        update.host,
        update.port,
        update.upsName,
        device.nutUsername,
        device.nutPassword
      )
      update.lastSeen = new Date()
    } catch {}

    await device.update(update)
    pollingService.scheduleDevice(device)
    res.json({ configured: true, sourceType: source.sourceType, device: sanitizeDevice(device), discovered })
  } catch (err) { next(err) }
})

router.post('/:id/reprobe', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })

    const agents = await AgentMachine.findAll({
      where: { upsGroupId: device.id, active: true },
      order: [['updatedAt', 'DESC']],
    })
    const agent = agents.find(machine => ['ups-host', 'both'].includes(machine.role) && machine.machineKey)
    if (!agent || !['ups-host', 'both'].includes(agent.role) || !agent.machineKey) {
      return res.status(409).json({ error: 'No linked UPS-host agent is available for reprobe.' })
    }

    const agentHub = require('../services/agentHub')
    const response = await agentHub.requestMachine(agent.machineKey, {
      type: 'nut-reprobe',
      deviceId: device.id,
      upsName: device.upsName,
    }, { timeoutMs: 45000 })

    if (!response.ok) {
      return res.status(502).json({ error: response.error || 'UPS reprobe failed' })
    }

    const before = device.lastStatus || {}
    const after = response.upsVars || {}
    const afterIdentity = upsIdentity(after)
    const update = {
      lastStatus: after,
      lastSeen: new Date(),
      nutHealth: response.nutHealth || null,
    }
    if (afterIdentity.model) update.name = afterIdentity.model
    await device.update(update)
    pollingService.scheduleDevice(device)

    res.json({
      ok: true,
      restarted: response.restarted === true,
      identity: {
        before: upsIdentity(before),
        after: afterIdentity,
      },
      variables: variableSummary(before, after),
      device: sanitizeDevice(device),
    })
  } catch (err) {
    if (err.message === 'Agent not connected' || err.message === 'Agent response timed out') {
      return res.status(409).json({ error: err.message })
    }
    next(err)
  }
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
