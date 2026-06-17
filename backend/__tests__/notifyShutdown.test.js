process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

jest.mock('../services/proxmoxService', () => ({
  freezeHa: jest.fn().mockResolvedValue(),
  waitHaFrozen: jest.fn().mockResolvedValue(true),
  getClusterOptions: jest.fn().mockResolvedValue({ ha: 'shutdown_policy=conditional' }),
  restoreHaPolicy: jest.fn().mockResolvedValue(),
}))

const http = require('http')
const WebSocket = require('ws')
const { sequelize } = require('../config/database')
const AgentMachine = require('../models/AgentMachine')
require('../models/AgentMachineEvent') // ensure table is created on sync
const PowerEvent = require('../models/PowerEvent')
const proxmoxService = require('../services/proxmoxService')

let server, hub, port

beforeAll(async () => {
  await sequelize.sync({ force: true })
  server = http.createServer()
  hub = require('../services/agentHub')
  hub.attach(server)
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port
})

afterAll(async () => {
  hub.detach()
  await new Promise((resolve) => server.close(resolve))
  await sequelize.close()
})

afterEach(async () => {
  proxmoxService.freezeHa.mockClear()
  proxmoxService.getClusterOptions.mockClear()
  proxmoxService.restoreHaPolicy.mockClear()
  await PowerEvent.destroy({ where: {}, truncate: true })
  await AgentMachine.destroy({ where: {}, truncate: true })
})

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/agent`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

async function registerAgent(ws, machineKey) {
  ws.send(JSON.stringify({
    type: 'register', machineKey, hostname: machineKey,
    role: 'pve-node', virtualization: 'none', os: 'Debian 12',
    agentVersion: '1.0.0', capabilities: [],
  }))
  await new Promise((r) => setTimeout(r, 80))
}

function collectByType(ws, type) {
  const received = []
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (msg.type === type) received.push(msg)
  })
  return received
}

describe('notifyShutdown — cluster-aware', () => {
  it('signals all nodes when all share the same UPS (same-UPS cluster)', async () => {
    const pveConfig = { url: 'https://192.168.0.10:8006', tokenId: 'flux@pam!t', tokenSecret: 's', node: 'pve' }
    const m1 = await AgentMachine.create({
      machineKey: 'n1', hostname: 'n1', role: 'pve-node',
      clusterId: 'mycluster', clusterVotes: 1, upsGroupId: 1,
      pveConfig, active: true,
    })
    const m2 = await AgentMachine.create({
      machineKey: 'n2', hostname: 'n2', role: 'pve-node',
      clusterId: 'mycluster', clusterVotes: 1, upsGroupId: 1,
      active: true,
    })

    const ws1 = await openWs(); const ws2 = await openWs()
    await registerAgent(ws1, 'n1'); await registerAgent(ws2, 'n2')
    const recv1 = collectByType(ws1, 'schedule-shutdown'); const recv2 = collectByType(ws2, 'schedule-shutdown')

    await hub.notifyShutdown(1)
    await new Promise((r) => setTimeout(r, 100))

	    expect(recv1).toHaveLength(1)
	    expect(recv2).toHaveLength(1)
	    expect(recv1[0]).toMatchObject({ type: 'schedule-shutdown', deviceId: 1, reason: 'ups-critical' })
	    expect(recv1[0].shutdownId).toBeTruthy()
	    expect(Number.isNaN(new Date(recv1[0].executeAt).getTime())).toBe(false)
    expect(proxmoxService.freezeHa).toHaveBeenCalledTimes(1)
    expect(proxmoxService.freezeHa).toHaveBeenCalledWith(pveConfig)

    const updated1 = await AgentMachine.findByPk(m1.id)
	    expect(updated1.state).toBe('command-sent')
	    const event = await PowerEvent.findOne({ where: { deviceId: 1, state: 'active' } })
	    expect(event.shutdownId).toBe(recv1[0].shutdownId)
	    expect(event.previousHaPolicy).toBe('shutdown_policy=conditional')

    ws1.close(); ws2.close()
  })

  it('signals only affected nodes when quorum is maintained after UPS failure', async () => {
    // 5-node cluster: nodes 1-3 on ups-a (id:10), nodes 4-5 on ups-b (id:20)
    // Failing ups-b loses 2 of 5 votes — quorum maintained (need 3, have 3 remaining)
    const nodes = [
      { machineKey: 'c1', upsGroupId: 10 },
      { machineKey: 'c2', upsGroupId: 10 },
      { machineKey: 'c3', upsGroupId: 10 },
      { machineKey: 'c4', upsGroupId: 20 },
      { machineKey: 'c5', upsGroupId: 20 },
    ]
    for (const n of nodes) {
      await AgentMachine.create({
        machineKey: n.machineKey, hostname: n.machineKey,
        role: 'pve-node', clusterId: 'bigcluster',
        clusterVotes: 1, upsGroupId: n.upsGroupId, active: true,
      })
    }
    const wsList = await Promise.all(nodes.map(() => openWs()))
    for (let i = 0; i < nodes.length; i++) await registerAgent(wsList[i], nodes[i].machineKey)

    const recvList = wsList.map((ws) => collectByType(ws, 'schedule-shutdown'))
    await hub.notifyShutdown(20) // ups-b fails
    await new Promise((r) => setTimeout(r, 100))

    // Only nodes on ups-b (c4, c5) should receive shutdown
    expect(recvList[0]).toHaveLength(0) // c1 — not affected
    expect(recvList[1]).toHaveLength(0) // c2 — not affected
    expect(recvList[2]).toHaveLength(0) // c3 — not affected
    expect(recvList[3]).toHaveLength(1) // c4 — affected
    expect(recvList[4]).toHaveLength(1) // c5 — affected

    for (const ws of wsList) ws.close()
  })

  it('signals all nodes when quorum would be lost', async () => {
    // 5-node cluster: nodes 1-3 on ups-a (id:10), nodes 4-5 on ups-b (id:20)
    // Failing ups-a loses 3 of 5 votes — quorum lost (need 3, only 2 remain)
    const nodes = [
      { machineKey: 'd1', upsGroupId: 10 },
      { machineKey: 'd2', upsGroupId: 10 },
      { machineKey: 'd3', upsGroupId: 10 },
      { machineKey: 'd4', upsGroupId: 20 },
      { machineKey: 'd5', upsGroupId: 20 },
    ]
    for (const n of nodes) {
      await AgentMachine.create({
        machineKey: n.machineKey, hostname: n.machineKey,
        role: 'pve-node', clusterId: 'cluster2',
        clusterVotes: 1, upsGroupId: n.upsGroupId, active: true,
      })
    }
    const wsList = await Promise.all(nodes.map(() => openWs()))
    for (let i = 0; i < nodes.length; i++) await registerAgent(wsList[i], nodes[i].machineKey)

    const recvList = wsList.map((ws) => collectByType(ws, 'schedule-shutdown'))
    await hub.notifyShutdown(10) // ups-a fails — quorum lost
    await new Promise((r) => setTimeout(r, 100))

    // ALL 5 nodes should receive shutdown
    for (const recv of recvList) expect(recv).toHaveLength(1)

    for (const ws of wsList) ws.close()
  })

  it('signals non-cluster controlled machines on the failing UPS', async () => {
    await AgentMachine.create({
      machineKey: 'standalone', hostname: 'standalone',
      role: 'controlled', clusterId: null,
      upsGroupId: 5, active: true,
    })
    const ws = await openWs()
    await registerAgent(ws, 'standalone')
    const recv = collectByType(ws, 'schedule-shutdown')

    await hub.notifyShutdown(5)
    await new Promise((r) => setTimeout(r, 100))

    expect(recv).toHaveLength(1)
    expect(proxmoxService.freezeHa).not.toHaveBeenCalled() // no cluster

    ws.close()
  })

  it('does nothing when no agents are linked to the failing UPS', async () => {
    await AgentMachine.create({
      machineKey: 'other-ups', hostname: 'other',
      role: 'controlled', upsGroupId: 99, active: true,
    })
    await hub.notifyShutdown(1) // UPS 1 — no agents linked
    expect(proxmoxService.freezeHa).not.toHaveBeenCalled()
	  })

	  it('sends cancel-shutdown and restores HA policy when power returns', async () => {
	    const pveConfig = { url: 'https://192.168.0.10:8006', tokenId: 'flux@pam!t', tokenSecret: 's', node: 'pve' }
	    await AgentMachine.create({
	      machineKey: 'recover-pve', hostname: 'recover-pve', role: 'pve-node',
	      clusterId: 'recover-cluster', clusterVotes: 1, upsGroupId: 77,
	      pveConfig, active: true,
	    })
	    const ws = await openWs()
	    await registerAgent(ws, 'recover-pve')
	    const cancels = collectByType(ws, 'cancel-shutdown')
	    const maintenanceDisables = collectByType(ws, 'disable-ha-maintenance')

	    await hub.notifyShutdown(77)
	    await new Promise((r) => setTimeout(r, 100))
	    ws.send(JSON.stringify({
	      type: 'shutdown-step',
	      machineKey: 'recover-pve',
	      step: 'enabling HA maintenance',
	      done: 1,
	      total: 1,
	      shutdownId: (await PowerEvent.findOne({ where: { deviceId: 77, state: 'active' } })).shutdownId,
	      deviceId: 77,
	    }))
	    await new Promise((r) => setTimeout(r, 100))
	    await hub.notifyPowerRestored(77)
	    await new Promise((r) => setTimeout(r, 100))

	    expect(cancels).toHaveLength(1)
	    expect(maintenanceDisables).toHaveLength(1)
	    expect(cancels[0]).toMatchObject({ type: 'cancel-shutdown', deviceId: 77, reason: 'power-restored' })
	    expect(proxmoxService.restoreHaPolicy).toHaveBeenCalledWith(pveConfig, 'shutdown_policy=conditional')
	    const event = await PowerEvent.findOne({ where: { deviceId: 77 } })
	    expect(event.state).toBe('cancelled')
	    expect(event.resolvedAt).toBeTruthy()
	    ws.close()
	  })
	})
