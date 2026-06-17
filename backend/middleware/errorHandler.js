function errorHandler(err, req, res, next) {
  console.error(err.stack)
  const status = err.status || 500
  const isProd  = process.env.NODE_ENV === 'production'
  const message = (status < 500 || !isProd)
    ? (err.message || 'Internal server error')
    : 'Internal server error'
  res.status(status).json({ error: message })
}

module.exports = errorHandler
