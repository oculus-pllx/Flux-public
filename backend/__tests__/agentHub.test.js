process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const http = require('http')
const WebSocket = require('ws')
const { sequelize } = require('../config/database')
const AgentMachine = require('../models/AgentMachine')
const AgentMachineEvent = require('../models/AgentMachineEvent')

let server, hub, port

beforeAll(async () => {
  await sequelize.sync({ force: true })
  server = http.createServer()
  hub = require('../services/agentHub')
  hub.attach(server)
  await new Promise(resolve => server.listen(0, resolve))
  port = server.address().port
})

afterAll(async () => {
  hub.detach()
  await new Promise(resolve => server.close(resolve))
  await sequelize.close()
})

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agent`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMsg(ws) {
  return new Promise(resolve => ws.once('message', d => resolve(JSON.parse(d))))
}

describe('agentHub', () => {
  it('accepts a WebSocket connection', async () => {
    const ws = await openWs()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('registers an agent with a valid machineKey', async () => {
    const machine = await AgentMachine.create({
      machineKey: 'valid-key', hostname: 'test-host', role: 'controlled', state: 'offline',
    })
    const ws = await openWs()
    ws.send(JSON.stringify({
      type: 'register', machineKey: 'valid-key', hostname: 'test-host',
      role: 'controlled', virtualization: 'none', os: 'Debian 12', agentVersion: '1.0.0',
      capabilities: [],
    }))
    await new Promise(r => setTimeout(r, 100))
    const updated = await AgentMachine.findByPk(machine.id)
    expect(updated.state).toBe('online')
    ws.close()
  })

  it('uses agent-reported role on first registration only', async () => {
    const machine = await AgentMachine.create({
      machineKey: 'first-role-key', hostname: 'first-role-host', role: 'controlled', state: 'offline',
      lastSeen: null,
    })
    const ws = await openWs()
    ws.send(JSON.stringify({
      type: 'register', machineKey: 'first-role-key', hostname: 'first-role-host',
      role: 'pve-node', virtualization: 'none', os: 'Debian 12', agentVersion: '1.0.0',
      capabilities: [],
    }))
    await new Promise(r => setTimeout(r, 100))
    const updated = await AgentMachine.findByPk(machine.id)
    expect(updated.role).toBe('pve-node')
    ws.close()
  })

  it('preserves an established server-configured role on reconnect', async () => {
    const machine = await AgentMachine.create({
      machineKey: 'server-role-key', hostname: 'server-role-host', role: 'ups-host', state: 'offline',
      lastSeen: new Date(Date.now() - 60_000),
    })
    const ws = await openWs()
    ws.send(JSON.stringify({
      type: 'register', machineKey: 'server-role-key', hostname: 'server-role-host',
      role: 'pve-node', virtualization: 'none', os: 'Debian 12', agentVersion: '1.0.0',
      capabilities: [],
    }))
    await new Promise(r => setTimeout(r, 100))
    const updated = await AgentMachine.findByPk(machine.id)
    expect(updated.role).toBe('ups-host')
    ws.close()
  })

  it('closes connection for unknown machineKey', async () => {
    const ws = await openWs()
    ws.send(JSON.stringify({ type: 'register', machineKey: 'no-such-key', hostname: 'x', role: 'controlled' }))
    await new Promise(resolve => ws.once('close', resolve))
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('sends a command to a connected agent', async () => {
    await AgentMachine.create({ machineKey: 'cmd-key', hostname: 'cmd-host', role: 'controlled' })
    const ws = await openWs()
    ws.send(JSON.stringify({ type: 'register', machineKey: 'cmd-key', hostname: 'cmd-host',
      role: 'controlled', virtualization: 'none', os: 'Debian 12', agentVersion: '1.0.0', capabilities: [] }))
    await new Promise(r => setTimeout(r, 100))

    const msgPromise = nextMsg(ws)
    const sent = hub.sendToMachine('cmd-key', { type: 'ping' })
    expect(sent).toBe(true)
    const msg = await msgPromise
    expect(msg.type).toBe('ping')
    ws.close()
  })

  it('returns false when sending to disconnected agent', () => {
    const sent = hub.sendToMachine('not-connected-key', { type: 'ping' })
    expect(sent).toBe(false)
  })

  it('emits pong event when agent sends pong message', async () => {
    const machineKey = 'pong-test-key'
    await AgentMachine.create({ machineKey, hostname: 'pong-host', role: 'controlled', state: 'offline' })

    const ws = await openWs()
    ws.send(JSON.stringify({
      type: 'register', machineKey, hostname: 'pong-host',
      role: 'controlled', virtualization: 'none', os: 'Debian 12', agentVersion: '1.0.0',
      capabilities: [],
    }))
    await new Promise(r => setTimeout(r, 100))

    const pongFired = new Promise(resolve => hub.once(`pong:${machineKey}`, resolve))
    ws.send(JSON.stringify({ type: 'pong', machineKey }))
    await expect(pongFired).resolves.toBeUndefined()

    ws.close()
  })
})
