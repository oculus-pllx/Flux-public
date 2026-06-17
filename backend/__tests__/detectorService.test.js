process.env.JWT_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'

const { sequelize } = require('../config/database')
const Setting = require('../models/Setting')

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })

// We test the pure classify() function, not the shell exec
const { classify } = require('../services/detectorService')

describe('detectorService.classify', () => {
  it('identifies docker-on-pve-vm', () => {
    const profile = classify({ dockerenv: true, virt: 'kvm', pveManager: false, pbs: false, nutServer: false })
    expect(profile).toBe('docker-on-pve-vm')
  })

  it('identifies pve-node', () => {
    const profile = classify({ dockerenv: false, virt: 'none', pveManager: true, pbs: false, nutServer: false })
    expect(profile).toBe('pve-node')
  })

  it('identifies vm-on-pve when virt is kvm and pve reachable but no dockerenv', () => {
    const profile = classify({ dockerenv: false, virt: 'kvm', pveManager: false, pbs: false, nutServer: false })
    expect(profile).toBe('vm-on-pve')
  })

  it('identifies physical', () => {
    const profile = classify({ dockerenv: false, virt: 'none', pveManager: false, pbs: false, nutServer: false })
    expect(profile).toBe('physical')
  })

  it('identifies pbs', () => {
    const profile = classify({ dockerenv: false, virt: 'none', pveManager: false, pbs: true, nutServer: false })
    expect(profile).toBe('pbs')
  })
})
