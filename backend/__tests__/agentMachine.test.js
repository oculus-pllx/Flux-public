process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const { sequelize } = require('../config/database')
const AgentMachine = require('../models/AgentMachine')
const AgentMachineEvent = require('../models/AgentMachineEvent')

beforeAll(async () => {
  await sequelize.sync({ force: true })
})

afterAll(async () => {
  await sequelize.close()
})

describe('AgentMachine', () => {
  it('creates a machine with default state offline', async () => {
    const m = await AgentMachine.create({
      machineKey: 'test-key-1',
      hostname: 'pve-01',
      role: 'pve-node',
    })
    expect(m.state).toBe('offline')
    expect(m.updatePolicy).toBe('manual')
    expect(m.shutdownDelay).toBe(0)
    expect(m.shutdownTimeout).toBe(120)
  })

  it('rejects duplicate machineKey', async () => {
    await AgentMachine.create({ machineKey: 'dup-key', hostname: 'a', role: 'controlled' })
    await expect(
      AgentMachine.create({ machineKey: 'dup-key', hostname: 'b', role: 'controlled' })
    ).rejects.toThrow()
  })

  it('creates an event linked to a machine', async () => {
    const m = await AgentMachine.create({ machineKey: 'evt-key', hostname: 'host', role: 'controlled' })
    const evt = await AgentMachineEvent.create({
      agentMachineId: m.id,
      fromState: 'offline',
      toState: 'online',
    })
    expect(evt.agentMachineId).toBe(m.id)
    expect(evt.toState).toBe('online')
  })
})
