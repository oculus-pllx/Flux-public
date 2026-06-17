const jwt = require('jsonwebtoken')

function extractToken(req, { allowQueryToken = false } = {}) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  if (allowQueryToken && req.query.token) return req.query.token
  return null
}

// Standard auth — Bearer header only. No query string tokens (leak into logs).
function authenticate(req, res, next) {
  const raw = extractToken(req)
  if (!raw) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(raw, process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// For SSE and file-download endpoints where browsers can't set headers.
function authenticateQueryToken(req, res, next) {
  const raw = extractToken(req, { allowQueryToken: true })
  if (!raw) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(raw, process.env.JWT_SECRET)
    // Strip token from query so it doesn't appear in downstream logging
    delete req.query.token
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

module.exports = { authenticate, authenticateQueryToken, requireRole }
