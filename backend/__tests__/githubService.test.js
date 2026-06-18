jest.mock('https')

const https = require('https')

// Helper: simulate a GitHub API HTTP response (same pattern as agentUpdateService.test.js)
function mockGitHubResponse(statusCode, body) {
  const mockReq = { on: jest.fn(), end: jest.fn() }
  https.request.mockImplementationOnce((opts, cb) => {
    process.nextTick(() => {
      const res = {
        statusCode,
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(typeof body === 'string' ? body : JSON.stringify(body))
          if (event === 'end') handler()
        }),
      }
      cb(res)
    })
    return mockReq
  })
}

const { getLatestRelease, compareVersions } = require('../services/githubService')

describe('githubService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
  })

  describe('getLatestRelease', () => {
    it('parses tag, version, notes, publishedAt, and assets', async () => {
      mockGitHubResponse(200, {
        tag_name: 'v2.1.0',
        body: 'notes here',
        published_at: '2026-06-01T00:00:00Z',
        assets: [{ name: 'flux-agent-2.1.0.tar.gz', browser_download_url: 'https://x/y.tar.gz' }],
      })
      const r = await getLatestRelease('oculus-pllx/Flux-Controller')
      expect(r).toMatchObject({
        tag: 'v2.1.0',
        version: '2.1.0',
        notes: 'notes here',
        publishedAt: '2026-06-01T00:00:00Z',
      })
      expect(r.assets).toHaveLength(1)
    })

    it('rejects on non-200 with statusCode on the error', async () => {
      mockGitHubResponse(404, '{}')
      await expect(getLatestRelease('oculus-pllx/Flux-Controller')).rejects.toMatchObject({
        message: 'GitHub API returned 404',
        statusCode: 404,
      })
    })

    it('requests the repo it was given', async () => {
      mockGitHubResponse(200, { tag_name: 'v1.0.0', assets: [] })
      await getLatestRelease('someone/SomeRepo')
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/repos/someone/SomeRepo/releases/latest' }),
        expect.any(Function),
      )
    })

    it('uses a GitHub token when one is configured', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token'
      mockGitHubResponse(200, { tag_name: 'v1.0.0', assets: [] })
      await getLatestRelease('someone/PrivateRepo')
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer ghp_test_token' }),
        }),
        expect.any(Function),
      )
    })
  })

  describe('compareVersions', () => {
    it('orders numerically per segment', () => {
      expect(compareVersions('2.1.0', '2.0.0')).toBeGreaterThan(0)
      expect(compareVersions('1.0.1', '2.0.0')).toBeLessThan(0) // old release < current → no downgrade
      expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
      expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
    })
  })
})
