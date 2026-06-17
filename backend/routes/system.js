const router = require('express').Router()
const { authenticate, authenticateQueryToken, requireRole } = require('../middleware/auth')
const { sequelize } = require('../config/database')
const Group            = require('../models/Group')
const Device           = require('../models/Device')
const ConnectedMachine = require('../models/ConnectedMachine')
const AgentMachine     = require('../models/AgentMachine')
const ClusterGroup     = require('../models/ClusterGroup')
const User             = require('../models/User')
const AlertTrigger     = require('../models/AlertTrigger')
const Setting          = require('../models/Setting')
const AlertHistory     = require('../models/AlertHistory')
const AgentMachineEvent = require('../models/AgentMachineEvent')
const Metrics          = require('../models/Metrics')
const multer           = require('multer')
const { version }      = require('../package.json')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

router.use(authenticate, requireRole('admin'))

// ──────────────────────────────────────────────────────────────
// GET /api/system/backup — download full JSON backup
// Uses query-token auth so browser download links work without
// custom headers; token is stripped before logging.
// ──────────────────────────────────────────────────────────────
router.get('/backup', authenticateQueryToken, requireRole('admin'), async (req, res, next) => {
  try {
    const [groups, devices, connectedMachines, agentMachines,
           clusterGroups, users, alertTriggers, settings] = await Promise.all([
      Group.findAll({ raw: true }),
      Device.findAll({ raw: true }),
      ConnectedMachine.findAll({ raw: true }),
      AgentMachine.findAll({ raw: true }),
      ClusterGroup.findAll({ raw: true }),
      User.findAll({ raw: true }),
      AlertTrigger.findAll({ raw: true }),
      Setting.findAll({ raw: true }),
    ])

    const now = new Date()
    const backup = {
      version,
      createdAt: now.toISOString(),
      counts: {
        groups: groups.length,
        devices: devices.length,
        connectedMachines: connectedMachines.length,
        agentMachines: agentMachines.length,
        clusterGroups: clusterGroups.length,
        users: users.length,
        alertTriggers: alertTriggers.length,
        settings: settings.length,
      },
      data: { groups, devices, connectedMachines, agentMachines,
              clusterGroups, users, alertTriggers, settings },
    }

    const date = now.toISOString().slice(0, 10)
    res.setHeader('Content-Disposition', `attachment; filename="flux-backup-${date}.json"`)
    res.json(backup)
  } catch (err) { next(err) }
})

// ──────────────────────────────────────────────────────────────
// POST /api/system/restore — restore from uploaded JSON backup
// ──────────────────────────────────────────────────────────────
router.post('/restore', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Parse
    let backup
    try {
      backup = JSON.parse(req.file.buffer.toString('utf8'))
    } catch {
      return res.status(400).json({ error: 'Invalid JSON in uploaded file' })
    }

    // Validate top-level structure
    const requiredTop = ['version', 'createdAt', 'data']
    for (const k of requiredTop) {
      if (!(k in backup)) {
        return res.status(400).json({ error: `Missing required field: ${k}` })
      }
    }
    const requiredData = ['groups', 'devices', 'connectedMachines', 'agentMachines',
                          'clusterGroups', 'users', 'alertTriggers', 'settings']
    for (const k of requiredData) {
      if (!Array.isArray(backup.data[k])) {
        return res.status(400).json({ error: `Missing or invalid data.${k}` })
      }
    }

    // Warn if backup version doesn't match current app version
    if (backup.version !== version) {
      console.warn(`[restore] Version mismatch: backup=${backup.version}, app=${version}. Proceeding anyway.`)
    }

    const d = backup.data

    // Restore inside a transaction
    await sequelize.transaction(async (t) => {
      // Clear transient/history tables first to avoid orphaned FK references
      await AlertHistory.destroy({ where: {}, transaction: t })
      await AgentMachineEvent.destroy({ where: {}, transaction: t })
      await Metrics.destroy({ where: {}, transaction: t })
      // Destroy config tables in dependency order (most dependent first)
      await AlertTrigger.destroy({ where: {}, transaction: t })
      await Setting.destroy({ where: {}, transaction: t })
      await ConnectedMachine.destroy({ where: {}, transaction: t })
      await AgentMachine.destroy({ where: {}, transaction: t })
      await ClusterGroup.destroy({ where: {}, transaction: t })
      await Device.destroy({ where: {}, transaction: t })
      await Group.destroy({ where: {}, transaction: t })
      await User.destroy({ where: {}, transaction: t })

      // Insert in reverse order (least dependent first)
      // individualHooks: false (default) — intentional: passwords are already bcrypt-hashed,
      // User.beforeCreate must NOT re-hash them during restore
      if (d.users.length)             await User.bulkCreate(d.users, { transaction: t })
      if (d.groups.length)            await Group.bulkCreate(d.groups, { transaction: t })
      if (d.devices.length)           await Device.bulkCreate(d.devices, { transaction: t })
      if (d.clusterGroups.length)     await ClusterGroup.bulkCreate(d.clusterGroups, { transaction: t })
      if (d.agentMachines.length)     await AgentMachine.bulkCreate(d.agentMachines, { transaction: t })
      if (d.connectedMachines.length) await ConnectedMachine.bulkCreate(d.connectedMachines, { transaction: t })
      if (d.settings.length)          await Setting.bulkCreate(d.settings, { transaction: t })
      if (d.alertTriggers.length)     await AlertTrigger.bulkCreate(d.alertTriggers, { transaction: t })
    })

    res.json({
      ok: true,
      counts: {
        groups: d.groups.length,
        devices: d.devices.length,
        connectedMachines: d.connectedMachines.length,
        agentMachines: d.agentMachines.length,
        clusterGroups: d.clusterGroups.length,
        users: d.users.length,
        alertTriggers: d.alertTriggers.length,
        settings: d.settings.length,
      },
    })
  } catch (err) { next(err) }
})

// ──────────────────────────────────────────────────────────────
// Server self-update (admin-only via router-wide middleware)
// ──────────────────────────────────────────────────────────────
const serverUpdateService = require('../services/serverUpdateService')

router.get('/update', async (req, res, next) => {
  try { res.json(await serverUpdateService.getStatus()) } catch (err) { next(err) }
})

router.post('/update', async (req, res, next) => {
  try {
    const devices = await Device.findAll({ where: { active: true } })
    const onBattery = devices.some(d =>
      String((d.lastStatus && d.lastStatus['ups.status']) || '').toUpperCase().includes('OB'))
    if (onBattery) {
      return res.status(409).json({ error: 'A UPS is on battery — refusing to update during a power event.' })
    }
    res.status(202).json(await serverUpdateService.applyUpdate())
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.get('/update/log', async (req, res, next) => {
  try { res.json(await serverUpdateService.getUpdateLog()) } catch (err) { next(err) }
})

module.exports = router
