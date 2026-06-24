process.env.DB_PATH = ':memory:'

jest.mock('../services/nutService', () => ({
  pollDevice: jest.fn(),
}))
jest.mock('../services/alertService', () => ({
  evaluate: jest.fn(),
}))
jest.mock('../services/agentHub', () => ({
  notifyShutdown: jest.fn(),
  notifyPowerRestored: jest.fn(),
}))

const { sequelize } = require('../config/database')
const Device = require('../models/Device')
require('../models/Metrics')
const nutService = require('../services/nutService')

beforeAll(async () => { await sequelize.sync({ force: true }) })
afterAll(async () => { await sequelize.close() })
beforeEach(() => jest.clearAllMocks())

describe('pollingService', () => {
  it('marks a device offline when polling fails so stale online data is not shown', async () => {
    const device = await Device.create({
      name: 'Stale UPS',
      host: '10.11.200.24',
      port: 3493,
      upsName: 'apc2200',
      lastSeen: new Date('2026-06-24T19:00:00.000Z'),
      lastStatus: { 'ups.status': 'OL', 'ups.model': 'Old UPS' },
    })
    nutService.pollDevice.mockRejectedValue(new Error('DRIVER-NOT-CONNECTED'))

    const { pollDeviceForTest } = require('../services/pollingService')
    await pollDeviceForTest(device)

    await device.reload()
    expect(device.lastStatus).toEqual({})
    expect(device.nutHealth).toMatchObject({
      state: 'error',
      sourceType: 'unknown',
      message: 'NUT polling failed: DRIVER-NOT-CONNECTED',
    })
    expect(device.lastSeen).toBeNull()
  })
})
