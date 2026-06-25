const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const Setting = require('../models/Setting')
const ProxmoxClusterConfig = require('../models/ProxmoxClusterConfig')
const PbsConfig = require('../models/PbsConfig')
const emailService = require('../services/emailService')
const { redactConfig, stripBlankSecret } = require('../services/proxmoxPbsSettingsService')

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
