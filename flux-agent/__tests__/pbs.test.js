jest.mock('https')
jest.mock('http')
const https = require('https')
const http = require('http')

function mockRes(statusCode, data) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(JSON.stringify({ data }))
      if (event === 'end') cb()
    }),
  }
}

function setupOnce(statusCode, data) {
  const req = { on: jest.fn(), write: jest.fn(), end: jest.fn() }
  https.request.mockImplementationOnce((opts, cb) => {
    setImmediate(() => cb(mockRes(statusCode, data)))
    return req
  })
  http.request.mockImplementationOnce((opts, cb) => {
    setImmediate(() => cb(mockRes(statusCode, data)))
    return req
  })
}

const PBS_CONFIG = {
  url: 'https://192.168.0.20:8007',
  tokenId: 'flux@pam!t',
  tokenSecret: 'secret',
}

describe('pbs service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('listRunningJobs calls GET /nodes/localhost/tasks?running=1', async () => {
    const jobs = [{ upid: 'UPID:pbs:00001234:backup', type: 'backup' }]
    setupOnce(200, jobs)
    const { listRunningJobs } = require('../services/pbs')
    const result = await listRunningJobs(PBS_CONFIG)
    expect(result).toEqual(jobs)
    const [opts] = https.request.mock.calls[0]
    expect(opts.path).toContain('/nodes/localhost/tasks')
    expect(opts.path).toContain('running=1')
    expect(opts.method).toBe('GET')
  })

  it('abortJob calls POST /nodes/localhost/tasks/{upid}/status', async () => {
    setupOnce(200, null)
    const { abortJob } = require('../services/pbs')
    await abortJob(PBS_CONFIG, 'UPID:pbs:00001234:backup')
    const [opts] = https.request.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(opts.path).toContain('/tasks/')
    expect(opts.path).toContain('/status')
  })

  it('getTaskStatus returns status string', async () => {
    setupOnce(200, { status: 'stopped', upid: 'x' })
    const { getTaskStatus } = require('../services/pbs')
    const status = await getTaskStatus(PBS_CONFIG, 'UPID:pbs:00001234:backup')
    expect(status).toBe('stopped')
  })

  it('abortAllJobs returns {aborted, timedOut} when all jobs stop', async () => {
    const jobs = [{ upid: 'UPID:pbs:001:backup' }, { upid: 'UPID:pbs:002:gc' }]
    setupOnce(200, jobs)           // listRunningJobs
    setupOnce(200, null)           // abortJob 1
    setupOnce(200, null)           // abortJob 2
    setupOnce(200, { status: 'stopped' })  // waitJobStopped 1
    setupOnce(200, { status: 'stopped' })  // waitJobStopped 2
    const { abortAllJobs } = require('../services/pbs')
    const result = await abortAllJobs(PBS_CONFIG)
    expect(result.aborted).toBe(2)
    expect(result.timedOut).toBe(0)
  })

  it('abortAllJobs returns immediately when no jobs are running', async () => {
    setupOnce(200, [])
    const { abortAllJobs } = require('../services/pbs')
    const result = await abortAllJobs(PBS_CONFIG)
    expect(result.aborted).toBe(0)
    expect(result.timedOut).toBe(0)
  })
})
