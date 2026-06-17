import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../App'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'config',   label: 'Config' },
  { key: 'events',   label: 'Events' },
]

// Reuse the same STATE_STYLE map from MachinesPage
const STATE_STYLE = {
  online:            { color: 'var(--flux-healthy)',  bg: 'rgba(16,185,129,0.1)' },
  offline:           { color: 'var(--flux-muted)',    bg: 'rgba(100,116,139,0.1)' },
  pending:           { color: '#38bdf8',              bg: 'rgba(56,189,248,0.1)' },
  updating:          { color: '#38bdf8',              bg: 'rgba(56,189,248,0.1)' },
  'update-available':{ color: 'var(--flux-accent)',   bg: 'rgba(249,115,22,0.1)' },
  'command-sent':    { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'command-received':{ color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'ha-freezing':     { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  'shutting-down':   { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)' },
  unreachable:       { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
  error:             { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
  'update-failed':   { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)' },
}

function StateBadge({ state }) {
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
  if (diff < 60000)    return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function InfoGrid({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="font-sans text-xs mb-0.5" style={{ color: 'var(--flux-dim)' }}>{label}</p>
          <p className="font-mono text-sm" style={{ color: 'var(--flux-text)' }}>{value ?? '—'}</p>
        </div>
      ))}
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl p-5 mb-4"
      style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
      {title && (
        <p className="font-display text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--flux-dim)' }}>{title}</p>
      )}
      {children}
    </div>
  )
}

function Collapsible({ label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--flux-border)' }}>
        <span className="font-mono text-sm" style={{ color: 'var(--flux-muted)' }}>{label}</span>
        <span style={{ color: 'var(--flux-dim)', fontSize: 11, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </button>
      {open && (
        <div className="p-4 rounded-b-lg" style={{ border: '1px solid var(--flux-border)', borderTop: 'none', background: 'rgba(255,255,255,0.01)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

const BLANK_PVE = { url: '', node: '', tokenId: '', tokenSecret: '' }
const BLANK_PBS = { url: '', tokenId: '', tokenSecret: '', jobAbortTimeout: 120, forceShutdown: true }
const BLANK_NUT = { upsName: '', driver: '', port: '', desc: '', upsdPort: 3493, upsdUser: '', managedByFlux: false }

export default function MachineDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const [machine, setMachine] = useState(null)
  const [tab, setTab] = useState('overview')
  const [events, setEvents] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [reenrollResult, setReenrollResult] = useState(null)
  const [reenrollCountdown, setReenrollCountdown] = useState(0)
  const [pingResult,      setPingResult]      = useState(null)  // null | { alive, latencyMs?, reason? }
  const [pingBusy,        setPingBusy]        = useState(false)
  const [shutdownConfirm, setShutdownConfirm] = useState(false)
  const [shutdownBusy,    setShutdownBusy]    = useState(false)
  const [logOpen,         setLogOpen]         = useState(false)
  const headers = { Authorization: `Bearer ${token}` }
  const canWrite = user?.role === 'admin' || user?.role === 'operator'
  const isAdmin = user?.role === 'admin'

  const load = useCallback(() => {
    axios.get(`/api/agents/${id}`, { headers })
      .then(r => {
        setMachine(r.data)
        if (!form) {
          const m = r.data
          setForm({
            shutdownDelay:   m.shutdownDelay   ?? 0,
            shutdownTimeout: m.shutdownTimeout ?? 120,
            shutdownOrder:   m.shutdownOrder   ?? 0,
            upsGroupId:      m.upsGroupId      ?? '',
            clusterId:       m.clusterId       ?? '',
            clusterVotes:    m.clusterVotes    ?? 1,
            upsOutlet:             m.upsOutlet            ?? '',
            upsOutletBatteryBacked: m.upsOutletBatteryBacked === true  ? 'true'
                                   : m.upsOutletBatteryBacked === false ? 'false'
                                   : '',
            notes:           m.notes ?? '',
            updatePolicy:    m.updatePolicy    ?? 'manual',
            updateSchedule:  m.updateSchedule  ?? '',
            pveConfig: m.pveConfig ? { ...BLANK_PVE, ...m.pveConfig } : { ...BLANK_PVE },
            pbsConfig: m.pbsConfig ? { ...BLANK_PBS, ...m.pbsConfig } : { ...BLANK_PBS },
            nutConfig: m.nutConfig ? { ...BLANK_NUT, ...m.nutConfig } : { ...BLANK_NUT },
          })
        }
      })
      .catch(() => {})
  }, [id, token])

  useEffect(() => { load() }, [load])

  // Reset form and events when navigating to a different machine
  useEffect(() => {
    setForm(null)
    setEvents(null)
  }, [id])

  useEffect(() => {
    if (tab === 'events' && events === null) {
      axios.get(`/api/agents/${id}/events`, { headers })
        .then(r => setEvents(r.data))
        .catch(() => setEvents([]))
    }
  }, [tab, id, events])

  // Re-enroll countdown
  useEffect(() => {
    if (!reenrollResult) return
    const expiry = new Date(reenrollResult.expiresAt).getTime()
    const iv = setInterval(() => {
      const rem = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setReenrollCountdown(rem)
      if (rem === 0) clearInterval(iv)
    }, 1000)
    setReenrollCountdown(Math.max(0, Math.floor((expiry - Date.now()) / 1000)))
    return () => clearInterval(iv)
  }, [reenrollResult])

  async function pushConfig() {
    try {
      const body = buildSaveBody()
      await axios.post(`/api/agents/${id}/push-config`, body, { headers })
      setSaveMsg('Config pushed!')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Push failed')
      setTimeout(() => setSaveMsg(''), 4000)
    }
  }

  async function saveOnly() {
    setSaving(true)
    try {
      const body = buildSaveBody()
      const { data } = await axios.put(`/api/agents/${id}`, body, { headers })
      setMachine(data)
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Save failed')
      setTimeout(() => setSaveMsg(''), 4000)
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPush() {
    setSaving(true)
    try {
      const body = buildSaveBody()
      const { data } = await axios.put(`/api/agents/${id}`, body, { headers })
      setMachine(data)
      await axios.post(`/api/agents/${id}/push-config`, data, { headers })
      setSaveMsg('Saved & pushed!')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Failed')
      setTimeout(() => setSaveMsg(''), 4000)
    } finally {
      setSaving(false)
    }
  }

  function buildSaveBody() {
    return {
      shutdownDelay:   Number(form.shutdownDelay),
      shutdownTimeout: Number(form.shutdownTimeout),
      shutdownOrder:   Number(form.shutdownOrder),
      upsGroupId:      form.upsGroupId !== '' ? Number(form.upsGroupId) : null,
      upsOutlet:              form.upsOutlet || null,
      upsOutletBatteryBacked: form.upsOutletBatteryBacked === 'true'  ? true
                             : form.upsOutletBatteryBacked === 'false' ? false
                             : null,
      notes:           form.notes || null,
      clusterId:       form.clusterId || null,
      clusterVotes:    Number(form.clusterVotes),
      updatePolicy:    form.updatePolicy,
      updateSchedule:  form.updateSchedule || null,
      pveConfig:       form.pveConfig.url ? { ...form.pveConfig } : null,
      pbsConfig:       form.pbsConfig.url ? { ...form.pbsConfig, jobAbortTimeout: Number(form.pbsConfig.jobAbortTimeout) } : null,
      nutConfig:       form.nutConfig.upsName ? { ...form.nutConfig, upsdPort: Number(form.nutConfig.upsdPort) } : null,
    }
  }

  async function triggerUpdate() {
    setUpdateBusy(true)
    try {
      await axios.post(`/api/agents/${id}/update`, {}, { headers })
      setMachine(m => ({ ...m, state: 'updating' }))
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed')
    } finally {
      setUpdateBusy(false)
    }
  }

  async function reenroll() {
    try {
      const { data } = await axios.post(`/api/agents/${id}/reenroll`, {}, { headers })
      setReenrollResult(data)
    } catch (err) {
      alert(err.response?.data?.error || 'Re-enroll failed')
    }
  }

  async function deleteMachine() {
    if (deleteInput !== machine.hostname) return
    try {
      await axios.delete(`/api/agents/${id}`, { headers })
      navigate('/')
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  async function pingAgent() {
    setPingBusy(true)
    try {
      const { data } = await axios.post(`/api/agents/${id}/ping`, {}, { headers })
      setPingResult(data)
    } catch {
      setPingResult({ alive: false, reason: 'Request failed' })
    } finally {
      setPingBusy(false)
      setTimeout(() => setPingResult(null), 4000)
    }
  }

  async function shutdownAgent() {
    setShutdownBusy(true)
    try {
      await axios.post(`/api/agents/${id}/shutdown`, { delaySeconds: 0 }, { headers })
      setShutdownConfirm(false)
      await load()
    } catch (err) {
      alert(err.response?.data?.error || 'Shutdown failed')
    } finally {
      setShutdownBusy(false)
    }
  }

  const f = (key) => ({
    value: form?.[key] ?? '',
    onChange: e => setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  const fNested = (section, key) => ({
    value: form?.[section]?.[key] ?? '',
    onChange: e => setForm(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: e.target.value },
    })),
  })

  const inputStyle = {
    background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
    color: 'var(--flux-text)', borderRadius: 8, padding: '7px 11px',
    fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, outline: 'none', width: '100%',
  }

  const onFocus = e => e.target.style.borderColor = 'var(--flux-accent)'
  const onBlur  = e => e.target.style.borderColor = 'var(--flux-border)'

  if (!machine || !form) {
    return <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>Loading…</p>
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ── Header ────────────────────────────────────────────── */}
      <button onClick={() => navigate('/')}
        className="font-sans text-sm mb-3 flex items-center gap-1 transition-colors"
        style={{ color: 'var(--flux-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--flux-text)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--flux-muted)'}>
        ← Power Center
      </button>

      <div className="flex items-center gap-3 flex-wrap mb-1">
        <span className="font-mono font-bold text-2xl" style={{ color: 'var(--flux-text)' }}>
          {machine.hostname}
        </span>
        <StateBadge state={machine.state} />
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-5" style={{ color: 'var(--flux-dim)', fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}>
        <span>{machine.role}</span><span>·</span>
        <span>{machine.os || '—'}</span><span>·</span>
        {machine.agentVersion && <><span>v{machine.agentVersion}</span><span>·</span></>}
        <span>last seen {timeAgo(machine.lastSeen)}</span>
      </div>

      {/* ── Update banner ──────────────────────────────────────── */}
      {machine.state === 'update-available' && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-5"
          style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)' }}>
          <div>
            <p className="font-sans text-sm font-medium" style={{ color: 'var(--flux-accent)' }}>
              🔺 Update available
            </p>
            <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--flux-muted)' }}>
              {machine.stateDetail || 'New version on GitHub'}
            </p>
          </div>
          {canWrite && (
            <button onClick={triggerUpdate} disabled={updateBusy}
              className="font-display font-semibold text-sm px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--flux-accent)', color: '#fff' }}>
              {updateBusy ? 'Sending…' : 'Trigger Update'}
            </button>
          )}
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--flux-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="font-display font-semibold text-sm px-4 py-2 transition-colors"
            style={{
              color: tab === t.key ? 'var(--flux-accent)' : 'var(--flux-muted)',
              marginBottom: '-1px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--flux-accent)' : '2px solid transparent',
              outline: 'none',
              cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ───────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap mb-4">
            {canWrite && (
              <>
                <button onClick={pushConfig}
                  className="font-sans text-sm px-4 py-2 rounded-lg transition-colors"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', background: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--flux-text)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--flux-muted)'; e.currentTarget.style.borderColor = 'var(--flux-border)' }}>
                  Push Config
                </button>
                <button onClick={reenroll}
                  className="font-sans text-sm px-4 py-2 rounded-lg transition-colors"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', background: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--flux-text)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--flux-muted)'; e.currentTarget.style.borderColor = 'var(--flux-border)' }}>
                  Re-enroll
                </button>
                <button onClick={pingAgent} disabled={pingBusy}
                  style={{
                    background: 'var(--flux-panel2)', border: '1px solid var(--flux-border)',
                    color: 'var(--flux-text)', borderRadius: '8px', padding: '6px 14px',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', cursor: pingBusy ? 'not-allowed' : 'pointer',
                    opacity: pingBusy ? 0.6 : 1,
                  }}>
                  {pingBusy ? 'Pinging…' : 'Ping'}
                </button>
                <button onClick={() => setShutdownConfirm(true)}
                  style={{
                    background: 'none', border: '1px solid var(--flux-critical)',
                    color: 'var(--flux-critical)', borderRadius: '8px', padding: '6px 14px',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', cursor: 'pointer',
                  }}>
                  Shutdown
                </button>
              </>
            )}
            {pingResult && (
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px',
                color: pingResult.alive ? 'var(--flux-healthy)' : 'var(--flux-critical)',
              }}>
                {pingResult.alive ? `✓ ${pingResult.latencyMs}ms` : `✗ ${pingResult.reason}`}
              </span>
            )}
            {isAdmin && (
              <button onClick={() => setDeleteConfirm(true)}
                className="font-sans text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ border: '1px solid rgba(244,63,94,0.3)', color: 'var(--flux-critical)', background: 'none', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(244,63,94,0.07)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                Delete
              </button>
            )}
            {saveMsg && (
              <span className="font-sans text-sm self-center"
                style={{ color: saveMsg.includes('fail') || saveMsg.includes('Failed') ? 'var(--flux-critical)' : 'var(--flux-healthy)' }}>
                {saveMsg}
              </span>
            )}
          </div>

          <Card title="Machine Info">
            <InfoGrid items={[
              ['State',         <StateBadge state={machine.state} />],
              ['Role',          machine.role],
              ['OS',            machine.os],
              ['Virtualization',machine.virtualization],
              ['Agent Version', machine.agentVersion ? `v${machine.agentVersion}` : null],
              ['Capabilities',  (machine.capabilities || []).join(', ') || '—'],
            ]} />
          </Card>

          <Card title="Cluster & UPS">
            <InfoGrid items={[
              ['Cluster',          machine.clusterId],
              ['Votes',            machine.clusterVotes],
              ['UPS Group',        machine.upsGroupId ? `Device #${machine.upsGroupId}` : null],
              ['Shutdown Order',   machine.shutdownOrder],
              ['Shutdown Delay',   `${machine.shutdownDelay}s`],
              ['Shutdown Timeout', `${machine.shutdownTimeout}s`],
            ]} />
          </Card>

          <Card title="Update Policy">
            <InfoGrid items={[
              ['Policy',   machine.updatePolicy],
              ['Schedule', machine.updateSchedule],
            ]} />
          </Card>
        </>
      )}

      {/* ── Config tab ─────────────────────────────────────────── */}
      {tab === 'config' && (
        <Card>
          {/* Shutdown */}
          <p className="font-display text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--flux-dim)', borderBottom: '1px solid var(--flux-border)', paddingBottom: 8 }}>
            Shutdown Settings
          </p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              ['shutdownDelay',   'Shutdown Delay (s)',   'number'],
              ['shutdownTimeout', 'Shutdown Timeout (s)', 'number'],
              ['shutdownOrder',   'Shutdown Order',       'number'],
              ['upsGroupId',      'UPS Group (device ID)','number'],
              ['clusterId',       'Cluster ID',           'text'],
              ['clusterVotes',    'Cluster Votes',        'number'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                <input type={type} {...f(key)} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              </div>
            ))}
          </div>

          {/* UPS Outlet — only when a UPS group is assigned */}
          {form.upsGroupId !== '' && (
            <>
              <p className="font-display text-xs font-semibold uppercase tracking-widest mb-3"
                style={{ color: 'var(--flux-dim)', borderBottom: '1px solid var(--flux-border)', paddingBottom: 8 }}>
                UPS Outlet
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Outlet Label</label>
                  <input type="text" {...f('upsOutlet')} maxLength={100} placeholder="e.g. Outlet 1"
                    style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                </div>
                <div>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Outlet Type</label>
                  <select {...f('upsOutletBatteryBacked')} style={{ ...inputStyle, cursor: 'pointer' }} onFocus={onFocus} onBlur={onBlur}>
                    <option value="">Unknown</option>
                    <option value="true">Battery-backed</option>
                    <option value="false">Surge-only</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div style={{ paddingTop: '16px', paddingBottom: '16px' }}>
            <label style={{ display: 'block', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--flux-dim)', marginBottom: '8px' }}>
              Notes
            </label>
            <input type="text" {...f('notes')} maxLength={500}
              placeholder="Optional description or reminder"
              style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
            <p style={{ color: 'var(--flux-dim)', fontSize: '11px', margin: '4px 0 0' }}>
              Free-form notes about this machine
            </p>
          </div>

          {/* Install Log */}
          {machine.installLog && (
            <div style={{ paddingTop: '16px', borderTop: '1px solid var(--flux-border)', marginBottom: '16px' }}>
              <button type="button" onClick={() => setLogOpen(o => !o)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                         display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 600,
                               textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--flux-dim)' }}>
                  Install Log
                </span>
                <span style={{ color: 'var(--flux-dim)', fontSize: '10px' }}>{logOpen ? '▲' : '▼'}</span>
              </button>
              {logOpen && (
                <div style={{ marginTop: '8px', position: 'relative' }}>
                  <pre style={{
                    background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', borderRadius: '8px',
                    padding: '12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                    color: '#a5d6ff', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    maxHeight: '300px', overflowY: 'auto',
                  }}>
                    {machine.installLog}
                  </pre>
                  <button type="button"
                    onClick={() => navigator.clipboard.writeText(machine.installLog).catch(() => {})}
                    style={{ position: 'absolute', top: '8px', right: '8px', background: 'var(--flux-panel2)',
                             border: '1px solid var(--flux-border)', borderRadius: '4px', padding: '2px 8px',
                             color: 'var(--flux-muted)', fontSize: '11px', cursor: 'pointer' }}>
                    Copy
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Update policy */}
          <p className="font-display text-xs font-semibold uppercase tracking-widest mb-3"
            style={{ color: 'var(--flux-dim)', borderBottom: '1px solid var(--flux-border)', paddingBottom: 8 }}>
            Update Policy
          </p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Policy</label>
              <select {...f('updatePolicy')} style={{ ...inputStyle, cursor: 'pointer' }} onFocus={onFocus} onBlur={onBlur}>
                <option value="manual">manual</option>
                <option value="auto">auto</option>
                <option value="scheduled">scheduled</option>
              </select>
            </div>
            {form.updatePolicy === 'scheduled' && (
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Schedule (cron)</label>
                <input type="text" placeholder="0 3 * * 0" {...f('updateSchedule')} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              </div>
            )}
          </div>

          {/* pveConfig */}
          <p className="font-display text-xs font-semibold uppercase tracking-widest mb-2"
            style={{ color: 'var(--flux-dim)', borderBottom: '1px solid var(--flux-border)', paddingBottom: 8 }}>
            Service Configs
          </p>
          <div className="space-y-2 mb-5">
            <Collapsible label="pveConfig — Proxmox VE">
              <div className="grid grid-cols-2 gap-3">
                {[['url','PVE URL','text'],['node','Node Name','text'],['tokenId','Token ID','text'],['tokenSecret','Token Secret','password']].map(([key, label, type]) => (
                  <div key={key}>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                    <input type={type} {...fNested('pveConfig', key)} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                  </div>
                ))}
              </div>
            </Collapsible>

            <Collapsible label="pbsConfig — Proxmox Backup Server">
              <div className="grid grid-cols-2 gap-3">
                {[['url','PBS URL','text'],['tokenId','Token ID','text'],['tokenSecret','Token Secret','password']].map(([key, label, type]) => (
                  <div key={key}>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                    <input type={type} {...fNested('pbsConfig', key)} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                  </div>
                ))}
                <div>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Job Abort Timeout (s)</label>
                  <input type="number"
                    value={form.pbsConfig.jobAbortTimeout ?? 120}
                    onChange={e => setForm(p => ({ ...p, pbsConfig: { ...p.pbsConfig, jobAbortTimeout: e.target.value } }))}
                    style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <input type="checkbox"
                    id="forceShutdown"
                    checked={!!form.pbsConfig.forceShutdown}
                    onChange={e => setForm(p => ({ ...p, pbsConfig: { ...p.pbsConfig, forceShutdown: e.target.checked } }))} />
                  <label htmlFor="forceShutdown" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                    Force shutdown if jobs don't finish
                  </label>
                </div>
              </div>
            </Collapsible>

            <Collapsible label="nutConfig — NUT UPS Tools">
              <div className="grid grid-cols-2 gap-3">
                {[['upsName','UPS Name','text'],['driver','Driver','text'],['port','Port','text'],['desc','Description','text'],['upsdUser','upsd User','text']].map(([key, label, type]) => (
                  <div key={key}>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                    <input type={type} {...fNested('nutConfig', key)} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                  </div>
                ))}
	                <div>
	                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>upsd Port</label>
	                  <input type="number"
	                    value={form.nutConfig.upsdPort ?? 3493}
	                    onChange={e => setForm(p => ({ ...p, nutConfig: { ...p.nutConfig, upsdPort: e.target.value } }))}
	                    style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
	                </div>
	              </div>
	              <div className="flex items-start gap-2 mt-3">
	                <input type="checkbox"
	                  id="managedByFlux"
	                  checked={form.nutConfig.managedByFlux === true}
	                  onChange={e => setForm(p => ({ ...p, nutConfig: { ...p.nutConfig, managedByFlux: e.target.checked } }))}
	                  style={{ marginTop: 3 }} />
	                <label htmlFor="managedByFlux" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
	                  Managed by Flux. Flux will back up and overwrite NUT config files on this host when config is pushed.
	                </label>
	              </div>
	            </Collapsible>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={saveAndPush} disabled={saving}
              className="font-display font-semibold text-sm px-5 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--flux-accent)', color: '#fff', cursor: 'pointer', border: 'none' }}>
              {saving ? 'Saving…' : 'Save & Push Config'}
            </button>
            <button type="button" onClick={saveOnly} disabled={saving}
              className="font-sans text-sm px-5 py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', background: 'none', cursor: 'pointer' }}>
              Save Only
            </button>
            {saveMsg && (
              <span className="font-sans text-sm"
                style={{ color: saveMsg.includes('fail') || saveMsg.includes('Failed') ? 'var(--flux-critical)' : 'var(--flux-healthy)' }}>
                {saveMsg}
              </span>
            )}
          </div>
        </Card>
      )}

      {/* ── Events tab ─────────────────────────────────────────── */}
      {tab === 'events' && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
          {events === null ? (
            <p className="font-sans text-sm p-5" style={{ color: 'var(--flux-muted)' }}>Loading…</p>
          ) : events.length === 0 ? (
            <p className="font-sans text-sm p-5" style={{ color: 'var(--flux-muted)' }}>No events recorded.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Transition', 'Detail', 'Time'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', fontSize: 11, fontWeight: 600,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: 'var(--flux-dim)', padding: '0 16px 10px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.01)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '10px 16px', borderTop: '1px solid var(--flux-border)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>
                      <span style={{ color: 'var(--flux-muted)' }}>{ev.fromState}</span>
                      <span style={{ color: 'var(--flux-dim)', margin: '0 6px' }}>→</span>
                      <span style={{ color: (STATE_STYLE[ev.toState] || STATE_STYLE.offline).color }}>{ev.toState}</span>
                    </td>
                    <td style={{ padding: '10px 16px', borderTop: '1px solid var(--flux-border)', fontSize: 13, color: 'var(--flux-muted)' }}>
                      {ev.detail || '—'}
                    </td>
                    <td style={{ padding: '10px 16px', borderTop: '1px solid var(--flux-border)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--flux-dim)' }}>
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Re-enroll token modal ──────────────────────────────── */}
      {reenrollResult && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="w-full max-w-md rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>Re-enroll Token</h2>
              <button onClick={() => setReenrollResult(null)} style={{ color: 'var(--flux-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            <p className="font-sans text-xs mb-1" style={{ color: 'var(--flux-dim)' }}>New Enrollment Token</p>
            <div className="rounded-lg p-3 font-mono text-xs break-all cursor-pointer mb-2"
              style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-accent)' }}
              onClick={() => {
                navigator.clipboard.writeText(reenrollResult.token).catch(() => {})
              }}>
              {reenrollResult.token}
            </div>
            <p className="font-sans text-xs mb-3" style={{ color: 'var(--flux-dim)' }}>
              Click to copy · Expires in{' '}
              <span style={{ color: reenrollCountdown < 60 ? 'var(--flux-critical)' : 'var(--flux-warning)' }}>
                {Math.floor(reenrollCountdown / 60)}:{String(reenrollCountdown % 60).padStart(2, '0')}
              </span>
            </p>
            <button onClick={() => setReenrollResult(null)}
              className="w-full font-sans text-sm py-2 rounded-lg"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', background: 'none', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Shutdown confirmation modal ───────────────────────── */}
      {shutdownConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '360px' }}>
            <h3 style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '15px', color: 'var(--flux-text)', marginBottom: '12px' }}>
              Shutdown {machine.hostname}?
            </h3>
            <p style={{ color: 'var(--flux-muted)', fontSize: '13px', marginBottom: '20px' }}>
              The agent will initiate a graceful system shutdown immediately.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={shutdownAgent} disabled={shutdownBusy}
                style={{ flex: 1, background: 'var(--flux-critical)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: shutdownBusy ? 'not-allowed' : 'pointer', opacity: shutdownBusy ? 0.6 : 1 }}>
                {shutdownBusy ? 'Sending…' : 'Shutdown'}
              </button>
              <button onClick={() => setShutdownConfirm(false)} disabled={shutdownBusy}
                style={{ flex: 1, background: 'none', border: '1px solid var(--flux-border)', borderRadius: '8px', padding: '10px', color: 'var(--flux-muted)', fontSize: '14px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ──────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <h2 className="font-display font-bold text-base mb-3" style={{ color: 'var(--flux-text)' }}>Delete Machine</h2>
            <p className="font-sans text-sm mb-4" style={{ color: 'var(--flux-muted)' }}>
              This will permanently remove <span style={{ color: 'var(--flux-text)', fontFamily: 'monospace' }}>{machine.hostname}</span>. Type the hostname to confirm.
            </p>
            <input type="text" value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={machine.hostname}
              style={{
                background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
                color: 'var(--flux-text)', borderRadius: 8, padding: '8px 12px',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, outline: 'none', width: '100%',
                marginBottom: 12,
              }}
              onFocus={e => e.target.style.borderColor = 'var(--flux-critical)'}
              onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
            />
            <div className="flex gap-3">
              <button onClick={deleteMachine} disabled={deleteInput !== machine.hostname}
                className="flex-1 font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--flux-critical)', color: '#fff', border: 'none', cursor: deleteInput === machine.hostname ? 'pointer' : 'default' }}>
                Delete
              </button>
              <button onClick={() => { setDeleteConfirm(false); setDeleteInput('') }}
                className="flex-1 font-sans text-sm py-2 rounded-lg"
                style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', background: 'none', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
