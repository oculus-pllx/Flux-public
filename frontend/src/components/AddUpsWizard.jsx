import { useState } from 'react'
import axios from 'axios'
import SshInstallModal from './SshInstallModal'

const panelStyle = { background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }
const inputStyle = {
  background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
  color: 'var(--flux-text)', width: '100%', borderRadius: '8px',
  padding: '8px 12px', fontSize: '14px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none',
}
const labelStyle = { color: 'var(--flux-muted)', fontSize: '12px', marginBottom: '4px', display: 'block' }

const BLANK = { name: '', host: '', port: '3493', upsName: 'ups', pollInterval: '30', nutUsername: '', nutPassword: '', description: '' }
const BLANK_SSH = { host: '', sshPort: '22', sshUser: 'root', sshAuthType: 'password', sshPassword: '', sshKeyContent: '', sshKeyPath: '', useKeyContent: false }

export default function AddUpsWizard({ headers, onSuccess, onClose }) {
  const [step,       setStep]       = useState(1)
  const [mode,       setMode]       = useState('manual')   // 'manual' | 'discover'
  const [form,       setForm]       = useState(BLANK)
  const [sshForm,    setSshForm]    = useState(BLANK_SSH)
  const [discovering, setDiscovering] = useState(false)
  const [discoverErr, setDiscoverErr] = useState('')
  const [nutMissing,  setNutMissing]  = useState(false)
  const [installing,  setInstalling]  = useState(false)
  const [discovered,  setDiscovered]  = useState(null)    // { upsNames, nutHost, nutPort, nutUsername, nutPassword }
  const [saveErr,    setSaveErr]    = useState('')
  const [saveBusy,   setSaveBusy]   = useState(false)
  const [newDevice,  setNewDevice]  = useState(null)
  const [showSsh,    setShowSsh]    = useState(false)
  const [agentCheck, setAgentCheck] = useState(null)

  const f = (key) => ({
    value: form[key],
    onChange: e => setForm(p => ({ ...p, [key]: e.target.value })),
    style: inputStyle,
    onFocus: e => { e.target.style.borderColor = 'var(--flux-accent)' },
    onBlur:  e => { e.target.style.borderColor = 'var(--flux-border)' },
  })
  const sf = (key) => ({
    value: sshForm[key],
    onChange: e => setSshForm(p => ({ ...p, [key]: e.target.value })),
    style: inputStyle,
    onFocus: e => { e.target.style.borderColor = 'var(--flux-accent)' },
    onBlur:  e => { e.target.style.borderColor = 'var(--flux-border)' },
  })

  function sshPayload() {
    const payload = {
      host: sshForm.host, sshPort: Number(sshForm.sshPort) || 22,
      sshUser: sshForm.sshUser || 'root', sshAuthType: sshForm.sshAuthType,
    }
    if (sshForm.sshAuthType === 'password') {
      payload.sshPassword = sshForm.sshPassword
    } else {
      if (sshForm.useKeyContent && sshForm.sshKeyContent) payload.sshKeyContent = sshForm.sshKeyContent
      else payload.sshKeyPath = sshForm.sshKeyPath
    }
    return payload
  }

  function applyDiscovered(data) {
    setDiscovered(data)
    // Pre-fill form with discovered values
    setForm(p => ({
      ...p,
      host:        data.nutHost,
      port:        String(data.nutPort),
      upsName:     data.upsNames[0] || 'ups',
      nutUsername: data.nutUsername || '',
      nutPassword: data.nutPassword || '',
    }))
  }

  async function discover(e) {
    e.preventDefault()
    setDiscoverErr('')
    setNutMissing(false)
    setDiscovering(true)
    try {
      const { data } = await axios.post('/api/devices/discover-nut', sshPayload(), { headers })
      applyDiscovered(data)
    } catch (err) {
      setDiscoverErr(err.response?.data?.error || err.message || 'Discovery failed')
      setNutMissing(Boolean(err.response?.data?.nutMissing))
    } finally {
      setDiscovering(false)
    }
  }

  async function installNut() {
    setDiscoverErr('')
    setInstalling(true)
    try {
      const { data } = await axios.post('/api/devices/install-nut', sshPayload(), { headers })
      setNutMissing(false)
      applyDiscovered(data)
    } catch (err) {
      setDiscoverErr(err.response?.data?.error || err.message || 'NUT install failed')
      if (!err.response?.data?.installed) setNutMissing(true)
    } finally {
      setInstalling(false)
    }
  }

  async function createDevice(e) {
    e.preventDefault()
    setSaveErr('')
    setSaveBusy(true)
    try {
      const payload = {
        name:         form.name,
        host:         form.host,
        port:         Number(form.port) || 3493,
        upsName:      form.upsName || 'ups',
        pollInterval: Number(form.pollInterval) || 30,
      }
      if (form.description) payload.description = form.description
      if (form.nutUsername) payload.nutUsername = form.nutUsername
      if (form.nutPassword) payload.nutPassword = form.nutPassword
      const { data } = await axios.post('/api/devices', payload, { headers })
      setNewDevice(data)
      setStep(2)
    } catch (err) {
      setSaveErr(err.response?.data?.error || 'Failed to create device')
    } finally {
      setSaveBusy(false)
    }
  }

  async function verifyInitialAgent(machineId) {
    if (!machineId || !newDevice?.id) return
    setAgentCheck({ state: 'checking', message: 'Checking UPS host assignment...' })
    try {
      const { data: machine } = await axios.get(`/api/agents/${machineId}`, { headers })
      if (machine.upsGroupId !== newDevice.id) {
        await axios.put(`/api/agents/${machineId}`, { upsGroupId: newDevice.id }, { headers })
        setAgentCheck({ state: 'ok', message: 'UPS host agent was installed and attached to this UPS.' })
      } else {
        setAgentCheck({ state: 'ok', message: 'UPS host agent is attached to this UPS.' })
      }
    } catch (err) {
      setAgentCheck({
        state: 'error',
        message: err.response?.data?.error || err.message || 'Could not verify UPS host assignment.',
      })
    }
  }

  const tabBtn = (id, label) => (
    <button type="button" onClick={() => { setMode(id); setDiscovered(null); setDiscoverErr('') }}
      style={{
        flex: 1, padding: '7px', borderRadius: '7px', border: '1px solid var(--flux-border)',
        background: mode === id ? 'var(--flux-accent)' : 'none',
        color: mode === id ? '#fff' : 'var(--flux-muted)',
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer',
      }}>{label}</button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ ...panelStyle, borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h2 style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '15px', color: 'var(--flux-text)', margin: 0 }}>
            Add UPS — Step {step} of 2
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--flux-muted)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[1, 2].map(n => (
            <div key={n} style={{ flex: 1, height: '3px', borderRadius: '2px', background: n <= step ? 'var(--flux-accent)' : 'var(--flux-border)' }} />
          ))}
        </div>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {tabBtn('manual',   '✎ Manual')}
              {tabBtn('discover', '🔍 Discover via SSH')}
            </div>

            {/* ── Discover mode ── */}
            {mode === 'discover' && !discovered && (
              <form onSubmit={discover} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ color: 'var(--flux-muted)', fontSize: '13px', margin: 0 }}>
                  Enter SSH credentials — Flux will read the NUT config on that machine and fill everything in automatically.
                </p>
                <div>
                  <label style={labelStyle}>Host / IP *</label>
                  <input {...sf('host')} required placeholder="192.168.0.10" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label style={labelStyle}>SSH Port</label><input {...sf('sshPort')} type="number" min={1} max={65535} /></div>
                  <div><label style={labelStyle}>SSH User</label><input {...sf('sshUser')} placeholder="root" /></div>
                </div>
                <div>
                  <label style={labelStyle}>Auth Type</label>
                  <select {...sf('sshAuthType')} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="password">Password</option>
                    <option value="key">SSH Key</option>
                  </select>
                </div>
                {sshForm.sshAuthType === 'password' ? (
                  <div><label style={labelStyle}>Password</label><input {...sf('sshPassword')} type="password" autoComplete="new-password" /></div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {['Key File Path', 'Paste Key'].map((label, i) => (
                        <button key={i} type="button"
                          onClick={() => setSshForm(p => ({ ...p, useKeyContent: i === 1 }))}
                          style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                            background: (i === 1) === sshForm.useKeyContent ? 'var(--flux-accent)' : 'none',
                            color: (i === 1) === sshForm.useKeyContent ? '#fff' : 'var(--flux-muted)',
                            fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {!sshForm.useKeyContent
                      ? <div><label style={labelStyle}>Key File Path (on server)</label><input {...sf('sshKeyPath')} placeholder="/root/.ssh/id_rsa" /></div>
                      : <div><label style={labelStyle}>Private Key (PEM)</label><textarea {...sf('sshKeyContent')} rows={5} style={{ ...inputStyle, resize: 'vertical' }} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." /></div>
                    }
                  </>
                )}
                {discoverErr && <p style={{ color: 'var(--flux-critical)', fontSize: '13px', margin: 0 }}>{discoverErr}</p>}
                {nutMissing && (
                  <button type="button" onClick={installNut} disabled={installing || discovering}
                    style={{ background: 'none', border: '1px solid var(--flux-accent)', color: 'var(--flux-accent)', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: installing ? 'not-allowed' : 'pointer', opacity: installing ? 0.6 : 1 }}>
                    {installing ? 'Installing NUT (may take a minute)…' : '⚡ Install & configure NUT on this host'}
                  </button>
                )}
                <button type="submit" disabled={discovering || installing}
                  style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: discovering ? 'not-allowed' : 'pointer', opacity: discovering ? 0.6 : 1 }}>
                  {discovering ? 'Reading NUT config…' : 'Discover'}
                </button>
              </form>
            )}

            {/* ── Discover result confirmation ── */}
            {mode === 'discover' && discovered && (
              <form onSubmit={createDevice} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', fontFamily: 'monospace', color: '#10b981' }}>
                  {discovered.installed && <>✓ NUT server installed &amp; configured<br /></>}
                  ✓ Found {discovered.upsNames.length} UPS: <strong>{discovered.upsNames.join(', ')}</strong>
                  {discovered.nutUsername && <><br />✓ Monitor user: <strong>{discovered.nutUsername}</strong></>}
                </div>

                <div><label style={labelStyle}>Display Name *</label><input {...f('name')} required placeholder="e.g. Proxmox Stack" /></div>

                {discovered.upsNames.length > 1 && (
                  <div>
                    <label style={labelStyle}>UPS to monitor</label>
                    <select value={form.upsName} onChange={e => setForm(p => ({ ...p, upsName: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {discovered.upsNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label style={labelStyle}>NUT Host</label><input {...f('host')} /></div>
                  <div><label style={labelStyle}>NUT Port</label><input {...f('port')} type="number" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label style={labelStyle}>NUT Username</label><input {...f('nutUsername')} /></div>
                  <div>
                    <label style={labelStyle}>NUT Password</label>
                    <input {...f('nutPassword')} type="password" autoComplete="new-password"
                      placeholder={discovered.nutPassword ? '(discovered)' : 'not found'} />
                  </div>
                </div>
                <div><label style={labelStyle}>Poll Interval (s)</label><input {...f('pollInterval')} type="number" min={5} max={3600} /></div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setDiscovered(null)}
                    style={{ flex: 1, background: 'none', border: '1px solid var(--flux-border)', borderRadius: '8px', padding: '10px', color: 'var(--flux-muted)', fontSize: '14px', cursor: 'pointer' }}>
                    ← Back
                  </button>
                  <button type="submit" disabled={saveBusy}
                    style={{ flex: 2, background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: saveBusy ? 'not-allowed' : 'pointer', opacity: saveBusy ? 0.6 : 1 }}>
                    {saveBusy ? 'Creating…' : 'Add UPS →'}
                  </button>
                </div>
                {saveErr && <p style={{ color: 'var(--flux-critical)', fontSize: '13px', margin: 0 }}>{saveErr}</p>}
              </form>
            )}

            {/* ── Manual mode ── */}
            {mode === 'manual' && (
              <form onSubmit={createDevice} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ color: 'var(--flux-muted)', fontSize: '13px', margin: 0 }}>
                  Enter the details for your UPS / NUT server.
                </p>
                <div><label style={labelStyle}>Display Name *</label><input {...f('name')} required placeholder="My APC UPS" /></div>
                <div><label style={labelStyle}>NUT Server Host / IP *</label><input {...f('host')} required placeholder="192.168.0.10" /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label style={labelStyle}>NUT Port</label><input {...f('port')} type="number" min={1} max={65535} /></div>
                  <div><label style={labelStyle}>UPS Name in NUT</label><input {...f('upsName')} placeholder="ups" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label style={labelStyle}>NUT Username</label><input {...f('nutUsername')} placeholder="optional" /></div>
                  <div><label style={labelStyle}>NUT Password</label><input {...f('nutPassword')} type="password" autoComplete="new-password" placeholder="optional" /></div>
                </div>
                <div><label style={labelStyle}>Poll Interval (s)</label><input {...f('pollInterval')} type="number" min={5} max={3600} /></div>
                <div><label style={labelStyle}>Description</label><input {...f('description')} placeholder="optional" /></div>
                {saveErr && <p style={{ color: 'var(--flux-critical)', fontSize: '13px', margin: 0 }}>{saveErr}</p>}
                <button type="submit" disabled={saveBusy}
                  style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: saveBusy ? 'not-allowed' : 'pointer', opacity: saveBusy ? 0.6 : 1, marginTop: '4px' }}>
                  {saveBusy ? 'Creating…' : 'Next →'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ── Step 2 — Install Agent prompt ── */}
        {step === 2 && !showSsh && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: 'var(--flux-text)', fontSize: '14px', margin: 0 }}>
              UPS <strong>{newDevice?.name}</strong> added at{' '}
              <span style={{ fontFamily: 'monospace' }}>{newDevice?.host}:{newDevice?.port}</span>.
            </p>
            <p style={{ color: 'var(--flux-muted)', fontSize: '13px', margin: 0 }}>
              Install the Flux agent on the NUT server to enable shutdown coordination?
            </p>
            <button onClick={() => setShowSsh(true)}
              style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              Install Agent via SSH
            </button>
            <button onClick={onSuccess}
              style={{ background: 'none', border: '1px solid var(--flux-border)', borderRadius: '8px', padding: '10px', color: 'var(--flux-muted)', fontSize: '14px', cursor: 'pointer' }}>
              Skip — monitoring only
            </button>
          </div>
        )}

        {step === 2 && showSsh && (
          <>
            <SshInstallModal
              headers={headers}
              deviceId={newDevice?.id}
              upsGroupId={newDevice?.id}
              role="ups-host"
              nutConfig={discovered?.installed ? {
                managedByFlux: true,
                upsName: form.upsName || 'ups',
                driver: 'usbhid-ups',
                port: 'auto',
                desc: form.name || 'UPS',
                upsdPort: Number(form.port) || 3493,
                upsdUser: {
                  name: form.nutUsername || 'fluxmon',
                  password: form.nutPassword || 'fluxmon',
                  upsmonPassword: form.nutPassword || 'fluxmon',
                },
              } : null}
              onSuccess={verifyInitialAgent}
              onClose={() => setShowSsh(false)}
              inline={true}
            />
            {agentCheck && (
              <div style={{
                marginTop: 12,
                border: `1px solid ${agentCheck.state === 'error' ? 'var(--flux-critical)' : agentCheck.state === 'ok' ? 'rgba(16,185,129,0.35)' : 'var(--flux-border)'}`,
                color: agentCheck.state === 'error' ? 'var(--flux-critical)' : agentCheck.state === 'ok' ? 'var(--flux-healthy)' : 'var(--flux-muted)',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                fontFamily: 'IBM Plex Mono, monospace',
              }}>
                {agentCheck.message}
              </div>
            )}
            {agentCheck?.state === 'ok' && (
              <button onClick={onSuccess}
                style={{ width: '100%', marginTop: 10, background: 'var(--flux-accent)', color: '#fff', border: 0, borderRadius: 8, padding: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Finish
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
