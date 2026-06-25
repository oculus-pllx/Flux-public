const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const Setting = require('../models/Setting')
const ProxmoxClusterConfig = require('../models/ProxmoxClusterConfig')
const PbsConfig = require('../models/PbsConfig')
const AgentMachine = require('../models/AgentMachine')
const emailService = require('../services/emailService')
const proxmoxService = require('../services/proxmoxService')
const pbsService = require('../services/pbsService')
const agentHub = require('../services/agentHub')
const {
  buildNodeMatches,
  buildPbsConfig,
  buildPveConfig,
  pbsApiConfig,
  pveApiConfig,
  publicAgent,
  redactConfig,
  stripBlankSecret,
} = require('../services/proxmoxPbsSettingsService')

router.use(authenticate, requireRole('admin'))

const VALID_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_recipient', 'smtp_secure']
const REDACTED = '••••••'

function pickFields(body, keys) {
  const out = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key]
  }
  return stripBlankSecret(out)
}

const PROXMOX_FIELDS = ['name', 'clusterId', 'apiBaseUrl', 'tokenId', 'tokenSecret', 'haFreezeTimeout', 'enabled']
const PBS_FIELDS = ['name', 'url', 'tokenId', 'tokenSecret', 'jobAbortTimeout', 'forceShutdown', 'upsGroupId', 'enabled']

router.get('/proxmox-pbs/proxmox-clusters', async (req, res, next) => {
  try {
    const rows = await ProxmoxClusterConfig.findAll({ order: [['name', 'ASC']] })
    res.json(rows.map(redactConfig))
  } catch (err) { next(err) }
})

router.post('/proxmox-pbs/proxmox-clusters', async (req, res, next) => {
  try {
    const row = await ProxmoxClusterConfig.create(pickFields(req.body, PROXMOX_FIELDS))
    res.status(201).json(redactConfig(row))
  } catch (err) { next(err) }
})

router.put('/proxmox-pbs/proxmox-clusters/:id', async (req, res, next) => {
  try {
    const row = await ProxmoxClusterConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    await row.update(pickFields(req.body, PROXMOX_FIELDS))
    res.json(redactConfig(row))
  } catch (err) { next(err) }
})

router.post('/proxmox-pbs/proxmox-clusters/:id/test', async (req, res, next) => {
  try {
    const row = await ProxmoxClusterConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!row.tokenSecret) return res.status(400).json({ error: 'Token secret is required' })
    const nodes = await proxmoxService.listNodes(pveApiConfig(row))
    res.json({ ok: true, nodeCount: Array.isArray(nodes) ? nodes.length : 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/proxmox-pbs/proxmox-clusters/:id/discover', async (req, res, next) => {
  try {
    const row = await ProxmoxClusterConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!row.tokenSecret) return res.status(400).json({ error: 'Token secret is required' })
    const [nodes, machines] = await Promise.all([
      proxmoxService.listNodes(pveApiConfig(row)),
      AgentMachine.findAll({ order: [['hostname', 'ASC']] }),
    ])
    const matches = buildNodeMatches(nodes, machines)
    const matchedIds = new Set(matches.flatMap((m) => m.candidates.map((c) => c.id)))
    const unmatchedAgents = machines
      .filter((m) => ['pve-node', 'ups-host', 'both'].includes(m.role))
      .filter((m) => !matchedIds.has(m.id))
      .map(publicAgent)
    res.json({ nodes: matches, unmatchedAgents })
  } catch (err) { next(err) }
})

router.post('/proxmox-pbs/proxmox-clusters/:id/apply', async (req, res, next) => {
  try {
    const row = await ProxmoxClusterConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!row.tokenSecret) return res.status(400).json({ error: 'Token secret is required' })
    const targets = Array.isArray(req.body.targets) ? req.body.targets : []
    if (targets.length === 0) return res.status(400).json({ error: 'targets are required' })

    const applied = []
    for (const target of targets) {
      const machine = await AgentMachine.findByPk(target.agentMachineId)
      if (!machine) {
        applied.push({
          node: target.node,
          agentMachineId: target.agentMachineId,
          pushed: false,
          pushStatus: 'not-found',
        })
        continue
      }

      const pveConfig = buildPveConfig(row, target.node)
      await machine.update({
        clusterId: row.clusterId,
        pveConfig,
      })
      const pushed = agentHub.sendToMachine(machine.machineKey, {
        type: 'config-update',
        clusterId: row.clusterId,
        pveConfig,
      })
      applied.push({
        node: target.node,
        agentMachineId: machine.id,
        hostname: machine.hostname,
        pushed,
        pushStatus: pushed ? 'sent' : 'offline',
      })
    }

    res.json({ applied })
  } catch (err) { next(err) }
})

router.get('/proxmox-pbs/pbs-configs', async (req, res, next) => {
  try {
    const rows = await PbsConfig.findAll({ order: [['name', 'ASC']] })
    res.json(rows.map(redactConfig))
  } catch (err) { next(err) }
})

router.post('/proxmox-pbs/pbs-configs', async (req, res, next) => {
  try {
    const row = await PbsConfig.create(pickFields(req.body, PBS_FIELDS))
    res.status(201).json(redactConfig(row))
  } catch (err) { next(err) }
})

router.put('/proxmox-pbs/pbs-configs/:id', async (req, res, next) => {
  try {
    const row = await PbsConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    await row.update(pickFields(req.body, PBS_FIELDS))
    res.json(redactConfig(row))
  } catch (err) { next(err) }
})

router.post('/proxmox-pbs/pbs-configs/:id/test', async (req, res, next) => {
  try {
    const row = await PbsConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!row.tokenSecret) return res.status(400).json({ error: 'Token secret is required' })
    const result = await pbsService.testConnection(pbsApiConfig(row))
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/proxmox-pbs/pbs-configs/:id/apply', async (req, res, next) => {
  try {
    const row = await PbsConfig.findByPk(req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (!row.tokenSecret) return res.status(400).json({ error: 'Token secret is required' })
    if (!req.body.agentMachineId) return res.status(400).json({ error: 'agentMachineId is required' })
    const machine = await AgentMachine.findByPk(req.body.agentMachineId)
    if (!machine) return res.status(404).json({ error: 'Agent machine not found' })

    const pbsConfig = buildPbsConfig(row)
    const updates = { pbsConfig }
    const assignUpsGroupId = Object.prototype.hasOwnProperty.call(req.body, 'assignUpsGroupId')
      ? req.body.assignUpsGroupId
      : null
    if (assignUpsGroupId !== null && assignUpsGroupId !== '') {
      updates.upsGroupId = assignUpsGroupId
      updates.shutdownOrder = 0
      updates.shutdownDelay = 0
      updates.shutdownTimeout = 120
      updates.upsOutlet = null
      updates.upsOutletBatteryBacked = null
    }
    await machine.update(updates)

    const payload = { type: 'config-update', pbsConfig }
    if (assignUpsGroupId !== null && assignUpsGroupId !== '') payload.upsGroupId = assignUpsGroupId
    const pushed = agentHub.sendToMachine(machine.machineKey, payload)

    res.json({
      agentMachineId: machine.id,
      hostname: machine.hostname,
      pushed,
      pushStatus: pushed ? 'sent' : 'offline',
      assignedUpsGroupId: assignUpsGroupId !== null && assignUpsGroupId !== '' ? assignUpsGroupId : null,
    })
  } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
  try {
    const rows = await Setting.findAll()
    const out = Object.fromEntries(VALID_KEYS.map(k => [k, '']))
    for (const row of rows) {
      out[row.key] = row.key === 'smtp_pass' && row.value ? REDACTED : (row.value || '')
    }
    res.json(out)
  } catch (err) { next(err) }
})

router.put('/', async (req, res, next) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!VALID_KEYS.includes(key)) continue
      if (key === 'smtp_pass' && value === REDACTED) continue
      await Setting.upsert({ key, value: String(value) })
    }
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/test-email', async (req, res, next) => {
  try {
    await emailService.sendTestEmail()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
