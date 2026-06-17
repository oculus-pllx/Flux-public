const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const Setting = require('../models/Setting')
const emailService = require('../services/emailService')

router.use(authenticate, requireRole('admin'))

const VALID_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_recipient', 'smtp_secure']
const REDACTED = '••••••'

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
