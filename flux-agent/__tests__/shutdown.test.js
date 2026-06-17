const mockExec = jest.fn()
jest.mock('child_process', () => ({ exec: mockExec }))
const { exec } = require('child_process')

describe('shutdown', () => {
  beforeEach(() => {
    exec.mockReset()
    exec.mockImplementation((cmd, cb) => cb(null))
  })

  it('calls shutdown -h now on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    jest.resetModules()
    const { executeShutdown } = require('../services/shutdown')
    await executeShutdown(0)
    expect(exec).toHaveBeenCalledWith(expect.stringContaining('shutdown'), expect.any(Function))
    const cmd = exec.mock.calls[0][0]
    expect(cmd).toMatch(/shutdown/)
  })

  it('calls shutdown /s on Windows', async () => {
    jest.useFakeTimers()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    jest.resetModules()
    const { executeShutdown } = require('../services/shutdown')
    const promise = executeShutdown(30)
    jest.advanceTimersByTime(30000)
    await promise
    const cmd = exec.mock.calls[0][0]
    expect(cmd).toContain('/s')
    expect(cmd).toContain('/t 0')
    jest.useRealTimers()
  })

  it('schedules shutdown after delaySeconds', async () => {
    jest.useFakeTimers()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    jest.resetModules()
    const { executeShutdown } = require('../services/shutdown')
    const promise = executeShutdown(5)
    expect(exec).not.toHaveBeenCalled()
    jest.advanceTimersByTime(5000)
    await promise
    expect(exec).toHaveBeenCalled()
    jest.useRealTimers()
  })
})
