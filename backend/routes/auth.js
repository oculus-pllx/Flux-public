const router    = require('express').Router()
const jwt       = require('jsonwebtoken')
const bcrypt    = require('bcryptjs')
const rateLimit = require('express-rate-limit')
const User      = require('../models/User')
const { authenticate } = require('../middleware/auth')

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
})

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body
    const count = await User.count()
    if (count > 0) {
      return res.status(403).json({ error: 'Registration is closed. Ask an administrator to create your account.' })
    }
    const user = await User.create({ username, email, password, role: 'admin' })
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } })
  } catch (err) {
    next(err)
  }
})

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'username and password are required' })
    }
    const user = await User.findOne({ where: { username, active: true } })
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } })
  } catch (err) {
    next(err)
  }
})

router.post('/validate-token', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user })
})

router.put('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword required' })
    }
    const user = await User.findByPk(req.user.id)
    if (!user) return res.status(404).json({ error: 'User not found' })
    const valid = await user.verifyPassword(currentPassword)
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' })
    const hash = await bcrypt.hash(newPassword, 10)
    await user.update({ password: hash })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

module.exports = router
