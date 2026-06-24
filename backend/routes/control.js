const router = require('express').Router({ mergeParams: true })
const { authenticate, requireRole } = require('../middleware/auth')
const Device = require('../models/Device')
const { getClient } = require('../services/nutService')

router.use(authenticate)

function requireNutCredentials(device, res) {
  if (!device.nutUsername || !device.nutPassword) {
    res.status(422).json({
      error: 'NUT credentials not configured for this device. Add a NUT username and password in device settings before using control features.'
    })
    return false
  }
  return true
}

async function runPreferredBeeperSilenceCommand(client, upsName) {
  const commands = await client.listCommands(upsName)
  const command = commands.includes('beeper.disable')
    ? 'beeper.disable'
    : commands.includes('beeper.mute')
      ? 'beeper.mute'
      : null

  if (!command) {
    const err = new Error('This UPS does not expose beeper.disable or beeper.mute via NUT.')
    err.status = 422
    throw err
  }

  await client.runCommand(upsName, command)
  return command
}

// List available INSTCMD commands
router.get('/commands', async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    if (!requireNutCredentials(device, res)) return
    const client = getClient(device)
    const commands = await client.listCommands(device.upsName)
    res.json(commands)
  } catch (err) { next(err) }
})

// Silence the UPS beeper. Prefer persistent disable when supported; otherwise
// fall back to the temporary mute command exposed by simpler UPS models.
router.post('/beeper/silence', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    if (!requireNutCredentials(device, res)) return
    const client = getClient(device)
    const command = await runPreferredBeeperSilenceCommand(client, device.upsName)
    res.json({ ok: true, command })
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message })
    next(err)
  }
})

// Run an INSTCMD
router.post('/commands/:cmd', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    if (!requireNutCredentials(device, res)) return
    const client = getClient(device)
    await client.runCommand(device.upsName, req.params.cmd)
    res.json({ ok: true, command: req.params.cmd })
  } catch (err) { next(err) }
})

// List read-write variables
router.get('/vars/rw', async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    if (!requireNutCredentials(device, res)) return
    const client = getClient(device)
    const vars = await client.listRWVars(device.upsName)
    res.json(vars)
  } catch (err) { next(err) }
})

// Set a read-write variable
router.put('/vars/:varname', requireRole('admin', 'operator'), async (req, res, next) => {
  try {
    const device = await Device.findByPk(req.params.id)
    if (!device) return res.status(404).json({ error: 'Not found' })
    if (!requireNutCredentials(device, res)) return
    const { value } = req.body
    if (value === undefined) return res.status(400).json({ error: 'value required' })
    const client = getClient(device)
    await client.setVar(device.upsName, req.params.varname, String(value))
    res.json({ ok: true, varname: req.params.varname, value })
  } catch (err) { next(err) }
})

module.exports = router
