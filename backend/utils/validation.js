function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

function optionalString(value) {
  return value === undefined || value === null || value === ''
}

function assertNoControl(value, label) {
  if (typeof value !== 'string') throw badRequest(`${label} must be a string`)
  if (/[\r\n\0]/.test(value)) throw badRequest(`${label} cannot contain control characters`)
}

function assertNutToken(value, label) {
  assertNoControl(value, label)
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw badRequest(`${label} may only contain letters, numbers, dot, underscore, colon, or dash`)
  }
}

function assertNutSecret(value, label) {
  if (optionalString(value)) return
  assertNoControl(value, label)
  if (/\s/.test(value)) throw badRequest(`${label} cannot contain whitespace`)
}

function escapeNutQuotedValue(value) {
  const text = String(value)
  assertNoControl(text, 'NUT value')
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function assertHost(value, label = 'Host') {
  assertNoControl(value, label)
  if (value.length > 253 || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw badRequest(`${label} must be a hostname or IP address`)
  }
}

function assertIntegerRange(value, label, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(`${label} must be an integer between ${min} and ${max}`)
  }
  return number
}

function shellQuote(value) {
  const text = String(value)
  assertNoControl(text, 'Shell value')
  return `'${text.replace(/'/g, "'\\''")}'`
}

function escapeUpsmonQuoted(value) {
  const text = String(value)
  assertNoControl(text, 'upsmon value')
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

module.exports = {
  badRequest,
  optionalString,
  assertNoControl,
  assertNutToken,
  assertNutSecret,
  escapeNutQuotedValue,
  assertHost,
  assertIntegerRange,
  shellQuote,
  escapeUpsmonQuoted,
}
