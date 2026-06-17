const http = require('http')
const WebSocket = require('ws')

let server, port, wss, receivedMessages

beforeEach(async () => {
  receivedMessages = []
  server = http.createServer()
  wss = new WebSocket.Server({ server, path: '/api/agent' })
  wss.on('connection', ws => {
    ws.on('message', d => receivedMessages.push(JSON.parse(d)))
  })
  await new Promise(r => server.listen(0, r))
  port = server.address().port
})

afterEach(async () => {
  jest.resetModules()
  wss.close()
  await new Promise(r => server.close(r))
})

describe('ws-client', () => {
  it('connects to a WebSocket server', async () => {
    const client = require('../services/ws-client')
    await client.connect({
      fluxUrl: `ws://localhost:${port}/api/agent`,
      machineKey: 'test-key',
      hostname: 'test-host',
      role: 'controlled',
      virtualization: 'none',
      os: 'Test OS',
      agentVersion: '1.0.0',
      capabilities: [],
    })
    await new Promise(r => setTimeout(r, 100))
    expect(receivedMessages.some(m => m.type === 'register')).toBe(true)
    client.disconnect()
  })

  it('sends a ping to keep the connection alive', async () => {
    const client = require('../services/ws-client')
    client.HEARTBEAT_MS = 50 // speed up for test
    await client.connect({
      fluxUrl: `ws://localhost:${port}/api/agent`,
      machineKey: 'hb-key', hostname: 'hb-host', role: 'controlled',
      virtualization: 'none', os: 'Test OS', agentVersion: '1.0.0', capabilities: [],
    })
    await new Promise(r => setTimeout(r, 200))
    expect(receivedMessages.some(m => m.type === 'ping')).toBe(true)
    client.disconnect()
  })

  it('calls onMessage handler when server sends a message', async () => {
    const client = require('../services/ws-client')
    const received = []
    await client.connect({
      fluxUrl: `ws://localhost:${port}/api/agent`,
      machineKey: 'msg-key', hostname: 'msg-host', role: 'controlled',
      virtualization: 'none', os: 'Test OS', agentVersion: '1.0.0', capabilities: [],
      onMessage: (msg) => received.push(msg),
    })
    await new Promise(r => setTimeout(r, 50))
    // Server sends a message to the connected client
    const serverWs = [...wss.clients][0]
    serverWs.send(JSON.stringify({ type: 'ping' }))
    await new Promise(r => setTimeout(r, 50))
    expect(received.some(m => m.type === 'ping')).toBe(true)
    client.disconnect()
  })
})
