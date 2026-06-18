const fs = require('fs')
const path = require('path')

describe('Linux installer build script', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../../installer/linux/build-deb.sh'), 'utf8')

  it('packages the agent bootstrap script and tarball served by backend/server.js', () => {
    expect(script).toContain('install-agent.sh')
    expect(script).toContain('install-agent.tar.gz')
    expect(script).toContain('flux-agent')
  })
})
