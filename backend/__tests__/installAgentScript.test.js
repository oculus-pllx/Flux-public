const fs = require('fs')
const path = require('path')

describe('install-agent.sh', () => {
  const scriptPath = path.resolve(__dirname, '../../install-agent.sh')

  it('restarts an existing agent after writing a fresh config', () => {
    const script = fs.readFileSync(scriptPath, 'utf8')
    const writeConfigIndex = script.indexOf('cat > "${CONFIG_DIR}/config.json"')
    const enrollIndex = script.indexOf('info "Enrolling with Flux server..."')
    const restartIndex = script.indexOf('systemctl restart "${SERVICE_NAME}"')
    const startIndex = script.indexOf('systemctl start "${SERVICE_NAME}"')

    expect(writeConfigIndex).toBeGreaterThan(-1)
    expect(enrollIndex).toBeGreaterThan(writeConfigIndex)
    expect(restartIndex).toBeGreaterThan(enrollIndex)
    expect(startIndex).toBe(-1)
  })
})
