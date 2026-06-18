// Mocks must be set up before any require()
jest.mock('https')
jest.mock('../models/AgentMachine')
jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))

const https = require('https')
const AgentMachine = require('../models/AgentMachine')
const agentHub = require('../services/agentHub')

// Helper: simulate a GitHub API HTTP response
function mockGitHubResponse(statusCode, body) {
  const mockReq = { on: jest.fn(), end: jest.fn() }
  https.request.mockImplementationOnce((opts, cb) => {
    process.nextTick(() => {
      const res = {
        statusCode,
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(JSON.stringify(body))
          if (event === 'end') handler()
        }),
      }
      cb(res)
    })
    return mockReq
  })
}

const RELEASE = {
  tag_name: 'v9.9.9',
  assets: [{
    name: 'flux-agent-9.9.9.tar.gz',
    browser_download_url: 'https://github.com/oculus-pllx/Flux-public/releases/download/v9.9.9/flux-agent-9.9.9.tar.gz',
  }],
}

describe('agentUpdateService', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    delete process.env.FLUX_GITHUB_REPO
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
  })

  describe('getLatestRelease', () => {
    it('parses tag, version, and assetUrl from a GitHub release response', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(RELEASE)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const { getLatestRelease } = require('../services/agentUpdateService')
      const result = await getLatestRelease()
      expect(result.tag).toBe('v9.9.9')
      expect(result.version).toBe('9.9.9')
      expect(result.assetUrl).toContain('flux-agent-9.9.9.tar.gz')
    })

    it('rejects when GitHub returns non-200', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 403,
            on: jest.fn((ev, h) => { if (ev === 'data') h('{}'); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const { getLatestRelease } = require('../services/agentUpdateService')
      await expect(getLatestRelease()).rejects.toThrow('403')
    })

    it('rejects when no agent tarball asset is in the release', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => {
              if (ev === 'data') h(JSON.stringify({ tag_name: 'v9.9.9', assets: [] }))
              if (ev === 'end') h()
            }),
          }
          cb(res)
        })
        return mockReq
      })
      const { getLatestRelease } = require('../services/agentUpdateService')
      await expect(getLatestRelease()).rejects.toThrow('No flux-agent tarball')
    })

    it('uses FLUX_GITHUB_REPO when checking for agent releases', async () => {
      process.env.FLUX_GITHUB_REPO = 'oculus-pllx/Flux-private'
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(RELEASE)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const { getLatestRelease } = require('../services/agentUpdateService')
      await getLatestRelease()
      expect(https2.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/repos/oculus-pllx/Flux-private/releases/latest' }),
        expect.any(Function),
      )
    })
  })

  describe('checkAndNotify', () => {
    it('transitions online agents to update-available and sends WS message', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const AM = require('../models/AgentMachine')
      const hub = require('../services/agentHub')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(RELEASE)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const mockAgent = { machineKey: 'mk-1', update: jest.fn().mockResolvedValue() }
      AM.findAll = jest.fn().mockResolvedValue([mockAgent])
      hub.sendToMachine.mockReturnValue(true)

      const { checkAndNotify } = require('../services/agentUpdateService')
      await checkAndNotify()

      expect(mockAgent.update).toHaveBeenCalledWith({
        state: 'update-available',
        stateDetail: expect.stringContaining('9.9.9'),
      })
      expect(hub.sendToMachine).toHaveBeenCalledWith('mk-1', expect.objectContaining({
        type: 'update-available',
        version: '9.9.9',
        assetUrl: expect.stringContaining('flux-agent-9.9.9.tar.gz'),
      }))
    })

    it('does nothing when already up to date', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const AM = require('../models/AgentMachine')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      // Return the SAME version as CURRENT_VERSION (from package.json)
      const current = require('../package.json').version
      const upToDateRelease = {
        tag_name: `v${current}`,
        assets: [{ name: `flux-agent-${current}.tar.gz`, browser_download_url: 'https://github.com/...' }],
      }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(upToDateRelease)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      AM.findAll = jest.fn()

      const { checkAndNotify } = require('../services/agentUpdateService')
      await checkAndNotify()

      expect(AM.findAll).not.toHaveBeenCalled()
    })

    it('does not throw when GitHub API fails', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = {
        on: jest.fn((ev, h) => { if (ev === 'error') h(new Error('network error')) }),
        end: jest.fn(),
      }
      https2.request.mockImplementationOnce((opts, cb) => mockReq)

      const { checkAndNotify } = require('../services/agentUpdateService')
      // Should resolve without throwing (errors are swallowed)
      await expect(checkAndNotify()).resolves.not.toThrow()
    })

    it('does not log a failed update check error for private repo 404s without a GitHub token', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 404,
            on: jest.fn((ev, h) => { if (ev === 'data') h('{}'); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})

      const { checkAndNotify } = require('../services/agentUpdateService')
      await expect(checkAndNotify()).resolves.not.toThrow()

      expect(errorSpy).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('GitHub release check unavailable'))
      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('does not log a failed update check error when the release has no agent tarball', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => {
              if (ev === 'data') h(JSON.stringify({ tag_name: 'v9.9.9', assets: [{ name: 'flux_9.9.9_amd64.deb' }] }))
              if (ev === 'end') h()
            }),
          }
          cb(res)
        })
        return mockReq
      })
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})

      const { checkAndNotify } = require('../services/agentUpdateService')
      await expect(checkAndNotify()).resolves.not.toThrow()

      expect(errorSpy).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('No flux-agent tarball asset found'))
      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })
  })

  describe('triggerUpdate', () => {
    it('sends update message, transitions state to updating, returns { sent: true }', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const AM = require('../models/AgentMachine')
      const hub = require('../services/agentHub')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(RELEASE)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      const mockMachine = { machineKey: 'mk-2', update: jest.fn().mockResolvedValue() }
      AM.findByPk = jest.fn().mockResolvedValue(mockMachine)
      hub.sendToMachine.mockReturnValue(true)

      const { triggerUpdate } = require('../services/agentUpdateService')
      const result = await triggerUpdate(1)

      expect(hub.sendToMachine).toHaveBeenCalledWith('mk-2', expect.objectContaining({ type: 'update' }))
      expect(mockMachine.update).toHaveBeenCalledWith({ state: 'updating', stateDetail: 'Update triggered' })
      expect(result).toEqual({ sent: true })
    })

    it('throws 409 when agent is not connected', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const https2 = require('https')
      const AM = require('../models/AgentMachine')
      const hub = require('../services/agentHub')
      const mockReq = { on: jest.fn(), end: jest.fn() }
      https2.request.mockImplementationOnce((opts, cb) => {
        process.nextTick(() => {
          const res = {
            statusCode: 200,
            on: jest.fn((ev, h) => { if (ev === 'data') h(JSON.stringify(RELEASE)); if (ev === 'end') h() }),
          }
          cb(res)
        })
        return mockReq
      })
      AM.findByPk = jest.fn().mockResolvedValue({ machineKey: 'mk-offline', update: jest.fn() })
      hub.sendToMachine.mockReturnValue(false)

      const { triggerUpdate } = require('../services/agentUpdateService')
      await expect(triggerUpdate(1)).rejects.toMatchObject({ status: 409 })
    })

    it('throws 404 when machine is not found', async () => {
      jest.mock('https')
      jest.mock('../models/AgentMachine')
      jest.mock('../services/agentHub', () => ({ sendToMachine: jest.fn() }))
      const AM = require('../models/AgentMachine')
      AM.findByPk = jest.fn().mockResolvedValue(null)

      const { triggerUpdate } = require('../services/agentUpdateService')
      await expect(triggerUpdate(99)).rejects.toMatchObject({ status: 404 })
    })
  })
})
