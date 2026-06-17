const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('../services/sequencer', () => ({
  runShutdownSequence: jest.fn().mockResolvedValue(),
}))

const { runShutdownSequence } = require('../services/sequencer')
const scheduler = require('../services/shutdown-scheduler')

describe('shutdown scheduler', () => {
  let tmp
  let send
  const cfg = { machineKey: 'mk-1', role: 'controlled' }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-17T20:00:00.000Z'))
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-shutdown-'))
    send = jest.fn()
    runShutdownSequence.mockClear()
  })

  afterEach(() => {
    scheduler.clearForTest()
    jest.useRealTimers()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function statePath() {
    return path.join(tmp, 'pending-shutdown.json')
  }

  it('persists a scheduled shutdown and executes at the absolute deadline', async () => {
    await scheduler.scheduleShutdown({
      message: {
        type: 'schedule-shutdown',
        shutdownId: 'sd-1',
        deviceId: 7,
        reason: 'ups-critical',
        executeAt: '2026-06-17T20:00:05.000Z',
        delaySeconds: 5,
      },
      cfg,
      send,
      stateFile: statePath(),
    })

    expect(JSON.parse(fs.readFileSync(statePath(), 'utf8'))).toMatchObject({
      shutdownId: 'sd-1',
      deviceId: 7,
      executeAt: '2026-06-17T20:00:05.000Z',
    })
    expect(send).toHaveBeenCalledWith({ type: 'shutdown-scheduled', machineKey: 'mk-1', shutdownId: 'sd-1' })

    jest.advanceTimersByTime(4999)
    expect(runShutdownSequence).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    await Promise.resolve()
    expect(runShutdownSequence).toHaveBeenCalledWith({
      role: 'controlled',
      cfg,
      send,
      shutdown: expect.objectContaining({ shutdownId: 'sd-1', deviceId: 7 }),
    })
    expect(fs.existsSync(statePath())).toBe(false)
  })

  it('reloads a pending shutdown after restart and executes remaining delay', async () => {
    fs.writeFileSync(statePath(), JSON.stringify({
      shutdownId: 'sd-2',
      deviceId: 8,
      reason: 'ups-critical',
      executeAt: '2026-06-17T20:00:03.000Z',
    }))

    await scheduler.loadPendingShutdown({ cfg, send, stateFile: statePath() })

    jest.advanceTimersByTime(3000)
    await Promise.resolve()
    expect(runShutdownSequence).toHaveBeenCalledWith({
      role: 'controlled',
      cfg,
      send,
      shutdown: expect.objectContaining({ shutdownId: 'sd-2', deviceId: 8 }),
    })
  })

  it('cancels a matching pending shutdown and deletes local state', async () => {
    await scheduler.scheduleShutdown({
      message: {
        shutdownId: 'sd-3',
        deviceId: 9,
        reason: 'ups-critical',
        executeAt: '2026-06-17T20:00:05.000Z',
      },
      cfg,
      send,
      stateFile: statePath(),
    })

    const cancelled = await scheduler.cancelShutdown({
      message: { type: 'cancel-shutdown', shutdownId: 'sd-3', deviceId: 9, reason: 'power-restored' },
      cfg,
      send,
      stateFile: statePath(),
    })

    expect(cancelled).toBe(true)
    expect(fs.existsSync(statePath())).toBe(false)
    expect(send).toHaveBeenCalledWith({ type: 'shutdown-cancelled', machineKey: 'mk-1', shutdownId: 'sd-3' })

    jest.advanceTimersByTime(5000)
    await Promise.resolve()
    expect(runShutdownSequence).not.toHaveBeenCalled()
  })

  it('does not cancel a different pending shutdown', async () => {
    await scheduler.scheduleShutdown({
      message: {
        shutdownId: 'sd-4',
        deviceId: 10,
        reason: 'ups-critical',
        executeAt: '2026-06-17T20:00:05.000Z',
      },
      cfg,
      send,
      stateFile: statePath(),
    })

    const cancelled = await scheduler.cancelShutdown({
      message: { type: 'cancel-shutdown', shutdownId: 'other', deviceId: 10, reason: 'power-restored' },
      cfg,
      send,
      stateFile: statePath(),
    })

    expect(cancelled).toBe(false)
    expect(fs.existsSync(statePath())).toBe(true)
    expect(send).toHaveBeenCalledWith({
      type: 'shutdown-cancel-ignored',
      machineKey: 'mk-1',
      shutdownId: 'other',
      pendingShutdownId: 'sd-4',
    })
  })
})
