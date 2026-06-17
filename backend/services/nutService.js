const net = require('net')
const {
  assertHost,
  assertIntegerRange,
  assertNutSecret,
  assertNutToken,
  escapeNutQuotedValue,
} = require('../utils/validation')

class NutClient {
  constructor(host, port, username, password) {
    assertHost(host, 'NUT host')
    this.host = host
    this.port = assertIntegerRange(port || 3493, 'NUT port', 1, 65535)
    assertNutSecret(username, 'NUT username')
    assertNutSecret(password, 'NUT password')
    this.username = username || null
    this.password = password || null
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      socket.setTimeout(10000)
      socket.connect(this.port, this.host, () => resolve(socket))
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')) })
      socket.on('error', reject)
    })
  }

  _request(socket, command, endPattern) {
    return new Promise((resolve, reject) => {
      let buffer = ''
      const lines = []

      const onData = (data) => {
        buffer += data.toString()
        const parts = buffer.split('\n')
        buffer = parts.pop()

        for (const line of parts) {
          const trimmed = line.trimEnd()
          if (trimmed.startsWith('ERR ')) {
            socket.removeListener('data', onData)
            reject(new Error(trimmed.slice(4)))
            return
          }
          lines.push(trimmed)
          if (endPattern.test(trimmed)) {
            socket.removeListener('data', onData)
            resolve(lines)
            return
          }
        }
      }

      socket.on('data', onData)
      socket.write(command + '\n')
    })
  }

  async _auth(socket) {
    if (this.username) assertNutSecret(this.username, 'NUT username')
    if (this.password) assertNutSecret(this.password, 'NUT password')
    if (this.username) await this._request(socket, `USERNAME ${this.username}`, /^OK/)
    if (this.password) await this._request(socket, `PASSWORD ${this.password}`, /^OK/)
  }

  async listVars(upsName) {
    assertNutToken(upsName, 'UPS name')
    const socket = await this._connect()
    try {
      await this._auth(socket)
      const lines = await this._request(socket, `LIST VAR ${upsName}`, /^END LIST VAR/)
      const vars = {}
      for (const line of lines) {
        const m = line.match(/^VAR \S+ (\S+) "(.+)"$/)
        if (m) vars[m[1]] = m[2]
      }
      return vars
    } finally {
      socket.destroy()
    }
  }

  async listCommands(upsName) {
    assertNutToken(upsName, 'UPS name')
    const socket = await this._connect()
    try {
      await this._auth(socket)
      const lines = await this._request(socket, `LIST CMD ${upsName}`, /^END LIST CMD/)
      return lines
        .filter(l => l.startsWith(`CMD ${upsName} `))
        .map(l => l.slice(`CMD ${upsName} `.length).trim())
    } finally {
      socket.destroy()
    }
  }

  async listRWVars(upsName) {
    assertNutToken(upsName, 'UPS name')
    const socket = await this._connect()
    try {
      await this._auth(socket)
      const lines = await this._request(socket, `LIST RW ${upsName}`, /^END LIST RW/)
      const vars = {}
      for (const line of lines) {
        const m = line.match(/^RW \S+ (\S+) "(.+)"$/)
        if (m) vars[m[1]] = m[2]
      }
      return vars
    } finally {
      socket.destroy()
    }
  }

  async runCommand(upsName, command) {
    assertNutToken(upsName, 'UPS name')
    assertNutToken(command, 'NUT command')
    const socket = await this._connect()
    try {
      await this._auth(socket)
      await this._request(socket, `INSTCMD ${upsName} ${command}`, /^OK/)
      return true
    } finally {
      socket.destroy()
    }
  }

  async setVar(upsName, varName, value) {
    assertNutToken(upsName, 'UPS name')
    assertNutToken(varName, 'NUT variable')
    const escapedValue = escapeNutQuotedValue(value)
    const socket = await this._connect()
    try {
      await this._auth(socket)
      await this._request(socket, `SET VAR ${upsName} ${varName} "${escapedValue}"`, /^OK/)
      return true
    } finally {
      socket.destroy()
    }
  }
}

function getClient(device) {
  return new NutClient(device.host, device.port, device.nutUsername, device.nutPassword)
}

async function pollDevice(host, port, upsName, username, password) {
  const client = new NutClient(host, port, username, password)
  return client.listVars(upsName)
}

module.exports = { pollDevice, getClient, NutClient }
