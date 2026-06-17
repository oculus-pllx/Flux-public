const installJobService = require('../services/installJobService')

describe('installJobService', () => {
  it('creates a job with done=false', () => {
    const jobId = installJobService.createJob(42)
    const job = installJobService.getJob(jobId)
    expect(job).not.toBeNull()
    expect(job.done).toBe(false)
    expect(job.machineId).toBe(42)
    expect(job.chunks).toEqual([])
  })

  it('appendChunk accumulates text', () => {
    const jobId = installJobService.createJob(1)
    installJobService.appendChunk(jobId, 'hello ')
    installJobService.appendChunk(jobId, 'world\n')
    const job = installJobService.getJob(jobId)
    expect(job.chunks.join('')).toBe('hello world\n')
  })

  it('finishJob marks done + success', () => {
    const jobId = installJobService.createJob(2)
    installJobService.finishJob(jobId, { success: true })
    const job = installJobService.getJob(jobId)
    expect(job.done).toBe(true)
    expect(job.success).toBe(true)
    expect(job.error).toBeNull()
  })

  it('finishJob marks done + error', () => {
    const jobId = installJobService.createJob(3)
    installJobService.finishJob(jobId, { success: false, error: 'SSH timeout' })
    const job = installJobService.getJob(jobId)
    expect(job.done).toBe(true)
    expect(job.success).toBe(false)
    expect(job.error).toBe('SSH timeout')
  })

  it('returns null for unknown jobId', () => {
    expect(installJobService.getJob('not-a-real-id')).toBeNull()
  })
})
