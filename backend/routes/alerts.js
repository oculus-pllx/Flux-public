const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const AlertTrigger = require('../models/AlertTrigger')
const AlertHistory = require('../models/AlertHistory')
const {
  assertIntegerRange,
  assertNoControl,
  assertNutToken,
  badRequest,
} = require('../utils/validation')

router.use(authenticate)

router.get('/triggers', async (req, res, next) => {
  try { res.json(await AlertTrigger.findAll()) } catch (err) { next(err) }
})

router.post('/triggers', requireRole('admin', 'operator'), async (req, res, next) => {
  try { res.status(201).json(await AlertTrigger.create(triggerPayload(req.body))) } catch (err) { next(err) }
})

router.put('/triggers/:id', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const trigger = await AlertTrigger.findByPk(req.params.id)
    if (!trigger) return res.status(404).json({ error: 'Not found' })
    res.json(await trigger.update(triggerPayload(req.body)))
  } catch (err) { next(err) }
})

router.delete('/triggers/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const trigger = await AlertTrigger.findByPk(req.params.id)
    if (!trigger) return res.status(404).json({ error: 'Not found' })
    await trigger.destroy()
    res.status(204).send()
  } catch (err) { next(err) }
})

router.get('/unresolved/count', async (req, res, next) => {
  try {
    const count = await AlertHistory.count({ where: { resolved: false } })
    res.json({ count })
  } catch (err) { next(err) }
})

router.get('/history', async (req, res, next) => {
  try {
    const limit  = Math.min(Math.max(1, parseInt(req.query.limit)  || 100), 500)
    const offset = Math.max(0, parseInt(req.query.offset) || 0)
    const { count, rows } = await AlertHistory.findAndCountAll({
      order: [['createdAt', 'DESC']], limit, offset,
    })
    res.json({ count, rows })
  } catch (err) { next(err) }
})

router.post('/alerts/:id/resolve', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const alert = await AlertHistory.findByPk(req.params.id)
    if (!alert) return res.status(404).json({ error: 'Not found' })
    await alert.update({ resolved: true, resolvedAt: new Date(), resolvedBy: req.user.id })
    res.json(alert)
  } catch (err) { next(err) }
})

function triggerPayload(body) {
  const allowed = [
    'deviceId', 'groupId', 'variable', 'condition', 'threshold', 'severity',
    'cooldown', 'emailEnabled', 'fireOnce', 'notifyOnRecovery', 'active',
  ]
  const payload = {}
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key]
  }

  if (payload.deviceId !== undefined && payload.deviceId !== null) {
    payload.deviceId = assertIntegerRange(payload.deviceId, 'Device ID', 1, Number.MAX_SAFE_INTEGER)
  }
  if (payload.groupId !== undefined && payload.groupId !== null) {
    payload.groupId = assertIntegerRange(payload.groupId, 'Group ID', 1, Number.MAX_SAFE_INTEGER)
  }
  if (payload.variable !== undefined) assertNutToken(payload.variable, 'Alert variable')
  if (payload.condition !== undefined && !['gt', 'lt', 'eq', 'ne', 'gte', 'lte', 'contains', 'not_contains'].includes(payload.condition)) {
    throw badRequest('Alert condition is invalid')
  }
  if (payload.threshold !== undefined) assertNoControl(String(payload.threshold), 'Alert threshold')
  if (payload.severity !== undefined && !['info', 'warning', 'critical'].includes(payload.severity)) {
    throw badRequest('Alert severity is invalid')
  }
  if (payload.cooldown !== undefined) payload.cooldown = assertIntegerRange(payload.cooldown, 'Alert cooldown', 0, 86400)

  return payload
}

module.exports = router
