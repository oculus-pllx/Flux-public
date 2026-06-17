const nodemailer = require('nodemailer')

async function getConfig() {
  try {
    const Setting = require('../models/Setting')
    const rows = await Setting.findAll()
    const db = Object.fromEntries(rows.map(r => [r.key, r.value]))
    return {
      host:      db.smtp_host      || process.env.SMTP_HOST,
      port:      parseInt(db.smtp_port || process.env.SMTP_PORT) || 587,
      secure:    (db.smtp_secure   || process.env.SMTP_SECURE) === 'true',
      user:      db.smtp_user      || process.env.SMTP_USER,
      pass:      db.smtp_pass      || process.env.SMTP_PASS,
      from:      db.smtp_from      || process.env.EMAIL_FROM,
      recipient: db.smtp_recipient || db.smtp_user || process.env.SMTP_USER,
    }
  } catch (err) {
    console.warn('[emailService] DB config read failed, falling back to env:', err.message)
    return {
      host:      process.env.SMTP_HOST,
      port:      parseInt(process.env.SMTP_PORT) || 587,
      secure:    process.env.SMTP_SECURE === 'true',
      user:      process.env.SMTP_USER,
      pass:      process.env.SMTP_PASS,
      from:      process.env.EMAIL_FROM,
      recipient: process.env.SMTP_USER,
    }
  }
}

// Cached transport — recreated only when config changes
let _transport = null
let _transportKey = null

function getTransport(cfg) {
  const key = JSON.stringify({ host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass })
  if (!_transport || key !== _transportKey) {
    _transport    = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } })
    _transportKey = key
  }
  return _transport
}

async function sendAlert({ message, severity, deviceId, deviceName, recovered = false }) {
  const cfg = await getConfig()
  if (!cfg.host || !cfg.user) {
    console.warn('Email not configured, skipping alert email')
    return
  }
  const transport = getTransport(cfg)
  const name    = deviceName || `Device ${deviceId}`
  const subject = recovered
    ? `[Flux Recovered] ${name}`
    : `[Flux Alert] ${severity.toUpperCase()}: ${name}`
  await transport.sendMail({ from: cfg.from || cfg.user, to: cfg.recipient, subject, text: message })
}

async function sendTestEmail() {
  const cfg = await getConfig()
  if (!cfg.host || !cfg.user) throw new Error('SMTP not configured — set host and username in Settings')
  const transport = getTransport(cfg)
  await transport.sendMail({
    from: cfg.from || cfg.user,
    to: cfg.recipient,
    subject: '[Flux] Test Email',
    text: 'This is a test email from Flux. Your alert email configuration is working correctly.',
  })
}

module.exports = { sendAlert, sendTestEmail }
