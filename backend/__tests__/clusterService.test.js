const { calculateQuorum, willLoseQuorum, buildShutdownScope } = require('../services/clusterService')

describe('calculateQuorum', () => {
  it('5 nodes need 3 votes for quorum', () => {
    expect(calculateQuorum(5)).toBe(3)
  })
  it('8 nodes need 5 votes for quorum', () => {
    expect(calculateQuorum(8)).toBe(5)
  })
  it('3 nodes need 2 votes for quorum', () => {
    expect(calculateQuorum(3)).toBe(2)
  })
  it('1 node needs 1 vote', () => {
    expect(calculateQuorum(1)).toBe(1)
  })
})

describe('willLoseQuorum', () => {
  it('losing 3 of 5 votes causes quorum loss', () => {
    expect(willLoseQuorum({ totalVotes: 5, votesLost: 3 })).toBe(true)
  })
  it('losing 2 of 5 votes preserves quorum', () => {
    expect(willLoseQuorum({ totalVotes: 5, votesLost: 2 })).toBe(false)
  })
  it('losing 3 of 8 votes preserves quorum', () => {
    expect(willLoseQuorum({ totalVotes: 8, votesLost: 3 })).toBe(false)
  })
  it('losing 4 of 8 votes causes quorum loss', () => {
    expect(willLoseQuorum({ totalVotes: 8, votesLost: 4 })).toBe(true)
  })
  it('accounts for qdevice tiebreaker vote', () => {
    // 2-node cluster + qdevice = 3 total votes, need 2. Losing 1 node (1 vote) is safe.
    expect(willLoseQuorum({ totalVotes: 3, votesLost: 1 })).toBe(false)
  })
})

describe('buildShutdownScope', () => {
  const nodes = [
    { id: 1, machineKey: 'n1', clusterVotes: 1, upsGroupId: 'ups-a' },
    { id: 2, machineKey: 'n2', clusterVotes: 1, upsGroupId: 'ups-a' },
    { id: 3, machineKey: 'n3', clusterVotes: 1, upsGroupId: 'ups-a' },
    { id: 4, machineKey: 'n4', clusterVotes: 1, upsGroupId: 'ups-b' },
    { id: 5, machineKey: 'n5', clusterVotes: 1, upsGroupId: 'ups-b' },
  ]

  it('same-UPS cluster: all nodes shut down', () => {
    const same = nodes.map(n => ({ ...n, upsGroupId: 'ups-a' }))
    const { scope, reason } = buildShutdownScope({ nodes: same, failingUpsGroupId: 'ups-a' })
    expect(scope.map(n => n.machineKey)).toEqual(['n1','n2','n3','n4','n5'])
    expect(reason).toContain('simultaneous')
  })

  it('multi-UPS: quorum safe — only affected nodes', () => {
    const { scope, reason } = buildShutdownScope({ nodes, failingUpsGroupId: 'ups-b' })
    expect(scope.map(n => n.machineKey)).toEqual(['n4','n5'])
    expect(reason).toContain('maintained')
  })

  it('multi-UPS: quorum lost — all nodes', () => {
    const { scope, reason } = buildShutdownScope({ nodes, failingUpsGroupId: 'ups-a' })
    expect(scope.map(n => n.machineKey)).toHaveLength(5)
    expect(reason).toContain('lost')
  })
})
