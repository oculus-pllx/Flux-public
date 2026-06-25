import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'
import { useNavigate } from 'react-router-dom'

const SMTP_BLANK = {
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
  smtp_from: '', smtp_recipient: '', smtp_secure: 'false',
}

const PVE_BLANK = {
  name: 'Proxmox Cluster',
  clusterId: '',
  apiBaseUrl: '',
  tokenId: '',
  tokenSecret: '',
  haFreezeTimeout: 30,
  enabled: true,
}

const PBS_BLANK = {
  name: 'PBS',
  url: '',
  tokenId: '',
  tokenSecret: '',
  jobAbortTimeout: 120,
  forceShutdown: true,
  upsGroupId: '',
  enabled: true,
}

const sectionStyle = {
  background: 'var(--flux-panel)',
  border: '1px solid var(--flux-border)',
}

const inputBase = 'w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors'

function inputStyle() {
  return { background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }
}

function statusColor(status) {
  if (!status) return 'var(--flux-muted)'
  if (String(status).startsWith('ok') || String(status).includes('sent')) return 'var(--flux-healthy)'
  if (String(status).includes('offline')) return 'var(--flux-warning)'
  return 'var(--flux-critical)'
}

export default function SettingsPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const headers = { Authorization: `Bearer ${token}` }

  const [smtpForm, setSmtpForm] = useState(SMTP_BLANK)
  const [smtpSaved, setSmtpSaved] = useState(false)
  const [testStatus, setTestStatus] = useState(null)

  const [machines, setMachines] = useState([])
  const [devices, setDevices] = useState([])
  const [pveConfigs, setPveConfigs] = useState([])
  const [pbsConfigs, setPbsConfigs] = useState([])
  const [pveForm, setPveForm] = useState(PVE_BLANK)
  const [pbsForm, setPbsForm] = useState(PBS_BLANK)
  const [selectedPveId, setSelectedPveId] = useState('')
  const [selectedPbsId, setSelectedPbsId] = useState('')
  const [pveStatus, setPveStatus] = useState(null)
  const [pbsStatus, setPbsStatus] = useState(null)
  const [discovery, setDiscovery] = useState(null)
  const [pveTargets, setPveTargets] = useState({})
  const [pbsTargetId, setPbsTargetId] = useState('')
  const [assignPbsUps, setAssignPbsUps] = useState(false)

  useEffect(() => {
    if (user?.role !== 'admin') { navigate('/'); return }
    loadAll()
  }, [])

  async function loadAll() {
    const [smtp, pve, pbs, agentRows, deviceRows] = await Promise.all([
      axios.get('/api/settings', { headers }),
      axios.get('/api/settings/proxmox-pbs/proxmox-clusters', { headers }),
      axios.get('/api/settings/proxmox-pbs/pbs-configs', { headers }),
      axios.get('/api/agents', { headers }),
      axios.get('/api/devices', { headers }),
    ])

    const data = { ...smtp.data }
    if (data.smtp_pass === '••••••') data.smtp_pass = ''
    setSmtpForm(f => ({ ...f, ...data }))
    setPveConfigs(pve.data)
    setPbsConfigs(pbs.data)
    setMachines(agentRows.data)
    setDevices(deviceRows.data)

    if (pve.data[0]) selectPve(pve.data[0])
    if (pbs.data[0]) selectPbs(pbs.data[0])
  }

  function selectPve(config) {
    setSelectedPveId(config.id)
    setPveForm({
      ...PVE_BLANK,
      ...config,
      tokenSecret: '',
      haFreezeTimeout: config.haFreezeTimeout ?? 30,
    })
    setDiscovery(null)
    setPveTargets({})
    setPveStatus(null)
  }

  function selectPbs(config) {
    setSelectedPbsId(config.id)
    setPbsForm({
      ...PBS_BLANK,
      ...config,
      tokenSecret: '',
      jobAbortTimeout: config.jobAbortTimeout ?? 120,
      upsGroupId: config.upsGroupId ?? '',
    })
    setPbsStatus(null)
  }

  function smtpField(key) {
    return {
      value: smtpForm[key],
      onChange: e => setSmtpForm(f => ({ ...f, [key]: e.target.value })),
      className: inputBase,
      style: inputStyle(),
    }
  }

  function pveField(key) {
    return {
      value: pveForm[key] ?? '',
      onChange: e => setPveForm(f => ({ ...f, [key]: e.target.value })),
      className: inputBase,
      style: inputStyle(),
    }
  }

  function pbsField(key) {
    return {
      value: pbsForm[key] ?? '',
      onChange: e => setPbsForm(f => ({ ...f, [key]: e.target.value })),
      className: inputBase,
      style: inputStyle(),
    }
  }

  async function saveSmtp(e) {
    e.preventDefault()
    await axios.put('/api/settings', smtpForm, { headers })
    setSmtpSaved(true)
    setTimeout(() => setSmtpSaved(false), 3000)
  }

  async function testEmail() {
    setTestStatus('sending')
    try {
      await axios.post('/api/settings/test-email', {}, { headers })
      setTestStatus('ok')
    } catch (err) {
      setTestStatus(err.response?.data?.error || 'Send failed')
    }
    setTimeout(() => setTestStatus(null), 5000)
  }

  function cleanSecretPayload(form) {
    const payload = { ...form }
    if (!payload.tokenSecret) delete payload.tokenSecret
    return payload
  }

  async function savePve(e) {
    e.preventDefault()
    setPveStatus('saving')
    try {
      const payload = cleanSecretPayload({
        ...pveForm,
        haFreezeTimeout: Number(pveForm.haFreezeTimeout || 30),
      })
      const res = selectedPveId
        ? await axios.put(`/api/settings/proxmox-pbs/proxmox-clusters/${selectedPveId}`, payload, { headers })
        : await axios.post('/api/settings/proxmox-pbs/proxmox-clusters', payload, { headers })
      setPveStatus('ok: saved')
      await refreshPveConfigs(res.data.id)
    } catch (err) {
      setPveStatus(err.response?.data?.error || 'Save failed')
    }
  }

  async function refreshPveConfigs(selectId = selectedPveId) {
    const res = await axios.get('/api/settings/proxmox-pbs/proxmox-clusters', { headers })
    setPveConfigs(res.data)
    const selected = res.data.find(c => String(c.id) === String(selectId))
    if (selected) selectPve(selected)
  }

  async function testPve() {
    if (!selectedPveId) return
    setPveStatus('testing')
    try {
      const res = await axios.post(`/api/settings/proxmox-pbs/proxmox-clusters/${selectedPveId}/test`, {}, { headers })
      setPveStatus(`ok: ${res.data.nodeCount} nodes reachable`)
    } catch (err) {
      setPveStatus(err.response?.data?.error || 'Test failed')
    }
  }

  async function discoverPve() {
    if (!selectedPveId) return
    setPveStatus('discovering')
    try {
      const res = await axios.post(`/api/settings/proxmox-pbs/proxmox-clusters/${selectedPveId}/discover`, {}, { headers })
      setDiscovery(res.data)
      const defaults = {}
      for (const row of res.data.nodes || []) {
        defaults[row.node] = {
          checked: row.status === 'matched',
          agentMachineId: row.agent?.id || '',
        }
      }
      setPveTargets(defaults)
      setPveStatus(`ok: discovered ${res.data.nodes?.length || 0} nodes`)
    } catch (err) {
      setPveStatus(err.response?.data?.error || 'Discovery failed')
    }
  }

  async function applyPve() {
    const targets = Object.entries(pveTargets)
      .filter(([, value]) => value.checked && value.agentMachineId)
      .map(([node, value]) => ({ node, agentMachineId: Number(value.agentMachineId) }))
    if (targets.length === 0) {
      setPveStatus('Select at least one Proxmox node and agent')
      return
    }
    setPveStatus('applying')
    try {
      const res = await axios.post(`/api/settings/proxmox-pbs/proxmox-clusters/${selectedPveId}/apply`, { targets }, { headers })
      await refreshMachines()
      const offline = res.data.applied.filter(r => !r.pushed).length
      setPveStatus(`ok: applied ${res.data.applied.length}${offline ? `, ${offline} saved but offline` : ''}`)
    } catch (err) {
      setPveStatus(err.response?.data?.error || 'Apply failed')
    }
  }

  async function savePbs(e) {
    e.preventDefault()
    setPbsStatus('saving')
    try {
      const payload = cleanSecretPayload({
        ...pbsForm,
        jobAbortTimeout: Number(pbsForm.jobAbortTimeout || 120),
        upsGroupId: pbsForm.upsGroupId || null,
      })
      const res = selectedPbsId
        ? await axios.put(`/api/settings/proxmox-pbs/pbs-configs/${selectedPbsId}`, payload, { headers })
        : await axios.post('/api/settings/proxmox-pbs/pbs-configs', payload, { headers })
      setPbsStatus('ok: saved')
      await refreshPbsConfigs(res.data.id)
    } catch (err) {
      setPbsStatus(err.response?.data?.error || 'Save failed')
    }
  }

  async function refreshPbsConfigs(selectId = selectedPbsId) {
    const res = await axios.get('/api/settings/proxmox-pbs/pbs-configs', { headers })
    setPbsConfigs(res.data)
    const selected = res.data.find(c => String(c.id) === String(selectId))
    if (selected) selectPbs(selected)
  }

  async function testPbs() {
    if (!selectedPbsId) return
    setPbsStatus('testing')
    try {
      const res = await axios.post(`/api/settings/proxmox-pbs/pbs-configs/${selectedPbsId}/test`, {}, { headers })
      setPbsStatus(`ok: ${res.data.runningJobCount || 0} running jobs`)
    } catch (err) {
      setPbsStatus(err.response?.data?.error || 'Test failed')
    }
  }

  async function applyPbs() {
    if (!selectedPbsId || !pbsTargetId) {
      setPbsStatus('Select a PBS config and target agent')
      return
    }
    const payload = { agentMachineId: Number(pbsTargetId) }
    if (assignPbsUps && pbsForm.upsGroupId) payload.assignUpsGroupId = Number(pbsForm.upsGroupId)
    setPbsStatus('applying')
    try {
      const res = await axios.post(`/api/settings/proxmox-pbs/pbs-configs/${selectedPbsId}/apply`, payload, { headers })
      await refreshMachines()
      setPbsStatus(`ok: applied${res.data.pushed ? ' and pushed' : ', saved but offline'}`)
    } catch (err) {
      setPbsStatus(err.response?.data?.error || 'Apply failed')
    }
  }

  async function refreshMachines() {
    const res = await axios.get('/api/agents', { headers })
    setMachines(res.data)
  }

  const pveEligible = machines.filter(m => ['pve-node', 'ups-host', 'both'].includes(m.role))
  const pbsEligible = machines.filter(m => ['pbs', 'both'].includes(m.role))

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>Settings</h1>

      <form onSubmit={saveSmtp}>
        <div className="rounded-lg p-5 mb-4 space-y-3" style={sectionStyle}>
          <p className="font-display text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--flux-dim)' }}>
            Email / SMTP
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {[
              ['smtp_host', 'SMTP Host', 'text', 'smtp.gmail.com'],
              ['smtp_port', 'SMTP Port', 'number', '587'],
              ['smtp_user', 'SMTP Username', 'email', 'you@example.com'],
              ['smtp_pass', 'SMTP Password', 'password', 'leave blank to keep saved password'],
              ['smtp_from', 'From Address', 'text', 'Flux Alerts <you@example.com>'],
              ['smtp_recipient', 'Alert Recipient', 'email', 'you@example.com'],
            ].map(([key, label, type, placeholder]) => (
              <div key={key}>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                <input type={type} placeholder={placeholder} {...smtpField(key)} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-3 font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
            <input type="checkbox"
              checked={smtpForm.smtp_secure === 'true'}
              onChange={e => setSmtpForm(f => ({ ...f, smtp_secure: e.target.checked ? 'true' : 'false' }))} />
            Use TLS (port 465)
          </label>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PrimaryButton type="submit">{smtpSaved ? 'Saved!' : 'Save SMTP'}</PrimaryButton>
          <SecondaryButton type="button" onClick={testEmail} disabled={testStatus === 'sending'}>
            {testStatus === 'sending' ? 'Sending...' : 'Send Test Email'}
          </SecondaryButton>
          {testStatus && testStatus !== 'sending' && (
            <span className="font-sans text-sm" style={{ color: statusColor(testStatus) }}>
              {testStatus === 'ok' ? 'Test email sent' : testStatus}
            </span>
          )}
        </div>
      </form>

      <div className="grid xl:grid-cols-2 gap-6">
        <section className="rounded-lg p-5 space-y-4" style={sectionStyle}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--flux-dim)' }}>
                Proxmox VE
              </p>
              <h2 className="font-display font-semibold text-lg" style={{ color: 'var(--flux-text)' }}>Cluster Settings</h2>
            </div>
            <select value={selectedPveId} onChange={e => {
              const cfg = pveConfigs.find(c => String(c.id) === e.target.value)
              if (cfg) selectPve(cfg)
              else { setSelectedPveId(''); setPveForm(PVE_BLANK); setDiscovery(null); setPveTargets({}) }
            }} className="font-mono text-sm rounded-lg px-3 py-2" style={inputStyle()}>
              <option value="">New cluster</option>
              {pveConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <form onSubmit={savePve} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Name"><input {...pveField('name')} /></Field>
              <Field label="Cluster ID"><input {...pveField('clusterId')} /></Field>
              <Field label="API Base URL"><input placeholder="https://pve-node:8006" {...pveField('apiBaseUrl')} /></Field>
              <Field label="Token ID"><input {...pveField('tokenId')} /></Field>
              <Field label={pveForm.hasTokenSecret ? 'Token Secret (saved)' : 'Token Secret'}>
                <input type="password" placeholder={pveForm.hasTokenSecret ? 'leave blank to keep saved secret' : ''} {...pveField('tokenSecret')} />
              </Field>
              <Field label="HA Freeze Timeout">
                <input type="number" min="1" {...pveField('haFreezeTimeout')} />
              </Field>
            </div>
            <label className="flex items-center gap-3 font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              <input type="checkbox" checked={!!pveForm.enabled}
                onChange={e => setPveForm(f => ({ ...f, enabled: e.target.checked }))} />
              Enabled
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <PrimaryButton type="submit">Save Cluster</PrimaryButton>
              <SecondaryButton type="button" onClick={testPve} disabled={!selectedPveId || pveStatus === 'testing'}>Test Token</SecondaryButton>
              <SecondaryButton type="button" onClick={discoverPve} disabled={!selectedPveId || pveStatus === 'discovering'}>Discover Nodes</SecondaryButton>
              {pveStatus && <span className="font-sans text-sm" style={{ color: statusColor(pveStatus) }}>{pveStatus}</span>}
            </div>
          </form>

          {discovery && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--flux-dim)' }}>
                  Apply Selected Nodes
                </p>
                <PrimaryButton type="button" onClick={applyPve}>Apply Selected</PrimaryButton>
              </div>
              <div className="space-y-2">
                {discovery.nodes.map(row => {
                  const target = pveTargets[row.node] || { checked: false, agentMachineId: '' }
                  return (
                    <div key={row.node} className="grid md:grid-cols-[24px_1fr_1fr_auto] gap-2 items-center rounded-lg p-3"
                      style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)' }}>
                      <input type="checkbox" checked={!!target.checked}
                        onChange={e => setPveTargets(t => ({ ...t, [row.node]: { ...target, checked: e.target.checked } }))} />
                      <div>
                        <p className="font-mono text-sm" style={{ color: 'var(--flux-text)' }}>{row.node}</p>
                        <p className="font-sans text-xs" style={{ color: row.status === 'matched' ? 'var(--flux-healthy)' : row.status === 'ambiguous' ? 'var(--flux-warning)' : 'var(--flux-muted)' }}>
                          {row.status}
                        </p>
                      </div>
                      <select value={target.agentMachineId}
                        onChange={e => setPveTargets(t => ({ ...t, [row.node]: { ...target, agentMachineId: e.target.value } }))}
                        className="font-mono text-sm rounded-lg px-3 py-2" style={inputStyle()}>
                        <option value="">Choose agent</option>
                        {pveEligible.map(m => <option key={m.id} value={m.id}>{m.hostname} ({m.role})</option>)}
                      </select>
                      <span className="font-sans text-xs" style={{ color: 'var(--flux-muted)' }}>
                        {row.candidates?.length || 0} candidate{row.candidates?.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg p-5 space-y-4" style={sectionStyle}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--flux-dim)' }}>
                Proxmox Backup Server
              </p>
              <h2 className="font-display font-semibold text-lg" style={{ color: 'var(--flux-text)' }}>PBS Settings</h2>
            </div>
            <select value={selectedPbsId} onChange={e => {
              const cfg = pbsConfigs.find(c => String(c.id) === e.target.value)
              if (cfg) selectPbs(cfg)
              else { setSelectedPbsId(''); setPbsForm(PBS_BLANK) }
            }} className="font-mono text-sm rounded-lg px-3 py-2" style={inputStyle()}>
              <option value="">New PBS</option>
              {pbsConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <form onSubmit={savePbs} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Name"><input {...pbsField('name')} /></Field>
              <Field label="PBS URL"><input placeholder="https://pbs:8007" {...pbsField('url')} /></Field>
              <Field label="Token ID"><input {...pbsField('tokenId')} /></Field>
              <Field label={pbsForm.hasTokenSecret ? 'Token Secret (saved)' : 'Token Secret'}>
                <input type="password" placeholder={pbsForm.hasTokenSecret ? 'leave blank to keep saved secret' : ''} {...pbsField('tokenSecret')} />
              </Field>
              <Field label="Job Abort Timeout">
                <input type="number" min="1" {...pbsField('jobAbortTimeout')} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-3 font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                <input type="checkbox" checked={!!pbsForm.forceShutdown}
                  onChange={e => setPbsForm(f => ({ ...f, forceShutdown: e.target.checked }))} />
                Force shutdown after timeout
              </label>
              <label className="flex items-center gap-3 font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
                <input type="checkbox" checked={!!pbsForm.enabled}
                  onChange={e => setPbsForm(f => ({ ...f, enabled: e.target.checked }))} />
                Enabled
              </label>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <PrimaryButton type="submit">Save PBS</PrimaryButton>
              <SecondaryButton type="button" onClick={testPbs} disabled={!selectedPbsId || pbsStatus === 'testing'}>Test Token</SecondaryButton>
              {pbsStatus && <span className="font-sans text-sm" style={{ color: statusColor(pbsStatus) }}>{pbsStatus}</span>}
            </div>
          </form>

          <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)' }}>
            <p className="font-display text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--flux-dim)' }}>
              Apply To Agent
            </p>
            <Field label="PBS Agent">
              <select value={pbsTargetId} onChange={e => setPbsTargetId(e.target.value)}
                className="w-full font-mono text-sm rounded-lg px-3 py-2" style={inputStyle()}>
                <option value="">Choose PBS agent</option>
                {pbsEligible.map(m => <option key={m.id} value={m.id}>{m.hostname} ({m.role})</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-3 font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              <input type="checkbox" checked={assignPbsUps}
                onChange={e => setAssignPbsUps(e.target.checked)} />
              Assign or move this PBS agent to a UPS group
            </label>
            {assignPbsUps && (
              <Field label="UPS Group">
                <select value={pbsForm.upsGroupId || ''} onChange={e => setPbsForm(f => ({ ...f, upsGroupId: e.target.value }))}
                  className="w-full font-mono text-sm rounded-lg px-3 py-2" style={inputStyle()}>
                  <option value="">Choose UPS group</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
            <PrimaryButton type="button" onClick={applyPbs} disabled={!selectedPbsId || !pbsTargetId || (assignPbsUps && !pbsForm.upsGroupId)}>
              Apply PBS Config
            </PrimaryButton>
          </div>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

function PrimaryButton({ children, ...props }) {
  return (
    <button {...props}
      className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all disabled:opacity-50"
      style={{ background: 'var(--flux-accent)', color: '#fff' }}>
      {children}
    </button>
  )
}

function SecondaryButton({ children, ...props }) {
  return (
    <button {...props}
      className="font-sans text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
      {children}
    </button>
  )
}
