const AlertTrigger = require('../models/AlertTrigger')
const AlertHistory = require('../models/AlertHistory')
const Device = require('../models/Device')
const emailService = require('./emailService')

const OPERATORS = {
  gt:  (a, b) => a > b,
  lt:  (a, b) => a < b,
  eq:  (a, b) => a === b,
  ne:  (a, b) => a !== b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
}

const STRING_CONDITIONS = new Set(['contains', 'not_contains'])

// In-memory: was condition true on last poll? Used for edge detection.
// Resets on backend restart — first poll after restart re-evaluates fresh.
const triggerStates = new Map() // triggerId → boolean

async function evaluate(deviceId, variables) {
  const device = await Device.findByPk(deviceId)
  const deviceName = device?.name || `Device ${deviceId}`

  const triggerWhere = [{ active: true, deviceId }]
  if (device?.groupId) triggerWhere.push({ active: true, groupId: device.groupId, deviceId: null })
  const { Op } = require('sequelize')
  const triggers = await AlertTrigger.findAll({ where: { [Op.or]: triggerWhere } })

  for (const trigger of triggers) {
    // ── Evaluate condition ────────────────────────────────────────────────
    let conditionMet = false
    let skip = false

    if (STRING_CONDITIONS.has(trigger.condition)) {
      if (!(trigger.variable in variables)) { skip = true }
      else {
        const value = String(variables[trigger.variable] ?? '')
        const match = value.toLowerCase().includes(String(trigger.threshold).toLowerCase())
        conditionMet = trigger.condition === 'contains' ? match : !match
      }
    } else {
      const value = parseFloat(variables[trigger.variable])
      if (isNaN(value)) { skip = true }
      else {
        const check = OPERATORS[trigger.condition]
        if (!check) { skip = true }
        else conditionMet = check(value, parseFloat(trigger.threshold))
      }
    }

    if (skip) continue

    const wasActive = triggerStates.get(trigger.id) ?? false

    // ── Condition true ────────────────────────────────────────────────────
    if (conditionMet) {
      triggerStates.set(trigger.id, true)

      if (trigger.fireOnce && wasActive) continue // already fired this event, wait for reset

      if (!trigger.fireOnce) {
        // Level-triggered: respect cooldown
        const cooldownMs = trigger.cooldown * 1000
        if (trigger.lastTriggered && Date.now() - new Date(trigger.lastTriggered) < cooldownMs) continue
      }

      const rawValue = variables[trigger.variable]
      const message = `${trigger.variable} is ${rawValue} (${trigger.condition} ${trigger.threshold})`
      await AlertHistory.create({
        triggerId: trigger.id, deviceId, message,
        value: isNaN(parseFloat(rawValue)) ? null : parseFloat(rawValue),
        severity: trigger.severity,
      })
      await trigger.update({ lastTriggered: new Date() })

      if (trigger.emailEnabled) {
        await emailService.sendAlert({ message, severity: trigger.severity, deviceId, deviceName })
      }

    // ── Condition false ───────────────────────────────────────────────────
    } else {
      if (wasActive && trigger.notifyOnRecovery) {
        const message = `${trigger.variable} recovered — ${trigger.condition} ${trigger.threshold} no longer met`
        await AlertHistory.create({
          triggerId: trigger.id, deviceId, message, value: null, severity: 'info',
        })
        if (trigger.emailEnabled) {
          await emailService.sendAlert({ message, severity: 'info', deviceId, deviceName, recovered: true })
        }
      }
      triggerStates.set(trigger.id, false)
    }
  }
}

module.exports = { evaluate }
