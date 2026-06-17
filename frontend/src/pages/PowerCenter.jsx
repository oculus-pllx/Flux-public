import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../App'
import SshInstallModal from '../components/SshInstallModal'
import AddUpsWizard from '../components/AddUpsWizard'
import UpsConfigModal from '../components/UpsConfigModal'
import { sortByShutdownPriority } from '../utils/shutdownOrder'

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATE_STYLE = {
  online:             { color: 'var(--flux-healthy)',  bg: 'rgba(16,185,129,0.1)' },
  offline:            { color: 'var(--flux-muted)',    bg: 'rgba(100,116,139,0.1)' },
  pending:            { color: 'var(--flux-info, #38bdf8)', bg: 'rgba(56,189,248,0.1)'  },
  updating:           { color: 'var(--flux-info, #38bdf8)', bg: 'rgba(56,189,248,0.1)'  },
  'update-available': { color: 'var(--flux-accent)',   bg: 'rgba(249,115,22,0.1)'  },
  'command-sent':     { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)'  },
  'command-received': { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)'  },
  'ha-freezing':      { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)'  },
  'shutting-down':    { color: 'var(--flux-warning)',  bg: 'rgba(245,158,11,0.1)'  },
  unreachable:        { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)'   },
  error:              { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)'   },
  'update-failed':    { color: 'var(--flux-critical)', bg: 'rgba(244,63,94,0.1)'   },
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

// Detect the primary UPS state from a raw ups.status string (may contain flags like "OL CHRG")
function upsState(raw) {
  if (!raw) return 'unknown'
  if (raw.includes('LB')) return 'LB'
  if (raw.includes('OB')) return 'OB'
  if (raw.includes('OL')) return 'OL'
  return 'unknown'
}

const UPS_STATE_STYLE = {
  OL:      { color: '#10b981', bg: '#0d2018', border: '#1e4a3a' },
  OB:      { color: '#f59e0b', bg: '#110f00', border: '#4a3000' },
  LB:      { color: '#ef4444', bg: '#200000', border: '#5a0000' },
  unknown: { color: '#475569', bg: '#0f172a', border: '#1e293b' },
}

// Convert battery.runtime (seconds) to human string
function fmtRuntime(seconds) {
  if (seconds == null) return '—'
  const s = Number(seconds)
  if (isNaN(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000)    return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

// ── UPS Group Header ──────────────────────────────────────────────────────────

function UpsHeader({ device, canWrite, isAdmin, headers, machines, onRefresh, onEdit }) {
  const navigate = useNavigate()
  const [mutePhase,   setMutePhase]   = useState('idle')
  const [muteMsg,     setMuteMsg]     = useState('')
  const [editing,     setEditing]     = useState(false)
  const [nameVal,     setNameVal]     = useState(device.name)
  const [renaming,    setRenaming]    = useState(false)
  const [templating,  setTemplating]  = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [delErr,      setDelErr]      = useState('')

  async function deleteDevice() {
    setDeleting(true)
    setDelErr('')
    try {
      await axios.delete(`/api/devices/${device.id}`, { headers })
      setConfirmDel(false)
      onRefresh()
    } catch (err) {
      setDelErr(err.response?.data?.error || 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  async function saveName() {
    const trimmed = nameVal.trim()
    if (!trimmed || trimmed === device.name) { setEditing(false); setNameVal(device.name); return }
    setRenaming(true)
    try {
      await axios.put(`/api/devices/${device.id}`, { name: trimmed }, { headers })
      onRefresh()
    } catch { setNameVal(device.name) }
    finally { setRenaming(false); setEditing(false) }
  }

  async function applyTemplate() {
    if (!machines || machines.length === 0) return
    setTemplating(true)
    const sorted = sortByShutdownPriority(machines)
    try {
      await Promise.all(sorted.map((m, i) =>
        axios.put(`/api/agents/${m.id}`, { shutdownOrder: i + 1, shutdownDelay: i * 30 }, { headers })
      ))
      onRefresh()
    } catch {}
    finally { setTemplating(false) }
  }

  const v       = device.lastStatus || {}
  const rawSt   = v['ups.status']
  const state   = upsState(rawSt)
  const st      = UPS_STATE_STYLE[state]
  const charge  = v['battery.charge']
  const load    = v['ups.load']
  const runtime = v['battery.runtime']
  const voltage = v['input.voltage']
  const beeper  = v['ups.beeper.status']

  async function muteBeeper() {
    setMutePhase('busy')
    setMuteMsg('')
    try {
      await axios.post(
        `/api/devices/${device.id}/control/commands/beeper.mute`,
        {},
        { headers }
      )
      setMutePhase('ok')
      setMuteMsg('✓ Muted')
      setTimeout(() => { setMutePhase('idle'); setMuteMsg('') }, 3000)
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed'
      setMutePhase('error')
      setMuteMsg(`Failed: ${msg}`)
      setTimeout(() => { setMutePhase('idle'); setMuteMsg('') }, 5000)
    }
  }

  return (
    <div style={{
      background: st.bg,
      borderBottom: `1px solid ${st.border}`,
      padding: '14px 18px',
    }}>
      {/* Name + host row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          {editing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: st.color, fontSize: 15, fontWeight: 700 }}>⚡</span>
              <input
                autoFocus
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditing(false); setNameVal(device.name) } }}
                onBlur={saveName}
                disabled={renaming}
                style={{
                  background: 'rgba(255,255,255,0.07)', border: `1px solid ${st.color}`,
                  color: st.color, fontSize: 14, fontWeight: 700, borderRadius: 5,
                  padding: '2px 8px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none',
                }}
              />
            </div>
          ) : (
            <div
              style={{ color: st.color, fontSize: 15, fontWeight: 700, cursor: canWrite ? 'text' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => canWrite && setEditing(true)}
              title={canWrite ? 'Click to rename' : undefined}
            >
              ⚡ {device.name}
              {canWrite && <span style={{ fontSize: 10, color: '#475569', fontWeight: 400 }}>✎</span>}
            </div>
          )}
          <div style={{ color: '#475569', fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>
            {device.host}:{device.port} · {device.upsName}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {mutePhase === 'error' && muteMsg && (
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#ef4444' }}>
              {muteMsg}
            </span>
          )}
          {beeper !== undefined && mutePhase === 'idle' && (
            <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
              (🔔 {beeper})
            </span>
          )}
          {canWrite && (
            <button
              onClick={onEdit}
              title="Edit UPS configuration and NUT credentials"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--flux-border)',
                color: 'var(--flux-muted)',
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 5,
                cursor: 'pointer',
              }}>
              Edit
            </button>
          )}
          {canWrite && (
            <button
              onClick={muteBeeper}
              disabled={mutePhase === 'busy' || mutePhase === 'ok' || !device.hasNutCredentials}
              title={
                !device.hasNutCredentials
                  ? 'NUT credentials required — configure in Device Settings'
                  : 'Mute beeper (30–60s)'
              }
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--flux-border)',
                color: mutePhase === 'ok' ? '#10b981' : 'var(--flux-muted)',
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 5,
                cursor: (mutePhase === 'busy' || mutePhase === 'ok' || !device.hasNutCredentials) ? 'not-allowed' : 'pointer',
                opacity: !device.hasNutCredentials ? 0.4 : 1,
              }}>
              {mutePhase === 'busy' ? 'Muting…' : mutePhase === 'ok' ? '✓ Muted' : '🔕 Mute beeper'}
            </button>
          )}
          {canWrite && machines && machines.length > 0 && (
            <button
              onClick={applyTemplate}
              disabled={templating}
              title="Auto-assign shutdown order by role (controlled -> pbs -> pve-node -> ups-host) with 30s intervals"
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--flux-border)',
                color: templating ? '#475569' : 'var(--flux-muted)', fontSize: 11,
                padding: '3px 10px', borderRadius: 5,
                cursor: templating ? 'not-allowed' : 'pointer',
              }}>
              {templating ? 'Applying…' : '⚡ Auto-order'}
            </button>
          )}
          <button
            onClick={() => navigate(`/devices/${device.id}?tab=control`)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--flux-border)',
              color: 'var(--flux-muted)',
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 5,
              cursor: 'pointer',
            }}>
            Manage
          </button>
          <button
            onClick={() => navigate(`/devices/${device.id}`)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--flux-border)',
              color: 'var(--flux-muted)',
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 5,
              cursor: 'pointer',
            }}>
            Details →
          </button>
          {isAdmin && (
            <button
              onClick={() => { setDelErr(''); setConfirmDel(true) }}
              title="Delete this UPS and all its metrics"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--flux-border)',
                color: 'var(--flux-muted)',
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 5,
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--flux-critical)'; e.currentTarget.style.borderColor = 'var(--flux-critical)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--flux-muted)'; e.currentTarget.style.borderColor = 'var(--flux-border)' }}>
              Delete
            </button>
          )}
        </div>
      </div>

      {confirmDel && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{
            background: 'var(--flux-panel)', border: '1px solid var(--flux-border)',
            borderRadius: 12, padding: 24, width: '100%', maxWidth: 420,
          }}>
            <h2 style={{ color: 'var(--flux-text)', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
              Delete UPS
            </h2>
            <p style={{ color: 'var(--flux-muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
              Delete <strong style={{ color: 'var(--flux-text)' }}>{device.name}</strong>? This
              removes all associated metrics and connected machines. This cannot be undone.
            </p>
            {delErr && (
              <p style={{ color: 'var(--flux-critical)', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 }}>
                {delErr}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmDel(false)}
                disabled={deleting}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--flux-border)',
                  color: 'var(--flux-muted)', fontSize: 12, padding: '6px 14px',
                  borderRadius: 6, cursor: deleting ? 'not-allowed' : 'pointer',
                }}>
                Cancel
              </button>
              <button
                onClick={deleteDevice}
                disabled={deleting}
                style={{
                  background: 'var(--flux-critical)', border: '1px solid var(--flux-critical)',
                  color: '#fff', fontSize: 12, fontWeight: 600, padding: '6px 14px',
                  borderRadius: 6, cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.6 : 1,
                }}>
                {deleting ? 'Deleting…' : 'Delete UPS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
        {/* Battery progress + state badge */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ color: '#475569', fontSize: 9, letterSpacing: '0.08em' }}>BATTERY</span>
            <span style={{ color: st.color, fontSize: 9, fontWeight: 700 }}>
              {charge != null ? `${charge}%` : '—'}
            </span>
          </div>
          <div style={{ background: '#1e293b', borderRadius: 3, height: 5 }}>
            {charge != null && (
              <div style={{
                background: st.color,
                width: `${Math.min(100, Number(charge))}%`,
                height: '100%',
                borderRadius: 3,
                transition: 'width 0.4s ease',
              }} />
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{
              background: `${st.color}22`,
              color: st.color,
              fontSize: 10, padding: '1px 7px', borderRadius: 4,
              fontWeight: 700, fontFamily: 'monospace',
            }}>
              ● {state !== 'unknown' ? state : (rawSt || '—')}
            </span>
          </div>
        </div>

        {/* Load */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 5, padding: '5px 8px' }}>
          <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.08em', marginBottom: 2 }}>LOAD</div>
          <div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
            {load != null ? `${load}%` : '—'}
          </div>
        </div>

        {/* Runtime */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 5, padding: '5px 8px' }}>
          <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.08em', marginBottom: 2 }}>RUNTIME</div>
          <div style={{
            color: (runtime != null && Number(runtime) < 300) ? st.color : '#94a3b8',
            fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
          }}>
            {fmtRuntime(runtime)}
          </div>
        </div>

        {/* Input voltage */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 5, padding: '5px 8px' }}>
          <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.08em', marginBottom: 2 }}>INPUT V</div>
          <div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>
            {voltage != null ? `${voltage}V` : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Machine Row ───────────────────────────────────────────────────────────────

function MachineRow({ machine, canWrite = false, headers, onRefresh }) {
  const navigate = useNavigate()
  const [editingOrder, setEditingOrder] = useState(false)
  const [order, setOrder] = useState(String(machine.shutdownOrder || 0))
  const [delay, setDelay] = useState(String(machine.shutdownDelay || 0))
  const [savingOrder, setSavingOrder] = useState(false)
  const isSurge = machine.upsOutletBatteryBacked === false

  async function saveOrder(e) {
    e.stopPropagation()
    setSavingOrder(true)
    try {
      await axios.put(`/api/agents/${machine.id}`, {
        shutdownOrder: Number(order) || 0,
        shutdownDelay: Number(delay) || 0,
      }, { headers })
      setEditingOrder(false)
      onRefresh()
    } catch {}
    finally { setSavingOrder(false) }
  }

  let outletBadge = null
  if (machine.upsOutletBatteryBacked === true) {
    outletBadge = (
      <span style={{
        background: 'rgba(16,185,129,0.12)', color: '#10b981',
        fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>🔋 Battery backed</span>
    )
  } else if (machine.upsOutletBatteryBacked === false) {
    outletBadge = (
      <span style={{
        background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
        fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>⚡ Surge only</span>
    )
  }

  return (
    <div
      onClick={() => navigate(`/machines/${machine.id}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid var(--flux-border)',
        cursor: 'pointer',
        transition: 'background 0.15s',
        borderLeft: machine.role === 'ups-host' ? '3px solid rgba(249,115,22,0.6)'
                  : isSurge                    ? '3px solid rgba(245,158,11,0.5)'
                  :                              '3px solid transparent',
        background: machine.role === 'ups-host' ? 'rgba(249,115,22,0.03)' : isSurge ? 'rgba(245,158,11,0.02)' : 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => {
        e.currentTarget.style.background = machine.role === 'ups-host' ? 'rgba(249,115,22,0.03)' : isSurge ? 'rgba(245,158,11,0.02)' : 'transparent'
      }}
    >
      {/* Left: hostname + badges */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
        <span style={{
          fontFamily: 'monospace', fontWeight: machine.role === 'ups-host' ? 700 : 600, fontSize: 14,
          color: machine.role === 'ups-host' ? '#f97316' : 'var(--flux-text)', whiteSpace: 'nowrap',
        }}>
          {machine.hostname}
        </span>
        {stateBadge(machine.state || 'offline')}
        {machine.role === 'ups-host' && (
          <span style={{
            background: 'rgba(249,115,22,0.15)', color: '#f97316',
            fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
            fontFamily: 'monospace', whiteSpace: 'nowrap',
          }}>⚡ UPS HOST</span>
        )}
        {machine.role && machine.role !== 'ups-host' && (
          <span style={{
            fontFamily: 'monospace', fontSize: 11, color: 'var(--flux-muted)',
            border: '1px solid var(--flux-border)', padding: '2px 7px', borderRadius: 4,
            whiteSpace: 'nowrap',
          }}>
            {machine.role}
          </span>
        )}
        {machine.agentVersion && (
          <span style={{
            fontFamily: 'monospace', fontSize: 11, color: 'var(--flux-dim)',
            border: '1px solid var(--flux-border)', padding: '2px 7px', borderRadius: 4,
            whiteSpace: 'nowrap',
          }}>
            v{machine.agentVersion}
          </span>
        )}
      </div>

      {/* Right: outlet info + shutdown order + last seen */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {outletBadge}
        {machine.upsOutlet && (
          <span style={{
            fontFamily: 'monospace', fontSize: 10, color: 'var(--flux-muted)',
            whiteSpace: 'nowrap',
          }}>
            · "{machine.upsOutlet}"
          </span>
        )}
        {editingOrder ? (
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              value={order}
              onChange={e => setOrder(e.target.value)}
              type="number"
              min={0}
              title="Shutdown order"
              style={{ width: 44, background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)', borderRadius: 4, fontSize: 11, padding: '2px 4px', fontFamily: 'monospace' }}
            />
            <input
              value={delay}
              onChange={e => setDelay(e.target.value)}
              type="number"
              min={0}
              title="Shutdown delay seconds"
              style={{ width: 54, background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)', borderRadius: 4, fontSize: 11, padding: '2px 4px', fontFamily: 'monospace' }}
            />
            <button onClick={saveOrder} disabled={savingOrder}
              style={{ background: 'var(--flux-accent)', color: '#fff', border: 0, borderRadius: 4, fontSize: 10, padding: '3px 6px', cursor: savingOrder ? 'not-allowed' : 'pointer' }}>
              {savingOrder ? '...' : 'Save'}
            </button>
          </div>
        ) : (machine.shutdownOrder || machine.shutdownDelay) ? (
          <span style={{
            fontFamily: 'monospace', fontSize: 11, fontWeight: 600,
            color: '#38bdf8',
            background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
            borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap',
          }}
            title="Shutdown order · delay">
            #{machine.shutdownOrder ?? '?'} · {machine.shutdownDelay ?? 0}s
          </span>
        ) : (
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--flux-border)', minWidth: 28, textAlign: 'right' }}>—</span>
        )}
        {canWrite && !editingOrder && (
          <button
            onClick={e => { e.stopPropagation(); setOrder(String(machine.shutdownOrder || 0)); setDelay(String(machine.shutdownDelay || 0)); setEditingOrder(true) }}
            style={{ background: 'none', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', borderRadius: 4, fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}>
            Order
          </button>
        )}
        <span style={{
          fontFamily: 'monospace', fontSize: 11, fontWeight: 500,
          color: 'var(--flux-muted)', minWidth: 58, textAlign: 'right',
        }}>
          {timeAgo(machine.lastSeen)}
        </span>
      </div>
    </div>
  )
}

// ── Assign UPS inline control ─────────────────────────────────────────────────

function AssignUpsButton({ machine, devices, headers, onAssigned }) {
  const [open,    setOpen]    = useState(false)
  const [saving,  setSaving]  = useState(false)

  async function assign(deviceId) {
    setSaving(true)
    try {
      await axios.put(`/api/agents/${machine.id}`,
        { upsGroupId: Number(deviceId) }, { headers })
      onAssigned()
    } catch { /* ignore — next poll will reflect */ }
    finally { setSaving(false); setOpen(false) }
  }

  if (!open) return (
    <button
      onClick={e => { e.stopPropagation(); setOpen(true) }}
      style={{
        background: 'none', border: '1px solid var(--flux-border)',
        color: 'var(--flux-muted)', fontSize: 11, padding: '2px 8px',
        borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace',
        whiteSpace: 'nowrap',
      }}>
      Assign UPS
    </button>
  )

  return (
    <select
      autoFocus
      disabled={saving}
      onClick={e => e.stopPropagation()}
      onChange={e => e.target.value && assign(e.target.value)}
      defaultValue=""
      style={{
        background: 'var(--flux-panel)', border: '1px solid var(--flux-accent)',
        color: 'var(--flux-text)', fontSize: 11, padding: '2px 6px',
        borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace',
      }}>
      <option value="" disabled>— pick UPS —</option>
      {devices.map(d => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  )
}

// ── Enrollment Modal ──────────────────────────────────────────────────────────

function EnrollModal({ onClose, headers }) {
  const [hostname,   setHostname]  = useState('')
  const [result,     setResult]    = useState(null)
  const [busy,       setBusy]      = useState(false)
  const [countdown,  setCountdown] = useState(0)
  const [enrollTab,  setEnrollTab] = useState('token') // 'token' | 'ssh'

  useEffect(() => {
    if (!result) return
    const expiry = new Date(result.expiresAt).getTime()
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining === 0) clearInterval(tick)
    }, 1000)
    setCountdown(Math.max(0, Math.floor((expiry - Date.now()) / 1000)))
    return () => clearInterval(tick)
  }, [result])

  async function generate(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const { data } = await axios.post(
        '/api/agents/enrollment-token',
        { hostname: hostname || 'new-machine' },
        { headers }
      )
      setResult(data)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to generate token')
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = {
    background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
    color: 'var(--flux-text)', width: '100%', padding: '8px 12px',
    borderRadius: 8, fontFamily: 'IBM Plex Mono, monospace', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div style={{
        background: 'var(--flux-panel)', border: '1px solid var(--flux-border)',
        borderRadius: 12, padding: 24, width: '100%', maxWidth: 480,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ color: 'var(--flux-text)', fontWeight: 700, fontSize: 15 }}>
            Enroll New Machine
          </h2>
          <button
            onClick={onClose}
            style={{ color: 'var(--flux-muted)', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--flux-border)', marginBottom: '16px' }}>
          {[['token', '📋 Enrollment Token'], ['ssh', '🔑 Install via SSH']].map(([key, label]) => (
            <button key={key} onClick={() => setEnrollTab(key)}
              style={{
                background: 'none', border: 'none', padding: '8px 16px',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer',
                color: enrollTab === key ? 'var(--flux-accent)' : 'var(--flux-muted)',
                borderBottom: enrollTab === key ? '2px solid var(--flux-accent)' : '2px solid transparent',
                marginBottom: '-1px',
              }}>
              {label}
            </button>
          ))}
        </div>

        {enrollTab === 'token' && (!result ? (
          <form onSubmit={generate}>
            <label style={{ color: 'var(--flux-muted)', fontSize: 12, display: 'block', marginBottom: 6 }}>
              Hostname
            </label>
            <input
              type="text"
              value={hostname}
              onChange={e => setHostname(e.target.value)}
              placeholder="new-machine"
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--flux-border)'}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                background: 'var(--flux-accent)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13,
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              }}>
              {busy ? 'Generating…' : 'Generate Token'}
            </button>
          </form>
        ) : (
          <div>
            <p style={{ color: 'var(--flux-dim)', fontSize: 12, marginBottom: 6 }}>Enrollment Token</p>
            <div style={{
              background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 10,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{
                fontFamily: 'monospace', fontSize: 11, color: 'var(--flux-text)',
                wordBreak: 'break-all',
              }}>
                {result.token}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(result.token).catch(() => {})}
                style={{
                  color: 'var(--flux-muted)', fontSize: 11, background: 'none',
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                }}>
                Copy
              </button>
            </div>

            {countdown > 0 && (
              <p style={{
                fontSize: 11, marginBottom: 10,
                color: countdown < 60 ? 'var(--flux-critical)' : 'var(--flux-warning)',
              }}>
                Expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </p>
            )}
            {countdown === 0 && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--flux-critical)', marginBottom: 6 }}>Token expired.</p>
                <button
                  onClick={() => setResult(null)}
                  style={{
                    background: 'none', border: '1px solid var(--flux-border)',
                    color: 'var(--flux-muted)', fontSize: 11, padding: '4px 10px',
                    borderRadius: 5, cursor: 'pointer',
                  }}>
                  Generate New Token
                </button>
              </div>
            )}

            <p style={{ color: 'var(--flux-dim)', fontSize: 11, marginBottom: 6 }}>Install command</p>
            <div style={{
              background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
              borderRadius: 6, padding: '8px 12px',
              fontFamily: 'monospace', fontSize: 10, color: 'var(--flux-muted)',
              wordBreak: 'break-all',
            }}>
              {`FLUX_URL=${window.location.origin} FLUX_TOKEN=${result.token} bash -c "$(curl -fsSL ${window.location.origin}/install-agent.sh)"`}
            </div>
          </div>
        ))}

        {enrollTab === 'ssh' && (
          <SshInstallModal
            headers={headers}
            deviceId={null}
            upsGroupId={null}
            role={null}
            onSuccess={() => { onClose() }}
            onClose={onClose}
            inline={true}
          />
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 16, background: 'none', border: '1px solid var(--flux-border)',
            color: 'var(--flux-muted)', fontSize: 12, padding: '6px 14px',
            borderRadius: 6, cursor: 'pointer', width: '100%',
          }}>
          Close
        </button>
      </div>
    </div>
  )
}

// ── PowerCenter (main export) ─────────────────────────────────────────────────

export default function PowerCenter() {
  const { token, user }  = useAuth()
  const [devices,      setDevices]      = useState([])
  const [agents,       setAgents]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [enrollModal,  setEnrollModal]  = useState(false)
  const [showAddUps,   setShowAddUps]   = useState(false)
  const [editUps,      setEditUps]      = useState(null)
  const headers   = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const canWrite  = user?.role === 'admin' || user?.role === 'operator'
  const isAdmin   = user?.role === 'admin'

  const load = useCallback(async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        axios.get('/api/devices', { headers }),
        axios.get('/api/agents',  { headers }),
      ])
      setDevices(dRes.data)
      setAgents(aRes.data)
      setError(null)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => {
    load()
    const iv = setInterval(load, 10_000)
    return () => clearInterval(iv)
  }, [load])

  if (loading) {
    return <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>Loading…</p>
  }

  if (error) {
    return (
      <div>
        <p className="font-sans text-sm mb-2" style={{ color: 'var(--flux-critical)' }}>{error}</p>
        <button
          onClick={load}
          className="font-sans text-sm"
          style={{ color: 'var(--flux-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    )
  }

  // Group machines under their UPS, sorted by shutdownOrder
  const groups = devices.map(d => ({
    device: d,
    machines: agents
      .filter(a => a.upsGroupId === d.id)
      .sort((a, b) => (a.shutdownOrder ?? 999) - (b.shutdownOrder ?? 999)),
  }))

  const unassigned  = agents.filter(a => !a.upsGroupId)
  const onlineCount = agents.filter(a => a.state === 'online').length

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>
            Power Center
          </h1>
          <p className="font-sans text-xs mt-1" style={{ color: 'var(--flux-muted)' }}>
            {devices.length} UPS · {onlineCount} machine{onlineCount !== 1 ? 's' : ''} online
          </p>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowAddUps(true)}
              style={{
                background: 'none', border: '1px solid var(--flux-border)',
                color: 'var(--flux-text)', borderRadius: '8px', padding: '8px 16px',
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer',
              }}>
              + Add UPS
            </button>
            <button
              onClick={() => setEnrollModal(true)}
              className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all"
              style={{ background: 'var(--flux-accent)', color: '#fff' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 20px var(--flux-glow)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
              + Enroll Machine
            </button>
          </div>
        )}
      </div>

      {/* UPS groups + machine rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {groups.map(({ device, machines }) => {
          const v     = device.lastStatus || {}
          const state = upsState(v['ups.status'])
          const st    = UPS_STATE_STYLE[state]

          return (
            <div key={device.id} style={{
              border: `1px solid ${st.border}`,
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <UpsHeader device={device} canWrite={canWrite} isAdmin={isAdmin} headers={headers} machines={machines} onRefresh={load} onEdit={() => setEditUps(device)} />

              <div style={{ background: 'var(--flux-panel)' }}>
                {machines.length === 0 ? (
                  <div style={{
                    padding: '14px 16px',
                    color: 'var(--flux-dim)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}>
                    No machines assigned to this UPS
                  </div>
                ) : (
                  machines.map(m => <MachineRow key={m.id} machine={m} canWrite={canWrite} headers={headers} onRefresh={load} />)
                )}
              </div>
            </div>
          )
        })}

        {/* Machines with no UPS assigned */}
        {unassigned.length > 0 && (
          <div style={{
            border: '1px solid var(--flux-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              padding: '12px 18px',
              borderBottom: '1px solid var(--flux-border)',
            }}>
              <span style={{ color: 'var(--flux-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                No UPS Assigned ({unassigned.length})
              </span>
            </div>
            <div style={{ background: 'var(--flux-panel)' }}>
              {unassigned.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MachineRow machine={m} />
                  </div>
                  {canWrite && devices.length > 0 && (
                    <div style={{ padding: '0 12px', flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}>
                      <AssignUpsButton
                        machine={m}
                        devices={devices}
                        headers={headers}
                        onAssigned={load}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {devices.length === 0 && agents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <p className="font-sans text-sm mb-2" style={{ color: 'var(--flux-muted)' }}>
              No UPS devices or machines configured yet.
            </p>
            <p className="font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>
              Add a NUT device in Device Settings, then enroll machines to get started.
            </p>
          </div>
        )}
      </div>

      {enrollModal && (
        <EnrollModal onClose={() => setEnrollModal(false)} headers={headers} />
      )}

      {showAddUps && (
        <AddUpsWizard
          headers={headers}
          onSuccess={() => { setShowAddUps(false); load() }}
          onClose={() => setShowAddUps(false)}
        />
      )}
      {editUps && (
        <UpsConfigModal
          device={editUps}
          headers={headers}
          onClose={() => setEditUps(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  )
}
