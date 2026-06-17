import { useState } from 'react'
import axios from 'axios'

const inputStyle = {
  background: 'var(--flux-bg)',
  border: '1px solid var(--flux-border)',
  color: 'var(--flux-text)',
  width: '100%',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'IBM Plex Mono, monospace',
  outline: 'none',
}

const labelStyle = {
  color: 'var(--flux-muted)',
  fontSize: 11,
  marginBottom: 4,
  display: 'block',
}

function fieldValue(device, key, fallback = '') {
  if (key === 'nutPassword') return ''
  return device?.[key] ?? fallback
}

export default function UpsConfigModal({ device, headers, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: fieldValue(device, 'name'),
    host: fieldValue(device, 'host'),
    port: String(fieldValue(device, 'port', 3493)),
    upsName: fieldValue(device, 'upsName', 'ups'),
    pollInterval: String(fieldValue(device, 'pollInterval', 30)),
    nutUsername: fieldValue(device, 'nutUsername'),
    nutPassword: '',
    active: device?.active !== false,
  })
  const [ssh, setSsh] = useState({
    host: device?.host || '',
    sshPort: '22',
    sshUser: 'root',
    sshAuthType: 'password',
    sshPassword: '',
    sshKeyPath: '',
    sshKeyContent: '',
    useKeyContent: false,
    nutUsername: device?.nutUsername || 'fluxmon',
    nutPassword: '',
  })
  const [busy, setBusy] = useState(false)
  const [repairBusy, setRepairBusy] = useState(false)
  const [error, setError] = useState('')
  const [repairMsg, setRepairMsg] = useState('')

  const updateForm = key => e => {
    const value = key === 'active' ? e.target.checked : e.target.value
    setForm(p => ({ ...p, [key]: value }))
  }

  const updateSsh = key => e => {
    const value = e.target.value
    setSsh(p => ({ ...p, [key]: value }))
  }

  function sshPayload() {
    const payload = {
      host: ssh.host,
      sshPort: Number(ssh.sshPort) || 22,
      sshUser: ssh.sshUser || 'root',
      sshAuthType: ssh.sshAuthType,
      nutUsername: ssh.nutUsername || form.nutUsername || 'fluxmon',
    }
    if (ssh.nutPassword) payload.nutPassword = ssh.nutPassword
    if (ssh.sshAuthType === 'password') {
      payload.sshPassword = ssh.sshPassword
    } else if (ssh.useKeyContent && ssh.sshKeyContent) {
      payload.sshKeyContent = ssh.sshKeyContent
    } else {
      payload.sshKeyPath = ssh.sshKeyPath
    }
    return payload
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        name: form.name,
        host: form.host,
        port: Number(form.port) || 3493,
        upsName: form.upsName || 'ups',
        pollInterval: Number(form.pollInterval) || 30,
        nutUsername: form.nutUsername,
        nutPassword: form.nutPassword,
        active: form.active,
      }
      const { data } = await axios.put(`/api/devices/${device.id}`, payload, { headers })
      onSaved(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save UPS')
    } finally {
      setBusy(false)
    }
  }

  async function repair() {
    setRepairBusy(true)
    setError('')
    setRepairMsg('')
    try {
      const { data } = await axios.post(`/api/devices/${device.id}/configure-nut`, sshPayload(), { headers })
      setRepairMsg(`Configured ${data.nutUsername} with full NUT control.`)
      onSaved(data.device)
      setForm(p => ({
        ...p,
        host: data.device.host,
        port: String(data.device.port),
        upsName: data.device.upsName,
        nutUsername: data.device.nutUsername || p.nutUsername,
        nutPassword: '',
      }))
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'NUT repair failed')
    } finally {
      setRepairBusy(false)
    }
  }

  const Input = ({ label, value, onChange, type = 'text', required = false, placeholder }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        style={inputStyle}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--flux-accent)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--flux-border)' }}
      />
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.68)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)', borderRadius: 10, width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ color: 'var(--flux-text)', fontSize: 16, fontWeight: 700, margin: 0 }}>UPS Configuration</h2>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--flux-muted)', fontSize: 22, cursor: 'pointer' }}>x</button>
        </div>

        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
            <Input label="Display Name" value={form.name} onChange={updateForm('name')} required />
            <Input label="UPS Name in NUT" value={form.upsName} onChange={updateForm('upsName')} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .6fr .6fr', gap: 12 }}>
            <Input label="NUT Host" value={form.host} onChange={updateForm('host')} required />
            <Input label="NUT Port" type="number" value={form.port} onChange={updateForm('port')} required />
            <Input label="Poll Interval" type="number" value={form.pollInterval} onChange={updateForm('pollInterval')} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="NUT Username" value={form.nutUsername} onChange={updateForm('nutUsername')} placeholder="fluxmon" />
            <Input label="NUT Password" type="password" value={form.nutPassword} onChange={updateForm('nutPassword')} placeholder={device?.hasNutCredentials ? 'leave blank to keep saved password' : ''} />
          </div>
          <label style={{ color: 'var(--flux-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.active} onChange={updateForm('active')} />
            Active polling
          </label>

          {error && <p style={{ color: 'var(--flux-critical)', fontSize: 12, margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} disabled={busy || repairBusy}
              style={{ background: 'none', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', borderRadius: 7, padding: '8px 14px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={busy || repairBusy}
              style={{ background: 'var(--flux-accent)', border: '1px solid var(--flux-accent)', color: '#fff', borderRadius: 7, padding: '8px 14px', cursor: 'pointer', opacity: busy ? 0.65 : 1 }}>
              {busy ? 'Saving...' : 'Save UPS'}
            </button>
          </div>
        </form>

        <div style={{ borderTop: '1px solid var(--flux-border)', marginTop: 18, paddingTop: 16 }}>
          <h3 style={{ color: 'var(--flux-text)', fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>Configure NUT via SSH</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .6fr .8fr', gap: 12 }}>
              <Input label="SSH Host" value={ssh.host} onChange={updateSsh('host')} />
              <Input label="SSH Port" type="number" value={ssh.sshPort} onChange={updateSsh('sshPort')} />
              <Input label="SSH User" value={ssh.sshUser} onChange={updateSsh('sshUser')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '.7fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Auth Type</label>
                <select value={ssh.sshAuthType} onChange={updateSsh('sshAuthType')} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="password">Password</option>
                  <option value="key">SSH Key</option>
                </select>
              </div>
              {ssh.sshAuthType === 'password' ? (
                <Input label="SSH Password" type="password" value={ssh.sshPassword} onChange={updateSsh('sshPassword')} />
              ) : (
                <Input label="Key File Path" value={ssh.sshKeyPath} onChange={updateSsh('sshKeyPath')} placeholder="/root/.ssh/id_rsa" />
              )}
              <Input label="NUT Control User" value={ssh.nutUsername} onChange={updateSsh('nutUsername')} />
            </div>
            {ssh.sshAuthType === 'key' && (
              <div>
                <label style={{ color: 'var(--flux-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="checkbox" checked={ssh.useKeyContent} onChange={e => setSsh(p => ({ ...p, useKeyContent: e.target.checked }))} />
                  Paste key content instead of server file path
                </label>
                {ssh.useKeyContent && (
                  <textarea value={ssh.sshKeyContent} onChange={updateSsh('sshKeyContent')} rows={5}
                    placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                    style={{ ...inputStyle, resize: 'vertical' }} />
                )}
              </div>
            )}
            <Input label="New NUT Password" type="password" value={ssh.nutPassword} onChange={updateSsh('nutPassword')} placeholder="leave blank to generate" />
            {repairMsg && <p style={{ color: 'var(--flux-healthy)', fontSize: 12, margin: 0 }}>{repairMsg}</p>}
            <div>
              <button type="button" onClick={repair} disabled={busy || repairBusy || !ssh.host}
                style={{ background: 'none', border: '1px solid var(--flux-accent)', color: 'var(--flux-accent)', borderRadius: 7, padding: '8px 14px', cursor: repairBusy ? 'not-allowed' : 'pointer', opacity: repairBusy || !ssh.host ? 0.6 : 1 }}>
                {repairBusy ? 'Configuring...' : 'Configure Full-Control NUT User'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
