import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../App'

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATE_STYLE = {
  online:            { color: 'var(--flux-healthy)',  bg: 'rgba(16,185,129,0.1)' },
  offline:           { color: 'var(--flux-muted)',    bg: 'rgba(100,116,139,0.1)' },
  pending:           { color: 'var(--flux-info,#38bdf8)', bg: 'rgba(56,189,248,0.1)' },
  updating:          { color: 'var(--flux-info,#38bdf8)', bg: 'rgba(56,189,248,0.1)' },
  'update-available':{ color: 'var(--flux-accent)',   bg: 'rgba(249,115,22,0.1)' },
  'command-sent':    { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'command-received':{ color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'ha-freezing':     { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'shutting-down':   { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  unreachable:       { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
  error:             { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
  'update-failed':   { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
}

function stateBadge(state) {
  const s = STATE_STYLE[state] || STATE_STYLE.offline
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 5,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
      color: s.color, background: s.bg,
    }}>
      <span style={{ fontSize: 8 }}>●</span>{state}
    </span>
  )
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000)   return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function quorumThreshold(totalVotes) { return Math.floor(totalVotes / 2) + 1 }

// ── Sub-components (module scope — stable across renders) ─────────────────────

function SectionLabel({ label }) {
  return (
    <p className="font-display text-xs font-semibold uppercase tracking-widest mb-3"
      style={{ color: 'var(--flux-dim)' }}>
      {label}
    </p>
  )
}

function AgentCard({ m, navigate, panelStyle }) {
  return (
    <div onClick={() => navigate(`/machines/${m.id}`)}
      className="rounded-xl p-4 cursor-pointer transition-all"
      style={{ ...panelStyle, borderColor: 'var(--flux-border)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.35)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(249,115,22,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--flux-border)'; e.currentTarget.style.boxShadow = 'none' }}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-mono font-semibold text-sm" style={{ color: 'var(--flux-text)' }}>{m.hostname}</p>
          <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--flux-dim)' }}>
            {m.os || '—'}{m.virtualization ? ` · ${m.virtualization}` : ''}
          </p>
        </div>
        {stateBadge(m.state)}
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <span className="font-mono text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--flux-muted)' }}>
          {m.role}
        </span>
        {m.agentVersion && (
          <span className="font-mono text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--flux-muted)' }}>
            v{m.agentVersion}
          </span>
        )}
      </div>
      <p className="font-mono text-xs mt-2" style={{ color: 'var(--flux-dim)' }}>
        last seen {timeAgo(m.lastSeen)}
      </p>
    </div>
  )
}

function ClusterBanner({ clusterId, nodes, panelStyle }) {
  const totalVotes = nodes.reduce((s, n) => s + (n.clusterVotes || 1), 0)
  const onlineVotes = nodes
    .filter(n => ['online', 'update-available', 'command-sent', 'command-received'].includes(n.state))
    .reduce((s, n) => s + (n.clusterVotes || 1), 0)
  const threshold = quorumThreshold(totalVotes)
  const safe = onlineVotes >= threshold
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl mb-3"
      style={{ ...panelStyle, display: 'inline-flex' }}>
      <div>
        <p className="font-sans font-semibold text-sm" style={{ color: 'var(--flux-text)' }}>{clusterId}</p>
        <p className="font-mono text-xs" style={{ color: 'var(--flux-muted)' }}>
          {onlineVotes} / {totalVotes} votes
        </p>
      </div>
      <span className="text-xs font-semibold px-2 py-0.5 rounded"
        style={{
          background: safe ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
          color: safe ? 'var(--flux-healthy)' : 'var(--flux-warning)',
        }}>
        {safe ? '✓ Quorum safe' : '⚠ At risk'}
      </span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MachinesPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [enrollModal, setEnrollModal] = useState(false)
  const [enrollHostname, setEnrollHostname] = useState('')
  const [enrollResult, setEnrollResult] = useState(null)  // { token, expiresAt, machineId }
  const [enrollBusy, setEnrollBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const headers = { Authorization: `Bearer ${token}` }
  const canWrite = user?.role === 'admin' || user?.role === 'operator'

  const load = useCallback(() => {
    axios.get('/api/agents', { headers })
      .then(r => setMachines(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [load])

  // Countdown timer for enrollment token
  useEffect(() => {
    if (!enrollResult) return
    const expiry = new Date(enrollResult.expiresAt).getTime()
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining === 0) clearInterval(tick)
    }, 1000)
    setCountdown(Math.max(0, Math.floor((expiry - Date.now()) / 1000)))
    return () => clearInterval(tick)
  }, [enrollResult])

  async function generateToken(e) {
    e.preventDefault()
    setEnrollBusy(true)
    try {
      const { data } = await axios.post('/api/agents/enrollment-token',
        { hostname: enrollHostname || 'new-machine' }, { headers })
      setEnrollResult(data)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to generate token')
    } finally {
      setEnrollBusy(false)
    }
  }

  function closeEnroll() {
    setEnrollModal(false)
    setEnrollResult(null)
    setEnrollHostname('')
    setCountdown(0)
  }

  // Group machines by clusterId
  const clusterMap = {}
  const standalone = []
  for (const m of machines) {
    if (m.clusterId) {
      if (!clusterMap[m.clusterId]) clusterMap[m.clusterId] = []
      clusterMap[m.clusterId].push(m)
    } else {
      standalone.push(m)
    }
  }

  const panelStyle = { background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }
  const inputStyle = {
    background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
    color: 'var(--flux-text)', borderRadius: 8, padding: '8px 12px',
    fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, outline: 'none', width: '100%',
  }

  if (loading) {
    return <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="flex items-center justify-between mb-5">
        <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>Machines</h1>
        {canWrite && (
          <button onClick={() => setEnrollModal(true)}
            className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all"
            style={{ background: 'var(--flux-accent)', color: '#fff' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 18px var(--flux-glow)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
            + Enroll New Machine
          </button>
        )}
      </div>

      {/* Cluster banners */}
      {Object.keys(clusterMap).length > 0 && (
        <div className="flex gap-3 flex-wrap mb-4">
          {Object.entries(clusterMap).map(([cid, nodes]) => (
            <ClusterBanner key={cid} clusterId={cid} nodes={nodes} panelStyle={panelStyle} />
          ))}
        </div>
      )}

      {/* Clustered groups */}
      {Object.entries(clusterMap).map(([cid, nodes]) => (
        <div key={cid} className="mb-6">
          <SectionLabel label={cid} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nodes.map(m => <AgentCard key={m.id} m={m} navigate={navigate} panelStyle={panelStyle} />)}
          </div>
        </div>
      ))}

      {/* Standalone */}
      {standalone.length > 0 && (
        <div className="mb-6">
          {Object.keys(clusterMap).length > 0 && <SectionLabel label="Standalone" />}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standalone.map(m => <AgentCard key={m.id} m={m} navigate={navigate} panelStyle={panelStyle} />)}
          </div>
        </div>
      )}

      {machines.length === 0 && (
        <div className="text-center py-16">
          <p className="font-sans text-sm mb-4" style={{ color: 'var(--flux-muted)' }}>
            No machines enrolled yet.
          </p>
          {canWrite && (
            <button onClick={() => setEnrollModal(true)}
              className="font-display font-semibold text-sm px-4 py-2 rounded-lg"
              style={{ background: 'var(--flux-accent)', color: '#fff' }}>
              Enroll your first machine
            </button>
          )}
        </div>
      )}

      {/* ── Enrollment modal ─────────────────────────────────── */}
      {enrollModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="w-full max-w-md rounded-xl p-6" style={panelStyle}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>
                Enroll New Machine
              </h2>
              <button onClick={closeEnroll}
                className="font-mono text-xl" style={{ color: 'var(--flux-muted)' }}>×</button>
            </div>

            {!enrollResult ? (
              <form onSubmit={generateToken} className="space-y-3">
                <div>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>
                    Hostname (optional)
                  </label>
                  <input type="text" value={enrollHostname}
                    onChange={e => setEnrollHostname(e.target.value)}
                    placeholder="new-machine"
                    style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                  />
                </div>
                <button type="submit" disabled={enrollBusy}
                  className="w-full font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--flux-accent)', color: '#fff' }}>
                  {enrollBusy ? 'Generating…' : 'Generate Token'}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="font-sans text-xs mb-1" style={{ color: 'var(--flux-dim)' }}>Enrollment Token</p>
                  <div className="rounded-lg p-3 font-mono text-xs break-all cursor-pointer"
                    style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-accent)' }}
                    onClick={() => {
                      navigator.clipboard.writeText(enrollResult.token).catch(() => {
                        // Clipboard API unavailable (HTTP context or page not focused)
                        // Token is still visible and selectable in the box above
                      })
                    }}>
                    {enrollResult.token}
                  </div>
                  <p className="font-sans text-xs mt-1" style={{ color: 'var(--flux-dim)' }}>
                    Click to copy · Expires in{' '}
                    <span style={{ color: countdown < 60 ? 'var(--flux-critical)' : 'var(--flux-warning)' }}>
                      {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="font-sans text-xs mb-1" style={{ color: 'var(--flux-dim)' }}>Run on target machine</p>
                  <div className="rounded-lg p-3 font-mono text-xs"
                    style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                    curl -fsSL https://{'<YOUR_FLUX_URL>'}/install-agent.sh | bash
                  </div>
                </div>
                {countdown === 0 && (
                  <p className="font-sans text-xs text-center" style={{ color: 'var(--flux-critical)' }}>
                    Token expired.
                  </p>
                )}
                <div className="flex gap-2">
                  {countdown === 0 && (
                    <button onClick={() => setEnrollResult(null)}
                      className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                      style={{ background: 'var(--flux-accent)', color: '#fff' }}>
                      Generate New Token
                    </button>
                  )}
                  <button onClick={closeEnroll}
                    className="flex-1 font-sans text-sm py-2 rounded-lg"
                    style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
