const router = require('express').Router()
const { authenticate, authenticateQueryToken } = require('../middleware/auth')
const Metrics = require('../models/Metrics')
const { Op } = require('sequelize')

router.get('/stream', authenticateQueryToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { sseClients } = require('../services/pollingService')
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

router.use(authenticate)

router.get('/device/:id', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const metrics = await Metrics.findAll({
      where: { deviceId: req.params.id, recordedAt: { [Op.gte]: since } },
      order: [['recordedAt', 'ASC']],
    })
    res.json(metrics)
  } catch (err) { next(err) }
})

router.get('/device/:id/stats', async (req, res, next) => {
  try {
    const metrics = await Metrics.findAll({
      where: { deviceId: req.params.id },
      order: [['recordedAt', 'DESC']],
      limit: 1,
    })
    res.json(metrics[0] || {})
  } catch (err) { next(err) }
})

router.get('/latest', async (req, res, next) => {
  try {
    const Device = require('../models/Device')
    const { sequelize } = require('../config/database')
    const devices = await Device.findAll({ where: { active: true } })
    if (devices.length === 0) return res.json([])

    // Single query: latest metric per device via subquery
    const latest = await sequelize.query(
      `SELECT m.deviceId, m.data, m.recordedAt
       FROM Metrics m
       INNER JOIN (
         SELECT deviceId, MAX(recordedAt) AS maxDate FROM Metrics GROUP BY deviceId
       ) sub ON m.deviceId = sub.deviceId AND m.recordedAt = sub.maxDate`,
      { type: 'SELECT' }
    )
    const byDevice = Object.fromEntries(latest.map(r => [r.deviceId, {
      ...r,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }]))

    res.json(devices.map(d => ({
      deviceId: d.id, name: d.name,
      data:     byDevice[d.id]?.data     || null,
      lastSeen: d.lastSeen,
    })))
  } catch (err) { next(err) }
})

module.exports = router
