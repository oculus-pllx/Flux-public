const router = require('express').Router()
const crypto = require('crypto')
const { Op } = require('sequelize')
const { authenticate, requireRole } = require('../middleware/auth')
const AgentMachine = require('../models/AgentMachine')
const AgentMachineEvent = require('../models/AgentMachineEvent')
const agentHub          = require('../services/agentHub')
const installJobService = require('../services/installJobService')

router.use(authenticate)

// Generate an enrollment token for a new machine
router.post('/enrollment-token', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const { hostname = 'unknown' } = req.body
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const machine = await AgentMachine.create({
      hostname,
      role: 'controlled',
      state: 'pending',
      enrollmentToken: token,
      enrollmentExpiry: expiresAt,
    })

    res.status(201).json({ token, expiresAt, machineId: machine.id })
  } catch (err) { next(err) }
})

// SSH-bootstrapped install — async, returns jobId for polling
// IMPORTANT: before /:id routes to avoid matching "install-via-ssh" as an id
router.post('/install-via-ssh', requireRole('admin', 'operator'), async (req, res, next) => {
  const { host, sshPort, sshUser, sshAuthType, sshPassword, sshKeyPath, sshKeyContent, role, upsGroupId, nutConfig } = req.body
  if (!host) return res.status(400).json({ error: 'host is required' })

  const token    = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  let machine = null
  try {
    machine = await findReusableInstallMachine(host)
    const installFields = {
      hostname: host,
      machineKey: null,
      enrollmentToken: token,
      enrollmentExpiry: expiresAt,
      state: 'pending',
      stateDetail: null,
      upsGroupId: upsGroupId || null,
      role: role || 'controlled',
      nutConfig: nutConfig || null,
      installLog: null,
    }
    if (machine) {
      await machine.update(installFields)
    } else {
      machine = await AgentMachine.create(installFields)
    }

    const jobId   = installJobService.createJob(machine.id)
    const fluxUrl = `${req.protocol}://${req.get('host')}`
    const sshService = require('../services/sshService')

    // Respond immediately — frontend polls for progress
    res.json({ ok: true, machineId: machine.id, token, expiresAt, jobId })

    // Run install in background
    sshService.installAgent(
      { host, sshPort: sshPort || 22, sshUser: sshUser || 'root', sshAuthType, sshPassword, sshKeyPath, sshKeyContent },
      { fluxUrl, token, role: role || null },
      { onOutput: chunk => installJobService.appendChunk(jobId, chunk) }
    ).then(async output => {
      installJobService.finishJob(jobId, { success: true })
      await machine.update({ installLog: output.slice(-20000) }).catch(err => {
        console.error('[install-via-ssh] failed to save installLog:', err.message)
        // Don't destroy — install succeeded
      })
    }).catch(async err => {
      installJobService.finishJob(jobId, { success: false, error: err.message })
      await machine.destroy().catch(() => {})
    })
  } catch (err) {
    if (machine) await machine.destroy().catch(() => {})
    next(err)
  }
})

function findReusableInstallMachine(host) {
  return AgentMachine.findOne({
    where: {
      hostname: host,
      lastSeen: null,
      state: { [Op.in]: ['offline', 'pending'] },
    },
    order: [['updatedAt', 'DESC']],
  })
}

// Poll install job status — returns accumulated log + done flag
router.get('/install-jobs/:jobId', requireRole('admin', 'operator'), (req, res) => {
  const job = installJobService.getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json({
    done:      job.done,
    success:   job.success,
    error:     job.error,
    machineId: job.machineId,
    log:       job.chunks.join(''),
  })
})

// List all agent machines
router.get('/', async (req, res, next) => {
  try {
    const machines = await AgentMachine.findAll({ order: [['hostname', 'ASC']] })
    res.json(machines)
  } catch (err) { next(err) }
})

// Get single agent machine
router.get('/:id', async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    res.json(m)
  } catch (err) { next(err) }
})

// Update configurable fields (delays, policy, UPS group)
router.put('/:id', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })

    const allowed = ['role', 'shutdownDelay', 'shutdownTimeout', 'shutdownOrder', 'upsGroupId',
      'clusterId', 'clusterVotes',
      'deviceGroupId', 'upsOutlet', 'upsOutletBatteryBacked',
      'updatePolicy', 'updateSchedule', 'active', 'pveConfig',
      'pbsConfig', 'nutConfig', 'notes']
    const updates = {}
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updates[key] = req.body[key]
    }
    if (updates.role !== undefined && !AgentMachine.VALID_ROLES.includes(updates.role)) {
      return res.status(400).json({ error: `role must be one of: ${AgentMachine.VALID_ROLES.join(', ')}` })
    }
    await m.update(updates)
    res.json(m)
  } catch (err) { next(err) }
})

// Re-enroll an existing machine (after rebuild)
router.post('/:id/reenroll', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    await m.update({ enrollmentToken: token, enrollmentExpiry: expiresAt, machineKey: null, state: 'pending' })
    res.json({ token, expiresAt })
  } catch (err) { next(err) }
})

// Delete an agent machine
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    await m.destroy()
    res.status(204).send()
  } catch (err) { next(err) }
})

// Get state history for a machine
router.get('/:id/events', async (req, res, next) => {
  try {
    const events = await AgentMachineEvent.findAll({
      where: { agentMachineId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: 100,
    })
    res.json(events)
  } catch (err) { next(err) }
})

// Push a config-update message to a connected agent via WebSocket
router.post('/:id/push-config', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })

    const { type: _ignored, ...safeBody } = req.body
    const sent = agentHub.sendToMachine(m.machineKey, {
      type: 'config-update',
      ...safeBody,
    })

    if (!sent) return res.status(409).json({ error: 'Agent not connected' })
    res.json({ sent: true })
  } catch (err) { next(err) }
})

// Ping a connected agent — returns { alive, latencyMs? }
router.post('/:id/ping', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (!m.machineKey) return res.json({ alive: false, reason: 'Not enrolled' })

    const start = Date.now()
    const sent = agentHub.sendToMachine(m.machineKey, { type: 'ping' })
    if (!sent) return res.json({ alive: false, reason: 'Not connected' })

    await new Promise((resolve, reject) => {
      const onPong = () => { clearTimeout(timeout); resolve() }
      const timeout = setTimeout(() => {
        agentHub.removeListener(`pong:${m.machineKey}`, onPong)
        reject(new Error('timeout'))
      }, 5000)
      agentHub.once(`pong:${m.machineKey}`, onPong)
    })
    res.json({ alive: true, latencyMs: Date.now() - start })
  } catch (err) {
    if (err.message === 'timeout') return res.json({ alive: false, reason: 'No response in 5s' })
    next(err)
  }
})

// Send manual shutdown command to a connected agent
router.post('/:id/shutdown', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const m = await AgentMachine.findByPk(req.params.id)
    if (!m) return res.status(404).json({ error: 'Not found' })
    if (!m.machineKey) return res.status(400).json({ error: 'Agent not enrolled' })

    const rawDelay = req.body?.delaySeconds ?? 0
    const delaySeconds = Number.isFinite(Number(rawDelay)) ? Math.max(0, Math.min(Number(rawDelay), 3600)) : 0
    const sent = agentHub.sendToMachine(m.machineKey, { type: 'shutdown', delaySeconds })
    if (!sent) return res.status(400).json({ error: 'Agent not connected' })

    await m.update({ state: 'command-sent', stateDetail: 'Manual shutdown triggered' })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// Trigger an agent update manually
router.post('/:id/update', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const agentUpdateService = require('../services/agentUpdateService')
    const result = await agentUpdateService.triggerUpdate(req.params.id)
    res.json(result)
  } catch (err) { next(err) }
})

module.exports = router
