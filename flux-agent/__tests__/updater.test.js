jest.mock('https')
jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
}))

const https = require('https')
const { execFile } = require('child_process')
const fs = require('fs')

describe('updater', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  describe('download', () => {
    it('writes downloaded content to dest file', async () => {
      jest.mock('https')
      jest.mock('child_process', () => ({ execFile: jest.fn() }))
      const mockWriteStream = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        close: jest.fn(),
      }
      // Simulate 'finish' event to resolve promise
      mockWriteStream.on.mockImplementation((ev, h) => { if (ev === 'finish') h() })
      const fsMock = require('fs')
      fsMock.createWriteStream.mockReturnValue(mockWriteStream)
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            headers: {},
            on: jest.fn(),
            pipe: jest.fn((ws) => { setTimeout(() => ws.on.mock.calls.find(([ev]) => ev === 'finish')?.[1]?.(), 0) })
          }
          cb(res)
        })
        return mockReq
      })
      const { download } = require('../services/updater')
      await download('https://example.com/flux-agent.tar.gz', '/tmp/flux-agent-update.tgz')
      expect(fsMock.createWriteStream).toHaveBeenCalledWith('/tmp/flux-agent-update.tgz')
    })

    it('follows a redirect to the final download URL', async () => {
      jest.mock('https')
      jest.mock('child_process', () => ({ execFile: jest.fn() }))
      const mockWriteStream = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        close: jest.fn(),
      }
      mockWriteStream.on.mockImplementation((ev, h) => { if (ev === 'finish') h() })
      const fsMock = require('fs')
      fsMock.createWriteStream.mockReturnValue(mockWriteStream)
      const https2 = require('https')

      const mockReq = { on: jest.fn(), end: jest.fn() }
      // First call: 302 redirect
      https2.request
        .mockImplementationOnce((opts, cb) => {
          process.nextTick(() => {
            const res = {
              statusCode: 302,
              headers: { location: 'https://s3.amazonaws.com/actual-asset.tgz' },
              on: jest.fn(),
              pipe: jest.fn(),
            }
            cb(res)
          })
          return mockReq
        })
        // Second call: 200 actual download
        .mockImplementationOnce((opts, cb) => {
          process.nextTick(() => {
            const res = {
              statusCode: 200,
              headers: {},
              on: jest.fn(),
              pipe: jest.fn((ws) => { setTimeout(() => ws.on.mock.calls.find(([ev]) => ev === 'finish')?.[1]?.(), 0) }),
            }
            cb(res)
          })
          return mockReq
        })

      const { download } = require('../services/updater')
      await download('https://github.com/example/asset.tgz', '/tmp/flux-agent-update.tgz')
      expect(https2.request).toHaveBeenCalledTimes(2)
      expect(fsMock.createWriteStream).toHaveBeenCalledWith('/tmp/flux-agent-update.tgz')
    })
  })

  describe('apply', () => {
    it('runs tar xzf to extract tarball to installDir', async () => {
      jest.mock('https')
      jest.mock('child_process', () => ({ execFile: jest.fn() }))
      jest.mock('fs', () => ({ createWriteStream: jest.fn(), existsSync: jest.fn().mockReturnValue(true) }))
      const { execFile: execFileMock } = require('child_process')
      execFileMock.mockImplementation((cmd, args, cb) => cb(null, '', ''))
      const { apply } = require('../services/updater')
      await apply('/tmp/flux-agent-update.tgz', '/opt/flux-agent')
      expect(execFileMock).toHaveBeenCalledWith(
        'tar',
        expect.arrayContaining(['xzf', '/tmp/flux-agent-update.tgz', '-C', '/opt/flux-agent']),
        expect.any(Function)
      )
    })

    it('rejects when tar fails', async () => {
      jest.mock('https')
      jest.mock('child_process', () => ({ execFile: jest.fn() }))
      jest.mock('fs', () => ({ createWriteStream: jest.fn(), existsSync: jest.fn().mockReturnValue(true) }))
      const { execFile: execFileMock } = require('child_process')
      execFileMock.mockImplementation((cmd, args, cb) => cb(new Error('tar: not found'), '', ''))
      const { apply } = require('../services/updater')
      await expect(apply('/tmp/flux-agent-update.tgz', '/opt/flux-agent')).rejects.toThrow('tar: not found')
    })
  })
})
