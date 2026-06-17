const crypto = require('crypto')

// jobId → { chunks, done, success, error, machineId }
const jobs = new Map()

function createJob(machineId) {
  const jobId = crypto.randomUUID()
  jobs.set(jobId, { chunks: [], done: false, success: false, error: null, machineId })
  // Auto-cleanup after 1 hour
  setTimeout(() => jobs.delete(jobId), 60 * 60 * 1000).unref()
  return jobId
}

function appendChunk(jobId, text) {
  const job = jobs.get(jobId)
  if (job && !job.done) job.chunks.push(text)
}

function finishJob(jobId, { success, error }) {
  const job = jobs.get(jobId)
  if (!job) return
  job.done = true
  job.success = success
  job.error = error || null
}

function getJob(jobId) {
  return jobs.get(jobId) || null
}

module.exports = { createJob, appendChunk, finishJob, getJob }
