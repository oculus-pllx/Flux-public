// Quorum math for Proxmox cluster shutdown coordination.
// PVE API calls (HA freeze) are added in Plan 2.

function calculateQuorum(totalVotes) {
  return Math.floor(totalVotes / 2) + 1
}

function willLoseQuorum({ totalVotes, votesLost }) {
  const remaining = totalVotes - votesLost
  return remaining < calculateQuorum(totalVotes)
}

function buildShutdownScope({ nodes, failingUpsGroupId }) {
  const totalVotes = nodes.reduce((sum, n) => sum + (n.clusterVotes || 1), 0)
  const allSameUps = nodes.every(n => n.upsGroupId === failingUpsGroupId)

  if (allSameUps) {
    return {
      scope: nodes,
      reason: `All ${nodes.length} nodes share the same UPS — simultaneous shutdown, quorum not a concern`,
      fullCluster: true,
    }
  }

  const affected = nodes.filter(n => n.upsGroupId === failingUpsGroupId)
  const votesLost = affected.reduce((sum, n) => sum + (n.clusterVotes || 1), 0)

  if (willLoseQuorum({ totalVotes, votesLost })) {
    const remaining = totalVotes - votesLost
    return {
      scope: nodes,
      reason: `Quorum lost (${remaining} of ${totalVotes} votes remain, need ${calculateQuorum(totalVotes)}) — shutting down all ${nodes.length} nodes`,
      fullCluster: true,
    }
  }

  return {
    scope: affected,
    reason: `Quorum maintained (${totalVotes - votesLost} of ${totalVotes} votes remain) — shutting down ${affected.length} affected node(s) only`,
    fullCluster: false,
  }
}

module.exports = { calculateQuorum, willLoseQuorum, buildShutdownScope }
