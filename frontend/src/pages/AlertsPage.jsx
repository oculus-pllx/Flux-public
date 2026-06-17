import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'

const SEV_COLOR = {
  info:     'var(--flux-muted)',
  warning:  'var(--flux-warning)',
  critical: 'var(--flux-critical)',
}

const NUMERIC_CONDITIONS = [
  { value: 'lt',  label: 'below (<)' },
  { value: 'lte', label: 'below or equal (≤)' },
  { value: 'gt',  label: 'above (>)' },
  { value: 'gte', label: 'above or equal (≥)' },
  { value: 'eq',  label: 'equals (=)' },
  { value: 'ne',  label: 'not equal (≠)' },
]

const STRING_CONDITIONS = [
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
]

const ALL_CONDITIONS = [...NUMERIC_CONDITIONS, ...STRING_CONDITIONS]

const STRING_VARS = new Set([
  'ups.status', 'ups.beeper.status', 'ups.test.result', 'ups.alarm',
  'device.type', 'device.mfr', 'device.model', 'driver.name',
])

const VAR_LABELS = {
  'battery.charge':          'Battery Charge (%)',
  'battery.charge.low':      'Battery Low Threshold (%)',
  'battery.runtime':         'Runtime Remaining (s)',
  'battery.voltage':         'Battery Voltage (V)',
  'battery.voltage.nominal': 'Battery Nominal Voltage (V)',
  'ups.load':                'UPS Load (%)',
  'ups.status':              'UPS Status',
  'ups.realpower.nominal':   'UPS Nominal Real Power (W)',
  'ups.temperature':         'UPS Temperature (°C)',
  'input.voltage':           'Input Voltage (V)',
  'input.voltage.nominal':   'Input Nominal Voltage (V)',
  'input.transfer.high':     'Input Transfer High (V)',
  'input.transfer.low':      'Input Transfer Low (V)',
  'ups.beeper.status':       'Beeper Status',
  'ups.test.result':         'Last Test Result',
}

const BLANK_TRIGGER = {
  deviceId: '', variable: '', condition: 'lt', threshold: '',
  severity: 'warning', cooldown: 300, emailEnabled: false,
  fireOnce: false, notifyOnRecovery: false,
}

const HISTORY_PAGE_SIZE = 100

export default function AlertsPage() {
  const { token, user } = useAuth()
  const [history, setHistory] = useState([])
  const [historyCount, setHistoryCount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [triggers, setTriggers] = useState([])
  const [devices, setDevices] = useState([])
  const [tab, setTab] = useState('history')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(BLANK_TRIGGER)
  const [confirmDel, setConfirmDel] = useState(null)
  const [deviceVars, setDeviceVars] = useState([])
  const [customVar, setCustomVar] = useState(false)
  const headers = { Authorization: `Bearer ${token}` }
  const canWrite = user?.role === 'admin' || user?.role === 'operator'

  useEffect(() => {
    loadHistory(0)
    axios.get('/api/alerts/triggers', { headers }).then(r => setTriggers(r.data)).catch(() => setTriggers([]))
    axios.get('/api/devices', { headers }).then(r => setDevices(r.data)).catch(() => setDevices([]))
  }, [])

  async function loadHistory(offset) {
    setLoadingMore(true)
    try {
      const { data } = await axios.get('/api/alerts/history', {
        headers, params: { limit: HISTORY_PAGE_SIZE, offset },
      })
      const rows = Array.isArray(data) ? data : data.rows || []
      setHistoryCount(Array.isArray(data) ? data.length : data.count || rows.length)
      setHistory(h => offset === 0 ? rows : [...h, ...rows])
    } catch {
      if (offset === 0) setHistory([])
    } finally {
      setLoadingMore(false)
    }
  }

  async function loadDeviceVars(deviceId) {
    if (!deviceId) { setDeviceVars([]); return }
    try {
      const { data } = await axios.get(`/api/metrics/device/${deviceId}/stats`, { headers })
      const keys = data?.data ? Object.keys(data.data) : []
      setDeviceVars(keys)
    } catch {
      setDeviceVars([])
    }
  }

  function isStringVar(varName) {
    return STRING_VARS.has(varName)
  }

  function conditionsFor(varName) {
    return isStringVar(varName) ? STRING_CONDITIONS : NUMERIC_CONDITIONS
  }

  function handleDeviceChange(deviceId) {
    setForm(f => ({ ...f, deviceId: +deviceId, variable: '', condition: 'lt', threshold: '' }))
    setCustomVar(false)
    loadDeviceVars(deviceId)
  }

  function handleVarChange(varName) {
    if (varName === '__custom__') {
      setCustomVar(true)
      setForm(f => ({ ...f, variable: '', condition: 'lt', threshold: '' }))
      return
    }
    setCustomVar(false)
    const defaultCond = isStringVar(varName) ? 'contains' : 'lt'
    setForm(f => ({ ...f, variable: varName, condition: defaultCond, threshold: '' }))
  }

  async function resolve(id) {
    await axios.post(`/api/alerts/alerts/${id}/resolve`, {}, { headers })
    setHistory(h => h.map(a => a.id === id ? { ...a, resolved: true } : a))
  }

  async function saveTrigger(e) {
    e.preventDefault()
    if (modal === 'add') {
      const { data } = await axios.post('/api/alerts/triggers', form, { headers })
      setTriggers(t => [...t, data])
    } else {
      const { data } = await axios.put(`/api/alerts/triggers/${form.id}`, form, { headers })
      setTriggers(t => t.map(x => x.id === data.id ? data : x))
    }
    setModal(null)
    setForm(BLANK_TRIGGER)
    setDeviceVars([])
    setCustomVar(false)
  }

  function openEdit(t) {
    setForm({ ...t })
    setCustomVar(false)
    setDeviceVars([])
    setModal('edit')
    loadDeviceVars(t.deviceId)
  }

  async function deleteTrigger() {
    await axios.delete(`/api/alerts/triggers/${confirmDel.id}`, { headers })
    setTriggers(t => t.filter(x => x.id !== confirmDel.id))
    setConfirmDel(null)
  }

  function conditionLabel(cond) {
    return ALL_CONDITIONS.find(c => c.value === cond)?.label || cond
  }

  const inputCls = 'w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors'
  const inputStyle = { background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }
  const onFocus = e => e.target.style.borderColor = 'var(--flux-accent)'
  const onBlur  = e => e.target.style.borderColor = 'var(--flux-border)'

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>Alerts</h1>
        {tab === 'triggers' && canWrite && (
          <button onClick={() => { setForm(BLANK_TRIGGER); setDeviceVars([]); setCustomVar(false); setModal('add') }}
            className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all"
            style={{ background: 'var(--flux-accent)', color: '#fff' }}
            onMouseEnter={e => e.target.style.boxShadow = '0 0 20px var(--flux-glow)'}
            onMouseLeave={e => e.target.style.boxShadow = 'none'}>
            + New Trigger
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg w-fit"
        style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
        {['history', 'triggers'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="font-display font-semibold text-sm px-4 py-1.5 rounded-md capitalize transition-colors"
            style={{
              background: tab === t ? 'var(--flux-accent)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--flux-muted)',
            }}>
            {t}
            {t === 'history' && history.filter(a => !a.resolved).length > 0 && (
              <span className="ml-2 font-mono text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--flux-critical)', color: '#fff' }}>
                {history.filter(a => !a.resolved).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-2">
          {history.length === 0 && (
            <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>No alerts yet.</p>
          )}
          {history.map(alert => (
            <div key={alert.id} className="rounded-lg p-4 flex items-start justify-between gap-4"
              style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)', opacity: alert.resolved ? 0.5 : 1 }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold uppercase"
                    style={{ color: SEV_COLOR[alert.severity] }}>{alert.severity}</span>
                  <span className="font-sans text-sm" style={{ color: 'var(--flux-text)' }}>{alert.message}</span>
                </div>
                <p className="font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>
                  {new Date(alert.createdAt).toLocaleString()}
                </p>
              </div>
              {!alert.resolved ? (
                <button onClick={() => resolve(alert.id)}
                  className="font-sans text-xs shrink-0 px-3 py-1 rounded transition-colors"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}
                  onMouseEnter={e => { e.target.style.borderColor = 'var(--flux-healthy)'; e.target.style.color = 'var(--flux-healthy)' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'var(--flux-border)'; e.target.style.color = 'var(--flux-muted)' }}>
                  Resolve
                </button>
              ) : (
                <span className="font-mono text-xs shrink-0" style={{ color: 'var(--flux-healthy)' }}>Resolved</span>
              )}
            </div>
          ))}
          {history.length < historyCount && (
            <button onClick={() => loadHistory(history.length)} disabled={loadingMore}
              className="w-full font-sans text-sm py-2 rounded-lg transition-colors"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', opacity: loadingMore ? 0.5 : 1 }}>
              {loadingMore ? 'Loading…' : `Load more (${history.length} of ${historyCount})`}
            </button>
          )}
        </div>
      )}

      {/* Triggers tab */}
      {tab === 'triggers' && (
        <div className="space-y-2">
          {triggers.length === 0 && (
            <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              No triggers yet.{canWrite ? ' Click "+ New Trigger" to create one.' : ''}
            </p>
          )}
          {triggers.map(t => {
            const dev = devices.find(d => d.id === t.deviceId)
            const varLabel = VAR_LABELS[t.variable] || t.variable
            return (
              <div key={t.id} className="rounded-lg p-4 flex items-center justify-between gap-4"
                style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-xs font-semibold uppercase"
                      style={{ color: SEV_COLOR[t.severity] }}>{t.severity}</span>
                    <span className="font-sans text-sm" style={{ color: 'var(--flux-text)' }}>
                      {dev?.name || `Device ${t.deviceId}`}
                    </span>
                  </div>
                  <p className="font-mono text-xs" style={{ color: 'var(--flux-muted)' }}>
                    {varLabel} {conditionLabel(t.condition)} {t.threshold} · cooldown {t.cooldown}s
                    {t.emailEnabled && ' · email'}
                    {t.fireOnce && ' · once'}
                    {t.notifyOnRecovery && ' · recovery'}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => openEdit(t)}
                      className="font-sans text-xs transition-colors"
                      style={{ color: 'var(--flux-muted)' }}
                      onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
                      onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>Edit</button>
                    <button onClick={() => setConfirmDel(t)}
                      className="font-sans text-xs transition-colors"
                      style={{ color: 'var(--flux-muted)' }}
                      onMouseEnter={e => e.target.style.color = 'var(--flux-critical)'}
                      onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>Delete</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Trigger modal */}
      {modal && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-md rounded-xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>
                {modal === 'add' ? 'New Trigger' : 'Edit Trigger'}
              </h2>
              <button onClick={() => { setModal(null); setCustomVar(false); setDeviceVars([]) }} className="font-mono text-lg" style={{ color: 'var(--flux-muted)' }}>×</button>
            </div>
            <form onSubmit={saveTrigger} className="space-y-3">

              {/* Device */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Device</label>
                <select value={String(form.deviceId ?? '')} onChange={e => handleDeviceChange(e.target.value)}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required>
                  <option value="">Select device…</option>
                  {devices.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </select>
              </div>

              {/* Variable */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Variable</label>
                {!customVar ? (
                  <select
                    value={form.variable}
                    onChange={e => handleVarChange(e.target.value)}
                    className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required={!customVar}>
                    <option value="">Select variable…</option>
                    {deviceVars.map(k => (
                      <option key={k} value={k}>{VAR_LABELS[k] || k}</option>
                    ))}
                    <option value="__custom__">Custom variable…</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input type="text" placeholder="e.g. battery.charge"
                      value={form.variable}
                      onChange={e => setForm(f => ({ ...f, variable: e.target.value }))}
                      className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required />
                    <button type="button" onClick={() => { setCustomVar(false); setForm(f => ({ ...f, variable: '' })) }}
                      className="font-sans text-xs px-3 rounded-lg shrink-0"
                      style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                      ←
                    </button>
                  </div>
                )}
              </div>

              {/* Condition */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Condition</label>
                <select value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur}>
                  {conditionsFor(form.variable).map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Threshold */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>
                  {isStringVar(form.variable) ? 'Value to match' : 'Threshold'}
                </label>
                <input
                  type={isStringVar(form.variable) ? 'text' : 'number'}
                  step={isStringVar(form.variable) ? undefined : 'any'}
                  placeholder={isStringVar(form.variable) ? 'e.g. OB' : ''}
                  value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required />
                {form.variable === 'ups.status' && (
                  <p className="font-sans text-xs mt-1" style={{ color: 'var(--flux-dim)' }}>
                    Common values: OL (online), OB (on battery), LB (battery low), CHRG (charging)
                  </p>
                )}
              </div>

              {/* Severity */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Severity</label>
                <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              {/* Cooldown */}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Cooldown (seconds)</label>
                <input type="number" value={form.cooldown}
                  onChange={e => setForm(f => ({ ...f, cooldown: +e.target.value }))}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              </div>

              {/* Email */}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="emailEnabled" checked={form.emailEnabled}
                  onChange={e => setForm(f => ({ ...f, emailEnabled: e.target.checked }))} />
                <label htmlFor="emailEnabled" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                  Send email alert
                </label>
              </div>

              {/* Fire once */}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="fireOnce" checked={form.fireOnce}
                  onChange={e => setForm(f => ({ ...f, fireOnce: e.target.checked }))} />
                <label htmlFor="fireOnce" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                  Fire once per event (edge-triggered — won't repeat until condition resets)
                </label>
              </div>

              {/* Notify on recovery */}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="notifyOnRecovery" checked={form.notifyOnRecovery}
                  onChange={e => setForm(f => ({ ...f, notifyOnRecovery: e.target.checked }))} />
                <label htmlFor="notifyOnRecovery" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                  Notify when condition clears (recovery alert)
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="flex-1 font-display font-semibold text-sm py-2 rounded-lg transition-all"
                  style={{ background: 'var(--flux-accent)', color: '#fff' }}>
                  {modal === 'add' ? 'Create Trigger' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => { setModal(null); setCustomVar(false); setDeviceVars([]) }}
                  className="flex-1 font-sans text-sm py-2 rounded-lg"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete trigger confirm */}
      {confirmDel && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <h2 className="font-display font-bold text-base mb-3" style={{ color: 'var(--flux-text)' }}>Delete Trigger</h2>
            <p className="font-sans text-sm mb-6" style={{ color: 'var(--flux-muted)' }}>
              Delete trigger for <span style={{ color: 'var(--flux-text)' }}>{VAR_LABELS[confirmDel.variable] || confirmDel.variable}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={deleteTrigger}
                className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                style={{ background: 'var(--flux-critical)', color: '#fff' }}>Delete</button>
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 font-sans text-sm py-2 rounded-lg"
                style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

