const { Op } = require('sequelize')
const Device = require('../models/Device')
const Metrics = require('../models/Metrics')
const nutService = require('./nutService')
const alertService = require('./alertService')
const agentHub = require('./agentHub')

const timers = new Map()
const sseClients = new Set()

function broadcast(deviceId, data, lastSeen) {
  if (sseClients.size === 0) return
  const msg = `event: poll\ndata: ${JSON.stringify({ deviceId, data, lastSeen })}\n\n`
  for (const res of sseClients) res.write(msg)
}
// Tracks whether OB+LB sequence has been initiated per device
const shutdownTriggered = new Set()
// Pending setTimeout handles per device — cancelled if power is restored before they fire
const pendingShutdowns = new Map() // deviceId → [timeoutId, ...]

async function pollDevice(device) {
  try {
    const data = await nutService.pollDevice(
      device.host, device.port, device.upsName,
      device.nutUsername, device.nutPassword
    )
    const lastSeen = new Date()
    await device.update({ lastSeen, lastStatus: data })
    await Metrics.create({ deviceId: device.id, data })

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await Metrics.destroy({ where: { deviceId: device.id, recordedAt: { [Op.lt]: cutoff } } })

    await alertService.evaluate(device.id, data)
    await checkAutoShutdown(device, data)
    broadcast(device.id, data, lastSeen)
  } catch (err) {
    console.error(`Poll failed for device ${device.id} (${device.host}):`, err.message)
    await device.update({
      lastSeen: null,
      lastStatus: {},
      nutHealth: {
        state: 'error',
        sourceType: 'unknown',
        message: `NUT polling failed: ${err.message}`,
        checkedAt: new Date().toISOString(),
        checks: { upscReachable: false },
      },
    })
    broadcast(device.id, {}, null)
  }
}

async function checkAutoShutdown(device, data) {
  const status = (data['ups.status'] || '').toUpperCase()
  const onBattery = status.includes('OB')
  const lowBattery = status.includes('LB')

  if (onBattery && lowBattery && !shutdownTriggered.has(device.id) && !device.shutdownActive) {
    shutdownTriggered.add(device.id)
    await device.update({ shutdownActive: true })
    console.log(`[AutoShutdown] Device ${device.id} is OB+LB — scheduling connected machine shutdowns`)

    try {
      const ConnectedMachine = require('../models/ConnectedMachine')
      const sshService = require('./sshService')
      const machines = await ConnectedMachine.findAll({
        where: { deviceId: device.id, active: true },
        order: [['shutdownDelay', 'ASC']],
      })

      const handles = []
      for (const machine of machines) {
        const delaySec = machine.shutdownDelay || 0
        console.log(`[AutoShutdown] ${machine.name} (${machine.host}) scheduled in ${delaySec}s`)

        const handle = setTimeout(async () => {
          try {
            await sshService.shutdown(machine)
            await machine.update({ lastAction: 'auto-shutdown', lastActionAt: new Date() })
            console.log(`[AutoShutdown] Shutdown sent to ${machine.name} (${machine.host})`)
          } catch (err) {
            console.error(`[AutoShutdown] Failed to shutdown ${machine.name}: ${err.message}`)
          }
        }, delaySec * 1000)

        handles.push(handle)
      }

      pendingShutdowns.set(device.id, handles)
    } catch (err) {
      console.error(`[AutoShutdown] Error loading machines: ${err.message}`)
    }

    // Signal agent-connected machines
    try {
      await agentHub.notifyShutdown(device.id)
    } catch (err) {
      console.error(`[AutoShutdown] agentHub notify failed: ${err.message}`)
    }
  }

  // Power restored — cancel any pending shutdown timers
  if (!onBattery && (shutdownTriggered.has(device.id) || device.shutdownActive)) {
    shutdownTriggered.delete(device.id)
    await device.update({ shutdownActive: false })
	    const handles = pendingShutdowns.get(device.id) || []
	    handles.forEach(h => clearTimeout(h))
	    pendingShutdowns.delete(device.id)
	    try {
	      await agentHub.notifyPowerRestored(device.id)
	    } catch (err) {
	      console.error(`[AutoShutdown] agentHub recovery notify failed: ${err.message}`)
	    }
	    console.log(`[AutoShutdown] Device ${device.id} back on line power — cancelled ${handles.length} pending shutdown(s)`)
	  }
}

async function startPolling() {
  // Restore in-memory shutdown state from DB (survives backend restarts)
  const triggered = await Device.findAll({ where: { shutdownActive: true } })
  for (const d of triggered) shutdownTriggered.add(d.id)

  const devices = await Device.findAll({ where: { active: true } })
  for (const device of devices) {
    scheduleDevice(device)
  }
}

function scheduleDevice(device) {
  stopDevice(device.id)
  const ms = (device.pollInterval || 30) * 1000
  pollDevice(device)
  const timer = setInterval(() => pollDevice(device), ms)
  timers.set(device.id, timer)
}

function stopDevice(deviceId) {
  if (timers.has(deviceId)) {
    clearInterval(timers.get(deviceId))
    timers.delete(deviceId)
  }
}

module.exports = { startPolling, scheduleDevice, stopDevice, sseClients, checkAutoShutdownForTest: checkAutoShutdown, pollDeviceForTest: pollDevice }
