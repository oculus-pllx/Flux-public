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

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().split('.')[0]
}

function pveApiConfig(cluster) {
  return {
    url: cluster.apiBaseUrl,
    tokenId: cluster.tokenId,
    tokenSecret: cluster.tokenSecret,
  }
}

function buildPveConfig(cluster, node) {
  return {
    url: cluster.apiBaseUrl,
    tokenId: cluster.tokenId,
    tokenSecret: cluster.tokenSecret,
    node,
  }
}

function publicAgent(machine) {
  if (!machine) return null
  return {
    id: machine.id,
    hostname: machine.hostname,
    role: machine.role,
    machineKey: machine.machineKey,
    state: machine.state,
  }
}

function buildNodeMatches(nodes, machines) {
  const eligible = machines.filter((m) => ['pve-node', 'ups-host', 'both'].includes(m.role))
  return nodes.map((entry) => {
    const node = typeof entry === 'string' ? entry : entry.node
    const normalized = normalizeHostname(node)
    const matches = eligible.filter((m) => normalizeHostname(m.hostname) === normalized)
    if (matches.length === 1) {
      return {
        node,
        status: 'matched',
        agent: publicAgent(matches[0]),
        candidates: matches.map(publicAgent),
      }
    }
    if (matches.length > 1) {
      return {
        node,
        status: 'ambiguous',
        agent: null,
        candidates: matches.map(publicAgent),
      }
    }
    return {
      node,
      status: 'unmatched',
      agent: null,
      candidates: [],
    }
  })
}

module.exports = {
  buildNodeMatches,
  buildPveConfig,
  normalizeHostname,
  pveApiConfig,
  publicAgent,
  redactConfig,
  stripBlankSecret,
}
