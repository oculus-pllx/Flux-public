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
  beforeEach(() => jest.clearAllMocks())

  describe('getLatestRelease', () => {
    it('parses tag, version, notes, publishedAt, and assets', async () => {
      mockGitHubResponse(200, {
        tag_name: 'v2.1.0',
        body: 'notes here',
        published_at: '2026-06-01T00:00:00Z',
        assets: [{ name: 'flux-agent-2.1.0.tar.gz', browser_download_url: 'https://x/y.tar.gz' }],
      })
      const r = await getLatestRelease('oculus-pllx/Flux')
      expect(r).toMatchObject({
        tag: 'v2.1.0',
        version: '2.1.0',
        notes: 'notes here',
        publishedAt: '2026-06-01T00:00:00Z',
      })
      expect(r.assets).toHaveLength(1)
    })

    it('rejects on non-200', async () => {
      mockGitHubResponse(404, '{}')
      await expect(getLatestRelease('oculus-pllx/Flux')).rejects.toThrow('GitHub API returned 404')
    })

    it('requests the repo it was given', async () => {
      mockGitHubResponse(200, { tag_name: 'v1.0.0', assets: [] })
      await getLatestRelease('someone/SomeRepo')
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/repos/someone/SomeRepo/releases/latest' }),
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
