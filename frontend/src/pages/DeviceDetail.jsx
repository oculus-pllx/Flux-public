import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../App'
import SshInstallModal from '../components/SshInstallModal'

const PRIORITY = [
  { key: 'ups.status',             label: 'Status' },
  { key: 'battery.charge',         label: 'Battery',   suffix: '%' },
  { key: 'ups.load',               label: 'Load',      suffix: '%' },
  { key: 'battery.runtime',        label: 'Runtime',   fmt: v => `${Math.floor(v/60)}m ${v%60}s` },
  { key: 'input.voltage',          label: 'Input V',   suffix: 'V' },
  { key: 'battery.voltage',        label: 'Batt V',    suffix: 'V' },
  { key: 'ups.realpower.nominal',  label: 'Capacity',  suffix: 'W' },
  { key: 'ups.temperature',        label: 'Temp',      suffix: '°C' },
]

const SECTIONS = [
  { title: 'Battery', prefix: 'battery.' },
  { title: 'Input',   prefix: 'input.' },
  { title: 'Output',  prefix: 'output.' },
  { title: 'UPS',     prefix: 'ups.' },
  { title: 'Driver',  prefix: 'driver.' },
  { title: 'Device',  prefix: 'device.' },
]

const DANGEROUS_CMDS = ['shutdown', 'load.off', 'turnoff', 'bypass.start']

// Maps command name → { var, active } for green "currently active" highlight
const CMD_STATUS = {
  'beeper.disable':    { var: 'ups.beeper.status', active: 'disabled' },
  'beeper.enable':     { var: 'ups.beeper.status', active: 'enabled' },
  'beeper.mute':       { var: 'ups.beeper.status', active: 'muted' },
  'outlet.1.load.on':  { var: 'outlet.1.status',  active: 'on' },
  'outlet.1.load.off': { var: 'outlet.1.status',  active: 'off' },
  'outlet.2.load.on':  { var: 'outlet.2.status',  active: 'on' },
  'outlet.2.load.off': { var: 'outlet.2.status',  active: 'off' },
  'outlet.3.load.on':  { var: 'outlet.3.status',  active: 'on' },
  'outlet.3.load.off': { var: 'outlet.3.status',  active: 'off' },
}

const BLANK_MACHINE = { name: '', host: '', sshPort: 22, sshUser: 'root', sshAuthType: 'password', sshPassword: '', sshKeyPath: '', sshKeyContent: '', useKeyContent: false, shutdownCommand: 'sudo shutdown -h now', shutdownDelay: 0, description: '' }

export default function DeviceDetail() {
  const { id } = useParams()
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [device, setDevice]   = useState(null)
  const [metrics, setMetrics] = useState([])
  const [polling, setPolling] = useState(false)
  const [tab, setTab]         = useState('overview')

  // Control tab state
  const [commands, setCommands]   = useState(null)
  const [rwVars, setRwVars]       = useState(null)
  const [confirmCmd, setConfirmCmd] = useState(null)
  const [editVar, setEditVar]     = useState(null)
  const [editVal, setEditVal]     = useState('')
  const [cmdBusy, setCmdBusy]     = useState(false)

  // Hosts tab state
  const [machines, setMachines]   = useState(null)
  const [machineModal, setMachineModal] = useState(false)
  const [machineForm, setMachineForm]   = useState(BLANK_MACHINE)
  const [editMachine, setEditMachine]   = useState(null)
  const [confirmShutdown, setConfirmShutdown] = useState(null)
  const [machineStatus, setMachineStatus]     = useState({}) // id → { loading, error, ok }
  const [deployNutTarget, setDeployNutTarget] = useState(null)
  const [deployNutForm, setDeployNutForm]     = useState({})
  const [deployNutBusy, setDeployNutBusy]     = useState(false)
  const [deployNutLog, setDeployNutLog]       = useState('')
  const [installModal, setInstallModal]       = useState(null) // null | machine object

  const headers    = { Authorization: `Bearer ${token}` }
  const canWrite   = user?.role === 'admin' || user?.role === 'operator'

  useEffect(() => {
    axios.get(`/api/devices/${id}`, { headers }).then(r => setDevice(r.data))
    axios.get(`/api/metrics/device/${id}`, { headers }).then(r => setMetrics(r.data))
  }, [id])

  // Lazy-load control data when tab opens
  useEffect(() => {
    if (tab === 'control' && commands === null) {
      axios.get(`/api/devices/${id}/control/commands`, { headers })
        .then(r => setCommands(r.data))
        .catch(() => setCommands([]))
      axios.get(`/api/devices/${id}/control/vars/rw`, { headers })
        .then(r => setRwVars(r.data))
        .catch(() => setRwVars({}))
    }
    if (tab === 'hosts' && machines === null) {
      axios.get(`/api/devices/${id}/machines`, { headers })
        .then(r => setMachines(r.data))
        .catch(() => setMachines([]))
    }
  }, [tab])

  async function pollNow() {
    setPolling(true)
    try {
      const { data } = await axios.post(`/api/devices/${id}/poll`, {}, { headers })
      setDevice(d => ({ ...d, lastStatus: data.data, lastSeen: new Date().toISOString() }))
    } catch {}
    setPolling(false)
  }

  async function runCmd(cmd) {
    setCmdBusy(true)
    try {
      await axios.post(`/api/devices/${id}/control/commands/${encodeURIComponent(cmd)}`, {}, { headers })
    } catch (err) {
      alert(`Command failed: ${err.response?.data?.error || err.message}`)
    }
    setCmdBusy(false)
    setConfirmCmd(null)
  }

  async function saveVar() {
    try {
      await axios.put(`/api/devices/${id}/control/vars/${encodeURIComponent(editVar)}`, { value: editVal }, { headers })
      setRwVars(v => ({ ...v, [editVar]: editVal }))
    } catch (err) {
      alert(`Set failed: ${err.response?.data?.error || err.message}`)
    }
    setEditVar(null)
  }

  async function addMachine(e) {
    e.preventDefault()
    try {
      const payload = { ...machineForm }
      if (!machineForm.useKeyContent || !machineForm.sshKeyContent) delete payload.sshKeyContent
      delete payload.useKeyContent
      const { data } = await axios.post(`/api/devices/${id}/machines`, payload, { headers })
      setMachines(m => [...m, data])
      setMachineModal(false)
      setMachineForm(BLANK_MACHINE)
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`)
    }
  }

  async function deleteMachine(mid) {
    await axios.delete(`/api/devices/${id}/machines/${mid}`, { headers })
    setMachines(m => m.filter(x => x.id !== mid))
  }

  async function saveEditMachine() {
    const payload = {
      name: editMachine.name,
      host: editMachine.host,
      sshPort: editMachine.sshPort,
      sshUser: editMachine.sshUser,
      sshAuthType: editMachine.sshAuthType,
      sshKeyPath: editMachine.sshKeyPath,
      shutdownCommand: editMachine.shutdownCommand,
      shutdownDelay: editMachine.shutdownDelay,
      description: editMachine.description,
    }
    if (editMachine.sshPassword) payload.sshPassword = editMachine.sshPassword
    if (editMachine.useKeyContent && editMachine.sshKeyContent) payload.sshKeyContent = editMachine.sshKeyContent
    try {
      await axios.put(`/api/devices/${id}/machines/${editMachine.id}`, payload, { headers })
      const { data } = await axios.get(`/api/devices/${id}/machines`, { headers })
      setMachines(data)
      setEditMachine(null)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save changes')
    }
  }

  async function deployNut() {
    setDeployNutBusy(true)
    setDeployNutLog('')
    try {
      const { data } = await axios.post(
        `/api/devices/${id}/machines/${deployNutTarget.id}/deploy-nut`,
        deployNutForm,
        { headers }
      )
      setDeployNutLog(data.output || 'Deployed successfully.')
      const { data: machines } = await axios.get(`/api/devices/${id}/machines`, { headers })
      setMachines(machines)
    } catch (err) {
      setDeployNutLog(`Error: ${err.response?.data?.error || err.message}`)
    }
    setDeployNutBusy(false)
  }

  async function resetHostKey(machine) {
    try {
      await axios.post(`/api/devices/${id}/machines/${machine.id}/reset-host-key`, {}, { headers })
      setMachineStatus(s => ({ ...s, [machine.id]: { ok: true, msg: 'Host key reset — next connection will re-pin' } }))
      const { data } = await axios.get(`/api/devices/${id}/machines`, { headers })
      setMachines(data)
    } catch (err) {
      setMachineStatus(s => ({ ...s, [machine.id]: { error: err.response?.data?.error || err.message } }))
    }
  }

  async function testMachine(machine) {
    setMachineStatus(s => ({ ...s, [machine.id]: { loading: true } }))
    try {
      const { data } = await axios.post(`/api/devices/${id}/machines/${machine.id}/test`, {}, { headers })
      setMachineStatus(s => ({ ...s, [machine.id]: { ok: true, msg: `Connected (${data.output})` } }))
    } catch (err) {
      setMachineStatus(s => ({ ...s, [machine.id]: { error: err.response?.data?.error || err.message } }))
    }
  }

  async function shutdownMachine(machine) {
    setConfirmShutdown(null)
    setMachineStatus(s => ({ ...s, [machine.id]: { loading: true } }))
    try {
      await axios.post(`/api/devices/${id}/machines/${machine.id}/shutdown`, {}, { headers })
      setMachineStatus(s => ({ ...s, [machine.id]: { ok: true, msg: 'Shutdown sent' } }))
      setMachines(m => m.map(x => x.id === machine.id ? { ...x, lastAction: 'shutdown', lastActionAt: new Date().toISOString() } : x))
    } catch (err) {
      setMachineStatus(s => ({ ...s, [machine.id]: { error: err.response?.data?.error || err.message } }))
    }
  }

  if (!device) return <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>Loading…</p>

  const v = device.lastStatus || {}

  const chartData = metrics.map(m => ({
    time:   new Date(m.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    charge: parseFloat(m.data?.['battery.charge']),
    load:   parseFloat(m.data?.['ups.load']),
  })).filter(p => !isNaN(p.charge) || !isNaN(p.load))

  const usedKeys = new Set(PRIORITY.map(p => p.key))
  const sections = SECTIONS.map(s => ({
    ...s,
    entries: Object.entries(v)
      .filter(([k]) => k.startsWith(s.prefix) && !usedKeys.has(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  })).filter(s => s.entries.length > 0)

  const otherEntries = Object.entries(v).filter(
    ([k]) => !usedKeys.has(k) && !SECTIONS.some(s => k.startsWith(s.prefix))
  )

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'control',  label: 'Control' },
  ]

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <button onClick={() => navigate(-1)}
            className="font-sans text-sm mb-2 block transition-colors"
            style={{ color: 'var(--flux-muted)' }}
            onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
            onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
            ← Back
          </button>
          <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>{device.name}</h1>
          <p className="font-mono text-sm mt-1" style={{ color: 'var(--flux-muted)' }}>
            {device.host}:{device.port} · {device.upsName}
            {device.lastSeen && (
              <span style={{ color: 'var(--flux-dim)' }}> · polled {new Date(device.lastSeen).toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        {canWrite && (
          <button onClick={pollNow} disabled={polling}
            className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all disabled:opacity-50"
            style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--flux-accent)'; e.currentTarget.style.color = 'var(--flux-accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--flux-border)'; e.currentTarget.style.color = 'var(--flux-muted)' }}>
            {polling ? 'Polling…' : '↻ Poll Now'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--flux-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="font-display font-semibold text-sm px-4 py-2 transition-colors"
            style={{
              color: tab === t.key ? 'var(--flux-accent)' : 'var(--flux-muted)',
              borderBottom: tab === t.key ? '2px solid var(--flux-accent)' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <>
          {Object.keys(v).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {PRIORITY.map(({ key, label, suffix, fmt }) => {
                const raw = v[key]
                if (raw === undefined) return null
                const display = fmt ? fmt(parseFloat(raw)) : (suffix ? `${raw}${suffix}` : raw)
                const isStatus = key === 'ups.status'
                const statusColor = raw.includes('OL') ? 'var(--flux-healthy)'
                  : raw.includes('OB') || raw.includes('CHRG') ? 'var(--flux-warning)'
                  : raw.includes('LB') || raw.includes('RB') ? 'var(--flux-critical)'
                  : 'var(--flux-text)'
                return (
                  <div key={key} className="rounded-lg p-4"
                    style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
                    <p className="font-sans text-xs mb-1" style={{ color: 'var(--flux-dim)' }}>{label}</p>
                    <p className="font-mono text-lg font-semibold leading-tight"
                      style={{ color: isStatus ? statusColor : 'var(--flux-text)' }}>
                      {display}
                    </p>
                  </div>
                )
              }).filter(Boolean)}
            </div>
          )}

          {chartData.length > 1 && (
            <div className="rounded-lg p-5 mb-6"
              style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
              <h2 className="font-display font-semibold text-sm mb-4" style={{ color: 'var(--flux-text)' }}>24h History</h2>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <XAxis dataKey="time" tick={{ fill: 'var(--flux-dim)', fontSize: 10, fontFamily: 'IBM Plex Mono' }} />
                  <YAxis tick={{ fill: 'var(--flux-dim)', fontSize: 10, fontFamily: 'IBM Plex Mono' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)', fontFamily: 'IBM Plex Mono', fontSize: 12 }}
                    labelStyle={{ color: 'var(--flux-muted)' }}
                  />
                  <Line type="monotone" dataKey="charge" stroke="var(--flux-healthy)" dot={false} name="Battery %" />
                  <Line type="monotone" dataKey="load"   stroke="var(--flux-accent)"  dot={false} name="Load %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {Object.keys(v).length > 0 && (
            <div className="rounded-lg p-5"
              style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
              <h2 className="font-display font-semibold text-sm mb-4" style={{ color: 'var(--flux-text)' }}>All Variables</h2>
              <div className="space-y-6">
                {sections.map(s => (
                  <div key={s.title}>
                    <p className="font-display text-xs font-semibold mb-2 uppercase tracking-widest"
                      style={{ color: 'var(--flux-dim)' }}>{s.title}</p>
                    <VarTable entries={s.entries} />
                  </div>
                ))}
                {otherEntries.length > 0 && (
                  <div>
                    <p className="font-display text-xs font-semibold mb-2 uppercase tracking-widest"
                      style={{ color: 'var(--flux-dim)' }}>Other</p>
                    <VarTable entries={otherEntries} />
                  </div>
                )}
              </div>
            </div>
          )}

          {Object.keys(v).length === 0 && (
            <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>No data yet — waiting for first poll.</p>
          )}
        </>
      )}

      {/* ── Control tab ── */}
      {tab === 'control' && (
        <div className="space-y-6">
          {/* INSTCMD section */}
          <div className="rounded-lg p-5"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <h2 className="font-display font-semibold text-sm mb-4" style={{ color: 'var(--flux-text)' }}>
              UPS Commands
              {!canWrite && <span className="ml-2 font-sans text-xs normal-case" style={{ color: 'var(--flux-muted)' }}>(read-only)</span>}
            </h2>
            {commands === null && (
              <p className="font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>Loading…</p>
            )}
            {commands !== null && commands.length === 0 && (
              <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                No commands available. NUT credentials may be required — add them in device settings.
              </p>
            )}
            {commands !== null && commands.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {commands.map(cmd => {
                  const isDangerous = DANGEROUS_CMDS.some(d => cmd.includes(d))
                  const statusMap = CMD_STATUS[cmd]
                  const isActive = statusMap && v[statusMap.var] === statusMap.active
                  const borderColor = isActive ? 'var(--flux-healthy)' : isDangerous ? 'var(--flux-critical)' : 'var(--flux-border)'
                  const textColor   = isActive ? 'var(--flux-healthy)' : isDangerous ? 'var(--flux-critical)' : 'var(--flux-muted)'
                  const hoverBg     = isActive ? 'rgba(34,197,94,0.1)' : isDangerous ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.04)'
                  return (
                    <button key={cmd} disabled={!canWrite || cmdBusy}
                      onClick={() => isDangerous ? setConfirmCmd(cmd) : runCmd(cmd)}
                      className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      style={{ border: `1px solid ${borderColor}`, color: textColor, background: 'transparent' }}
                      onMouseEnter={e => !e.currentTarget.disabled && (e.currentTarget.style.background = hoverBg)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      {cmd}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* RW Variables section */}
          <div className="rounded-lg p-5"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <h2 className="font-display font-semibold text-sm mb-4" style={{ color: 'var(--flux-text)' }}>Read-Write Variables</h2>
            {rwVars === null && (
              <p className="font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>Loading…</p>
            )}
            {rwVars !== null && Object.keys(rwVars).length === 0 && (
              <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>No writable variables found. NUT credentials may be required — add them in device settings.</p>
            )}
            {rwVars !== null && Object.keys(rwVars).length > 0 && (
              <div className="space-y-1">
                {Object.entries(rwVars).map(([k, val]) => (
                  <div key={k} className="flex items-center justify-between py-2"
                    style={{ borderBottom: '1px solid var(--flux-border)' }}>
                    <span className="font-mono text-xs" style={{ color: 'var(--flux-muted)' }}>{k}</span>
                    <div className="flex items-center gap-3">
                      {editVar === k ? (
                        <>
                          <input value={editVal} onChange={e => setEditVal(e.target.value)}
                            className="font-mono text-xs rounded px-2 py-1 w-32 outline-none"
                            style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-accent)', color: 'var(--flux-text)' }}
                            onKeyDown={e => { if (e.key === 'Enter') saveVar(); if (e.key === 'Escape') setEditVar(null) }}
                            autoFocus />
                          <button onClick={saveVar}
                            className="font-sans text-xs px-2 py-1 rounded"
                            style={{ background: 'var(--flux-accent)', color: '#fff' }}>Save</button>
                          <button onClick={() => setEditVar(null)}
                            className="font-sans text-xs"
                            style={{ color: 'var(--flux-muted)' }}>×</button>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-xs" style={{ color: 'var(--flux-text)' }}>
                            {val}{nutUnit(k) && <span style={{ color: 'var(--flux-dim)' }}> {nutUnit(k)}</span>}
                          </span>
                          {canWrite && (
                            <button onClick={() => { setEditVar(k); setEditVal(val) }}
                              className="font-sans text-xs transition-colors"
                              style={{ color: 'var(--flux-dim)' }}
                              onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
                              onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                              Edit
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hosts tab ── */}
      {tab === 'hosts' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              Connected machines will receive automatic shutdown when this UPS goes on battery with low charge.
            </p>
            {canWrite && (
              <button onClick={() => setMachineModal(true)}
                className="font-display font-semibold text-sm px-4 py-2 rounded-lg ml-4 shrink-0"
                style={{ background: 'var(--flux-accent)', color: '#fff' }}>
                + Add Host
              </button>
            )}
          </div>

          {machines === null && (
            <p className="font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>Loading…</p>
          )}
          {machines !== null && machines.length === 0 && (
            <div className="rounded-lg p-8 text-center"
              style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
              <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>No hosts configured yet.</p>
            </div>
          )}
          {machines !== null && machines.length > 0 && (
            <div className="rounded-lg overflow-hidden"
              style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--flux-border)' }}>
                    {['Name', 'Host', 'Auth', 'Shutdown Delay', 'Last Action', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-display text-xs font-semibold uppercase tracking-widest"
                        style={{ color: 'var(--flux-dim)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {machines.map(m => {
                    const st = machineStatus[m.id]
                    return (
                      <tr key={m.id} className="last:border-0"
                        style={{ borderBottom: '1px solid var(--flux-border)' }}>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm" style={{ color: 'var(--flux-text)' }}>{m.name}</span>
                          {m.description && (
                            <span className="block font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>{m.description}</span>
                          )}
                          {m.nutMonitorDeployed && (
                            <span className="font-mono text-xs mt-0.5 block" style={{
                              color: (m.nutMonitorStatus || '').startsWith('running') ? 'var(--flux-healthy)'
                                   : (m.nutMonitorStatus || '').startsWith('error')   ? 'var(--flux-critical)'
                                   : 'var(--flux-dim)',
                            }}>
                              nut: {m.nutMonitorStatus || 'deployed'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--flux-muted)' }}>
                          {m.host}:{m.sshPort}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>
                          {m.sshUser} / {m.sshAuthType}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: m.shutdownDelay > 0 ? 'var(--flux-warning)' : 'var(--flux-dim)' }}>
                          {m.shutdownDelay > 0 ? `${m.shutdownDelay}s` : 'immediate'}
                        </td>
                        <td className="px-4 py-3 font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>
                          {st?.loading && <span style={{ color: 'var(--flux-warning)' }}>…</span>}
                          {st?.ok    && <span style={{ color: 'var(--flux-healthy)' }}>{st.msg}</span>}
                          {st?.error && <span style={{ color: 'var(--flux-critical)' }}>{st.error}</span>}
                          {user?.role === 'admin' &&
                            ((st?.error || '').includes('Host key') || (m.nutMonitorStatus || '').includes('Host key')) && (
                            <button onClick={() => resetHostKey(m)}
                              className="block font-sans text-xs mt-1 px-2 py-0.5 rounded"
                              style={{ background: 'none', border: '1px solid var(--flux-warning)', color: 'var(--flux-warning)', cursor: 'pointer' }}>
                              Trust new host key
                            </button>
                          )}
                          {!st && m.lastAction && (
                            <span>
                              {m.lastAction}
                              {m.lastActionAt && <span style={{ color: 'var(--flux-dim)' }}> · {new Date(m.lastActionAt).toLocaleString()}</span>}
                            </span>
                          )}
                          {!st && !m.lastAction && '—'}
                        </td>
                        <td className="px-4 py-3">
                          {canWrite && (
                            <div className="flex items-center gap-3 justify-end">
                              <button onClick={() => {
                                setDeployNutTarget(m)
                                setDeployNutForm({ nutHost: device.host, nutPort: device.port, upsName: device.upsName, nutUsername: device.nutUsername || '', nutPassword: '' })
                                setDeployNutLog('')
                              }}
                                className="font-sans text-xs transition-colors"
                                style={{ color: 'var(--flux-dim)' }}
                                onMouseEnter={e => e.target.style.color = 'var(--flux-healthy)'}
                                onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                                NUT
                              </button>
                              <button onClick={() => setInstallModal(m)}
                                title="Install Flux agent via SSH"
                                style={{
                                  background: 'none', border: '1px solid var(--flux-accent)',
                                  color: 'var(--flux-accent)', borderRadius: '6px',
                                  padding: '4px 10px', fontSize: '12px',
                                  fontFamily: 'IBM Plex Mono, monospace', cursor: 'pointer',
                                }}>
                                ⬆ Agent
                              </button>
                              <button onClick={() => setEditMachine({ ...m, sshPassword: '', useKeyContent: false, sshKeyContent: '' })}
                                className="font-sans text-xs transition-colors"
                                style={{ color: 'var(--flux-dim)' }}
                                onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
                                onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                                Edit
                              </button>
                              <button onClick={() => testMachine(m)}
                                className="font-sans text-xs transition-colors"
                                style={{ color: 'var(--flux-dim)' }}
                                onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
                                onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                                Test
                              </button>
                              <button onClick={() => setConfirmShutdown(m)}
                                className="font-sans text-xs transition-colors"
                                style={{ color: 'var(--flux-dim)' }}
                                onMouseEnter={e => e.target.style.color = 'var(--flux-critical)'}
                                onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                                Shutdown
                              </button>
                              <button onClick={() => deleteMachine(m.id)}
                                className="font-sans text-xs transition-colors"
                                style={{ color: 'var(--flux-dim)' }}
                                onMouseEnter={e => e.target.style.color = 'var(--flux-critical)'}
                                onMouseLeave={e => e.target.style.color = 'var(--flux-dim)'}>
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm dangerous command modal ── */}
      {confirmCmd && (
        <Modal onClose={() => setConfirmCmd(null)}>
          <h2 className="font-display font-bold text-base mb-3" style={{ color: 'var(--flux-text)' }}>Confirm Command</h2>
          <p className="font-sans text-sm mb-6" style={{ color: 'var(--flux-muted)' }}>
            Run <span className="font-mono" style={{ color: 'var(--flux-critical)' }}>{confirmCmd}</span> on {device.name}?
            This may interrupt power to connected devices.
          </p>
          <div className="flex gap-3">
            <button onClick={() => runCmd(confirmCmd)} disabled={cmdBusy}
              className="flex-1 font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--flux-critical)', color: '#fff' }}>Run</button>
            <button onClick={() => setConfirmCmd(null)}
              className="flex-1 font-sans text-sm py-2 rounded-lg"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Confirm shutdown modal ── */}
      {confirmShutdown && (
        <Modal onClose={() => setConfirmShutdown(null)}>
          <h2 className="font-display font-bold text-base mb-3" style={{ color: 'var(--flux-text)' }}>Shutdown Host</h2>
          <p className="font-sans text-sm mb-2" style={{ color: 'var(--flux-muted)' }}>
            Send shutdown command to <span style={{ color: 'var(--flux-text)' }} className="font-semibold">{confirmShutdown.name}</span> ({confirmShutdown.host})?
          </p>
          <p className="font-mono text-xs mb-6 px-3 py-2 rounded"
            style={{ background: 'var(--flux-bg)', color: 'var(--flux-dim)', border: '1px solid var(--flux-border)' }}>
            {confirmShutdown.shutdownCommand}
          </p>
          <div className="flex gap-3">
            <button onClick={() => shutdownMachine(confirmShutdown)}
              className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
              style={{ background: 'var(--flux-critical)', color: '#fff' }}>Shutdown</button>
            <button onClick={() => setConfirmShutdown(null)}
              className="flex-1 font-sans text-sm py-2 rounded-lg"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── Add machine modal ── */}
      {machineModal && (
        <Modal onClose={() => setMachineModal(false)}>
          <h2 className="font-display font-bold text-base mb-4" style={{ color: 'var(--flux-text)' }}>Add Host</h2>
          <form onSubmit={addMachine} className="space-y-3">
            {[
              ['name',            'Name',                        'text'],
              ['host',            'Hostname / IP',               'text'],
              ['sshPort',         'SSH Port',                    'number'],
              ['sshUser',         'SSH User',                    'text'],
              ['shutdownCommand', 'Shutdown Command',            'text'],
              ['shutdownDelay',   'Shutdown Delay (seconds)',    'number'],
              ['description',     'Description',                 'text'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                <input type={type} value={machineForm[key]}
                  onChange={e => setMachineForm(f => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                  min={type === 'number' && key === 'shutdownDelay' ? 0 : undefined}
                  required={['name', 'host'].includes(key)} />
              </div>
            ))}
            <div>
              <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Auth Type</label>
              <select value={machineForm.sshAuthType}
                onChange={e => setMachineForm(f => ({ ...f, sshAuthType: e.target.value }))}
                className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}>
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
              </select>
            </div>
            {machineForm.sshAuthType === 'password' ? (
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Password</label>
                <input type="password" value={machineForm.sshPassword}
                  onChange={e => setMachineForm(f => ({ ...f, sshPassword: e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                  <button type="button"
                    onClick={() => setMachineForm(p => ({ ...p, useKeyContent: false }))}
                    style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                      background: !machineForm.useKeyContent ? 'var(--flux-accent)' : 'none',
                      color: !machineForm.useKeyContent ? '#fff' : 'var(--flux-muted)',
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                    Key File Path
                  </button>
                  <button type="button"
                    onClick={() => setMachineForm(p => ({ ...p, useKeyContent: true }))}
                    style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                      background: machineForm.useKeyContent ? 'var(--flux-accent)' : 'none',
                      color: machineForm.useKeyContent ? '#fff' : 'var(--flux-muted)',
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                    Paste Key
                  </button>
                </div>
                {!machineForm.useKeyContent ? (
                  <div>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Key File Path (on server)</label>
                    <input type="text" value={machineForm.sshKeyPath}
                      onChange={e => setMachineForm(f => ({ ...f, sshKeyPath: e.target.value }))}
                      placeholder="/root/.ssh/id_rsa"
                      className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                      style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                      onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
                  </div>
                ) : (
                  <div>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Private Key Content (PEM)</label>
                    <textarea value={machineForm.sshKeyContent || ''}
                      onChange={e => setMachineForm(f => ({ ...f, sshKeyContent: e.target.value }))}
                      rows={6} placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                      className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                      style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)', resize: 'vertical', fontFamily: 'IBM Plex Mono, monospace' }}
                      onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
                  </div>
                )}
              </>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit"
                className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                style={{ background: 'var(--flux-accent)', color: '#fff' }}>Add Host</button>
              <button type="button" onClick={() => setMachineModal(false)}
                className="flex-1 font-sans text-sm py-2 rounded-lg"
                style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit machine modal ── */}
      {editMachine && (
        <Modal onClose={() => setEditMachine(null)}>
          <h2 className="font-display font-bold text-base mb-4" style={{ color: 'var(--flux-text)' }}>Edit Host</h2>
          <div className="space-y-3">
            {[
              ['name',            'Name',                        'text'],
              ['host',            'Hostname / IP',               'text'],
              ['sshPort',         'SSH Port',                    'number'],
              ['sshUser',         'SSH User',                    'text'],
              ['shutdownCommand', 'Shutdown Command',            'text'],
              ['shutdownDelay',   'Shutdown Delay (seconds)',    'number'],
              ['description',     'Description',                 'text'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                <input type={type} value={editMachine[key] ?? ''}
                  onChange={e => setEditMachine(m => ({ ...m, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                  min={type === 'number' && key === 'shutdownDelay' ? 0 : undefined} />
              </div>
            ))}
            <div>
              <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Auth Type</label>
              <select value={editMachine.sshAuthType}
                onChange={e => setEditMachine(m => ({ ...m, sshAuthType: e.target.value }))}
                className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}>
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
              </select>
            </div>
            {editMachine.sshAuthType === 'password' ? (
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Password</label>
                <input type="password" value={editMachine.sshPassword || ''}
                  placeholder="Leave blank to keep existing"
                  onChange={e => setEditMachine(m => ({ ...m, sshPassword: e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                  <button type="button"
                    onClick={() => setEditMachine(p => ({ ...p, useKeyContent: false }))}
                    style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                      background: !editMachine.useKeyContent ? 'var(--flux-accent)' : 'none',
                      color: !editMachine.useKeyContent ? '#fff' : 'var(--flux-muted)',
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                    Key File Path
                  </button>
                  <button type="button"
                    onClick={() => setEditMachine(p => ({ ...p, useKeyContent: true }))}
                    style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                      background: editMachine.useKeyContent ? 'var(--flux-accent)' : 'none',
                      color: editMachine.useKeyContent ? '#fff' : 'var(--flux-muted)',
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                    Paste Key
                  </button>
                </div>
                {!editMachine.useKeyContent ? (
                  <div>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Key File Path (on server)</label>
                    <input type="text" value={editMachine.sshKeyPath || ''}
                      onChange={e => setEditMachine(m => ({ ...m, sshKeyPath: e.target.value }))}
                      placeholder="/root/.ssh/id_rsa"
                      className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                      style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                      onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
                  </div>
                ) : (
                  <div>
                    <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Private Key Content (PEM)</label>
                    <textarea value={editMachine.sshKeyContent || ''}
                      onChange={e => setEditMachine(m => ({ ...m, sshKeyContent: e.target.value }))}
                      rows={6} placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                      className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                      style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)', resize: 'vertical', fontFamily: 'IBM Plex Mono, monospace' }}
                      onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
                  </div>
                )}
              </>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={saveEditMachine}
                className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                style={{ background: 'var(--flux-accent)', color: '#fff' }}>Save Changes</button>
              <button onClick={() => setEditMachine(null)}
                className="flex-1 font-sans text-sm py-2 rounded-lg"
                style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Install SSH Agent modal ── */}
      {installModal && (
        <SshInstallModal
          headers={headers}
          deviceId={id}
          machineId={installModal.id}
          onSuccess={() => {
            setInstallModal(null)
            setMachines(ms => ms.filter(m => m.id !== installModal.id))
          }}
          onClose={() => setInstallModal(null)}
        />
      )}

      {/* ── Deploy NUT Monitor modal ── */}
      {deployNutTarget && (
        <Modal onClose={() => !deployNutBusy && setDeployNutTarget(null)}>
          <h2 className="font-display font-bold text-base mb-1" style={{ color: 'var(--flux-text)' }}>Deploy NUT Monitor</h2>
          <p className="font-sans text-xs mb-4" style={{ color: 'var(--flux-muted)' }}>
            Installs <span className="font-mono">upsmon</span> on <strong>{deployNutTarget.name}</strong> so it monitors the UPS directly and shuts down independently of Flux.
          </p>
          <div className="space-y-3">
            {[
              ['nutHost',     'NUT Server Host', 'text'],
              ['nutPort',     'NUT Server Port', 'number'],
              ['upsName',     'UPS Name',        'text'],
              ['nutUsername', 'NUT Username',    'text'],
              ['nutPassword', 'NUT Password',    'password'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                <input type={type} value={deployNutForm[key] || ''}
                  onChange={e => setDeployNutForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'} />
              </div>
            ))}
          </div>
          {deployNutLog && (
            <pre className="font-mono text-xs mt-4 p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap"
              style={{ background: 'var(--flux-bg)', color: deployNutLog.startsWith('Error') ? 'var(--flux-critical)' : 'var(--flux-healthy)', border: '1px solid var(--flux-border)' }}>
              {deployNutLog}
            </pre>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={deployNut} disabled={deployNutBusy}
              className="flex-1 font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--flux-healthy)', color: '#fff' }}>
              {deployNutBusy ? 'Deploying…' : 'Deploy'}
            </button>
            <button onClick={() => setDeployNutTarget(null)} disabled={deployNutBusy}
              className="flex-1 font-sans text-sm py-2 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
              {deployNutLog && !deployNutBusy ? 'Close' : 'Cancel'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function nutUnit(key) {
  if (/\.(charge|load)(\.|$)/.test(key))       return '%'
  if (/\.voltage(\.|$)/.test(key))              return 'V'
  if (/\.current(\.|$)/.test(key))              return 'A'
  if (/\.(real)?power(\.|$)/.test(key))         return 'W'
  if (/\.temperature(\.|$)/.test(key))          return '°C'
  if (/\.frequency(\.|$)/.test(key))            return 'Hz'
  if (/\.(runtime|delay|timer)(\.|$)/.test(key)) return 's'
  return ''
}

function VarTable({ entries }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
      {entries.map(([k, val]) => {
        const unit = nutUnit(k)
        return (
          <div key={k} className="flex justify-between items-baseline py-1.5"
            style={{ borderBottom: '1px solid var(--flux-border)' }}>
            <span className="font-mono text-xs" style={{ color: 'var(--flux-muted)' }}>{k}</span>
            <span className="font-mono text-xs ml-4 text-right" style={{ color: 'var(--flux-text)' }}>
              {val}{unit && <span style={{ color: 'var(--flux-dim)' }}> {unit}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl p-6 max-h-screen overflow-y-auto"
        style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
        <div className="flex justify-end mb-2">
          <button onClick={onClose} className="font-mono text-lg leading-none" style={{ color: 'var(--flux-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
