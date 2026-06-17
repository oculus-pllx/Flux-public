const https = require('https')

function getLatestRelease(repo) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'flux-server',
        Accept: 'application/vnd.github.v3+json',
      },
    }
    const req = https.request(opts, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API returned ${res.statusCode}`))
        }
        try {
          const body = JSON.parse(raw)
          resolve({
            tag: body.tag_name,
            version: String(body.tag_name || '').replace(/^v/, ''),
            publishedAt: body.published_at || null,
            notes: body.body || '',
            assets: body.assets || [],
          })
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Numeric per-segment comparison: >0 if a newer than b, <0 if older, 0 if equal
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

module.exports = { getLatestRelease, compareVersions }
