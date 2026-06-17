const crypto            = require('crypto')
const router = require('express').Router({ mergeParams: true })
const { authenticate, requireRole } = require('../middleware/auth')
const ConnectedMachine = require('../models/ConnectedMachine')
const AgentMachine      = require('../models/AgentMachine')
const Device            = require('../models/Device')
const sshService = require('../services/sshService')
const installJobService = require('../services/installJobService')
const {
  assertHost,
  assertIntegerRange,
  assertNoControl,
  assertNutSecret,
  assertNutToken,
  badRequest,
} = require('../utils/validation')

router.use(authenticate)

// List machines for a device
router.get('/', async (req, res, next) => {
  try {
    const machines = await ConnectedMachine.findAll({ where: { deviceId: req.params.id } })
    res.json(machines.map(m => sanitize(m)))
  } catch (err) { next(err) }
})

// Add machine
router.post('/', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.create({ ...machinePayload(req.body), deviceId: req.params.id })
    res.status(201).json(sanitize(machine))
  } catch (err) { next(err) }
})

// Update machine
router.put('/:mid', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    await machine.update(machinePayload(req.body))
    res.json(sanitize(machine))
  } catch (err) { next(err) }
})

// Delete machine
router.delete('/:mid', requireRole('admin'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    await machine.destroy()
    res.status(204).send()
  } catch (err) { next(err) }
})

// Test SSH connection
router.post('/:mid/test', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    const result = await sshService.testConnection(machine)
    await machine.update({ lastAction: 'test', lastActionAt: new Date() })
    res.json({ ok: true, output: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Trigger shutdown
router.post('/:mid/shutdown', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    await sshService.shutdown(machine)
    await machine.update({ lastAction: 'shutdown', lastActionAt: new Date() })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Deploy NUT upsmon monitoring agent to a connected machine
router.post('/:mid/deploy-nut', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Machine not found' })
    const { nutHost, nutPort, upsName, nutUsername, nutPassword } = req.body
    if (!nutHost || !upsName || !nutUsername || !nutPassword) {
      return res.status(400).json({ error: 'nutHost, upsName, nutUsername, nutPassword are required' })
    }
    const deployPayload = validateDeployPayload({ nutHost, nutPort: nutPort || 3493, upsName, nutUsername, nutPassword })
    const output = await sshService.deployNutMonitor(machine, deployPayload)
    await machine.update({ nutMonitorDeployed: true, nutMonitorStatus: 'deployed' })
    res.json({ ok: true, output })
  } catch (err) {
    try {
      const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
      if (machine) await machine.update({ nutMonitorStatus: `error: ${err.message.slice(0, 200)}` })
    } catch {}
    next(err)
  }
})

// Check NUT monitor service status on a connected machine
router.get('/:mid/nut-status', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Machine not found' })
    const status = await sshService.getNutMonitorStatus(machine)
    await machine.update({ nutMonitorStatus: status })
    res.json({ status })
  } catch (err) { next(err) }
})

// Clear the pinned SSH host key so the next connection re-pins (TOFU).
// Admin-only: this is the recovery path after a machine reinstall.
router.post('/:mid/reset-host-key', requireRole('admin'), async (req, res, next) => {
  try {
    const machine = await ConnectedMachine.findOne({ where: { id: req.params.mid, deviceId: req.params.id } })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    await machine.update({ sshHostKey: null })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// Migrate a ConnectedMachine to an AgentMachine via SSH bootstrap (async)
router.post('/:mid/install-agent', requireRole('admin', 'operator'), async (req, res, next) => {
  let agentMachine = null
  try {
    const machine = await ConnectedMachine.findOne({
      where: { id: req.params.mid, deviceId: req.params.id },
    })
    if (!machine) return res.status(404).json({ error: 'Not found' })
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Device not found' })

    const token    = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    agentMachine = await AgentMachine.create({
      hostname: machine.host, enrollmentToken: token, enrollmentExpiry: expiresAt,
      state: 'pending', upsGroupId: device.id,
      shutdownDelay: machine.shutdownDelay, notes: machine.description || null,
    })

    const jobId   = installJobService.createJob(agentMachine.id)
    const fluxUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
    const role    = req.body.role || null

    // Respond immediately — frontend polls jobId for progress
    res.json({ ok: true, machineId: agentMachine.id, jobId })

    // Run install in background
    sshService.installAgent(machine, { fluxUrl, token, role }, {
      onOutput: chunk => installJobService.appendChunk(jobId, chunk)
    }).then(async output => {
      installJobService.finishJob(jobId, { success: true })
      await Promise.all([
        agentMachine.update({ installLog: output.slice(-20000) }).catch(err => {
          console.error('[install-agent] failed to save installLog:', err.message)
        }),
        machine.destroy().catch(err => {
          console.error('[install-agent] failed to destroy ConnectedMachine:', err.message)
        }),
      ])
    }).catch(async err => {
      installJobService.finishJob(jobId, { success: false, error: err.message })
      await agentMachine.destroy().catch(() => {})
    })
  } catch (err) {
    if (agentMachine) await agentMachine.destroy().catch(() => {})
    next(err)
  }
})

// Strip credentials from API responses
function sanitize(m) {
  const obj = m.toJSON()
  delete obj.sshPassword
  obj.hasKeyContent = !!obj.sshKeyContent
  delete obj.sshKeyContent
  return obj
}

function machinePayload(body) {
  const allowed = [
    'name', 'host', 'sshPort', 'sshUser', 'sshAuthType', 'sshPassword',
    'sshKeyPath', 'shutdownCommand', 'shutdownDelay', 'description', 'active',
  ]
  const payload = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key]
  }

  if (payload.name !== undefined) assertNoControl(payload.name, 'Machine name')
  if (payload.host !== undefined) assertHost(payload.host, 'Machine host')
  if (payload.sshPort !== undefined) payload.sshPort = assertIntegerRange(payload.sshPort, 'SSH port', 1, 65535)
  if (payload.sshUser !== undefined) {
    assertNoControl(payload.sshUser, 'SSH user')
    if (/\s/.test(payload.sshUser)) throw badRequest('SSH user cannot contain whitespace')
  }
  if (payload.sshAuthType !== undefined && !['password', 'key'].includes(payload.sshAuthType)) {
    throw badRequest('SSH auth type must be password or key')
  }
  if (payload.sshPassword !== undefined) assertNoControl(payload.sshPassword, 'SSH password')
  if (payload.sshKeyPath !== undefined) assertNoControl(payload.sshKeyPath, 'SSH key path')
  if (payload.shutdownCommand !== undefined) assertNoControl(payload.shutdownCommand, 'Shutdown command')
  if (payload.shutdownDelay !== undefined) payload.shutdownDelay = assertIntegerRange(payload.shutdownDelay, 'Shutdown delay', 0, 86400)
  if (payload.description !== undefined) assertNoControl(payload.description, 'Description')

  return payload
}

function validateDeployPayload(payload) {
  assertHost(payload.nutHost, 'NUT host')
  payload.nutPort = assertIntegerRange(payload.nutPort, 'NUT port', 1, 65535)
  assertNutToken(payload.upsName, 'UPS name')
  assertNutSecret(payload.nutUsername, 'NUT username')
  assertNutSecret(payload.nutPassword, 'NUT password')
  return payload
}

module.exports = router
