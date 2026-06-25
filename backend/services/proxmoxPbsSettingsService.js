function redactConfig(row) {
  const json = row && row.toJSON ? row.toJSON() : { ...(row || {}) }
  const hasTokenSecret = !!json.tokenSecret
  delete json.tokenSecret
  return { ...json, hasTokenSecret }
}

function stripBlankSecret(fields) {
  const updates = { ...fields }
  if (updates.tokenSecret === '') delete updates.tokenSecret
  return updates
}

module.exports = {
  redactConfig,
  stripBlankSecret,
}
