const router = require('express').Router()
const bcrypt = require('bcryptjs')
const { authenticate, requireRole } = require('../middleware/auth')
const User = require('../models/User')

router.use(authenticate, requireRole('admin'))

router.get('/', async (req, res, next) => {
  try {
    const users = await User.findAll({ attributes: { exclude: ['password'] } })
    res.json(users)
  } catch (err) { next(err) }
})

router.post('/', async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body
    const ROLES = ['admin', 'operator', 'viewer']

    if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50)
      return res.status(400).json({ error: 'username must be 3–50 characters' })
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim()))
      return res.status(400).json({ error: 'username may only contain letters, numbers, _ and -' })
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'email must be a valid email address' })
    if (!password || typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'password must be at least 8 characters' })
    if (role !== undefined && !ROLES.includes(role))
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` })

    const user = await User.create({ username: username.trim(), email: email.trim(), password, role: role || 'viewer' })
    res.status(201).json({ id: user.id, username: user.username, role: user.role })
  } catch (err) { next(err) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    const { password, username, email, role } = req.body
    const updates = {}
    if (username !== undefined) updates.username = username
    if (email !== undefined) updates.email = email
    if (role !== undefined) updates.role = role
    if (password) {
      updates.password = await bcrypt.hash(password, 10)
    }
    await user.update(updates)
    res.json({ id: user.id, username: user.username, email: user.email, role: user.role })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user.id === parseInt(req.params.id)) {
      return res.status(400).json({ error: 'Cannot delete yourself' })
    }
    const user = await User.findByPk(req.params.id)
    if (!user) return res.status(404).json({ error: 'Not found' })
    await user.destroy()
    res.status(204).send()
  } catch (err) { next(err) }
})

module.exports = router
