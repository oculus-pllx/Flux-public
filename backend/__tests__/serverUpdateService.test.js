const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('../services/githubService', () => ({
  getLatestRelease: jest.fn(),
  compareVersions: jest.requireActual('../services/githubService').compareVersions,
}))

let tmpDir

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-upd-'))
  process.env.FLUX_UPDATE_DIR = tmpDir
  delete process.env.FLUX_UPDATE_MODE
  delete process.env.UPDATER_TOKEN
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.FLUX_UPDATE_DIR
})

function svc() { return require('../services/serverUpdateService') }
function gh() { return require('../services/githubService') }

describe('detectMode', () => {
  it('FLUX_UPDATE_MODE override wins', () => {
    process.env.FLUX_UPDATE_MODE = 'docker'
    expect(svc().detectMode()).toBe('docker')
  })

  it('systemd when updater marker present', () => {
    fs.writeFileSync(path.join(tmpDir, '.updater-installed'), '')
    expect(svc().detectMode()).toBe('systemd')
  })

  it('manual when nothing present', () => {
    expect(svc().detectMode()).toBe('manual')
  })
})

describe('getStatus', () => {
  it('updateAvailable false when latest release is OLDER than current (no downgrades)', async () => {
    gh().getLatestRelease.mockResolvedValue({ tag: 'v1.0.1', version: '1.0.1', publishedAt: null, notes: '', assets: [] })
    const s = await svc().getStatus()
    expect(s.updateAvailable).toBe(false)
    expect(s.currentVersion).toBeDefined()
    expect(s.latestVersion).toBe('1.0.1')
  })

  it('reports updateAvailable and notes for a newer release', async () => {
    gh().getLatestRelease.mockResolvedValue({ tag: 'v99.0.0', version: '99.0.0', publishedAt: '2026-06-01T00:00:00Z', notes: 'big', assets: [] })
    const s = await svc().getStatus()
    expect(s).toMatchObject({ updateAvailable: true, latestVersion: '99.0.0', notes: 'big' })
  })

  it('caches the GitHub response across calls', async () => {
    gh().getLatestRelease.mockResolvedValue({ tag: 'v99.0.0', version: '99.0.0', publishedAt: null, notes: '', assets: [] })
    const s = svc()
    await s.getStatus()
    await s.getStatus()
    expect(gh().getLatestRelease).toHaveBeenCalledTimes(1)
  })

  it('GitHub failure degrades to error field, never throws', async () => {
    gh().getLatestRelease.mockRejectedValue(new Error('boom'))
    const s = await svc().getStatus()
    expect(s.updateAvailable).toBe(false)
    expect(s.error).toBe('boom')
  })
})

describe('applyUpdate', () => {
  it('systemd mode writes trigger file + requested status', async () => {
    fs.writeFileSync(path.join(tmpDir, '.updater-installed'), '')
    const r = await svc().applyUpdate()
    expect(r).toMatchObject({ started: true, mode: 'systemd' })
    expect(fs.existsSync(path.join(tmpDir, 'update-requested'))).toBe(true)
    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'update-status.json'), 'utf8'))
    expect(status.state).toBe('requested')
  })

  it('manual mode rejects with status 400', async () => {
    await expect(svc().applyUpdate()).rejects.toMatchObject({ status: 400 })
  })
})

describe('getUpdateLog (systemd)', () => {
  it('returns status json + log tail', async () => {
    fs.writeFileSync(path.join(tmpDir, '.updater-installed'), '')
    fs.writeFileSync(path.join(tmpDir, 'update-status.json'), '{"state":"success"}')
    fs.writeFileSync(path.join(tmpDir, 'update.log'), 'line1\nline2\n')
    const r = await svc().getUpdateLog()
    expect(r.state).toBe('success')
    expect(r.log).toContain('line2')
  })

  it('returns idle state when no update has ever run', async () => {
    fs.writeFileSync(path.join(tmpDir, '.updater-installed'), '')
    const r = await svc().getUpdateLog()
    expect(r.state).toBe('idle')
    expect(r.log).toBe('')
  })
})
