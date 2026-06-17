import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const panelStyle = { background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }
const inputStyle = {
  background: 'var(--flux-bg)', border: '1px solid var(--flux-border)',
  color: 'var(--flux-text)', width: '100%', borderRadius: '8px',
  padding: '8px 12px', fontSize: '14px', fontFamily: 'IBM Plex Mono, monospace', outline: 'none',
}
const labelStyle = { color: 'var(--flux-muted)', fontSize: '12px', marginBottom: '4px', display: 'block' }
const termStyle = {
  background: 'var(--code-bg, #0d1117)', border: '1px solid var(--flux-border)', borderRadius: '8px',
  padding: '12px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace',
  color: '#a5d6ff', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  maxHeight: '220px', overflowY: 'auto', minHeight: '80px',
}

/**
 * SshInstallModal
 *
 * Props:
 *   headers       — { Authorization: 'Bearer ...' }
 *   deviceId      — parent device/UPS ID
 *   machineId     — if set, migration mode (uses stored SSH creds, no form)
 *   upsGroupId    — optional override; defaults to deviceId
 *   role          — optional role string ('ups-host', etc.); null = auto-detect
 *   nutConfig     — optional initial NUT config for ups-host agents
 *   onSuccess(machineId) — called when install job completes successfully
 *   onClose()     — called when user dismisses
 *   inline        — if true, renders without outer modal backdrop
 */
export default function SshInstallModal({
  headers, deviceId, machineId, upsGroupId, role, nutConfig, onSuccess, onClose, inline = false,
}) {
  const isMigration = Boolean(machineId)
  const [phase,      setPhase]      = useState('form')  // 'form' | 'installing' | 'success' | 'error'
  const [log,        setLog]        = useState('')
  const [errMsg,     setErrMsg]     = useState('')
  const [resultId,   setResultId]   = useState(null)
  const [migrRole,   setMigrRole]   = useState(role || '')
  const [form,       setForm]       = useState({
    host: '', sshPort: '22', sshUser: 'root',
    sshAuthType: 'password', sshPassword: '',
    sshKeyPath: '', sshKeyContent: '',
    useKeyContent: false,
  })
  const pollRef   = useRef(null)
  const termRef   = useRef(null)

  // Auto-scroll terminal output
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [log])

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const f = (key) => ({
    value: form[key],
    onChange: e => setForm(p => ({ ...p, [key]: e.target.value })),
    style: inputStyle,
    onFocus: e => { e.target.style.borderColor = 'var(--flux-accent)' },
    onBlur:  e => { e.target.style.borderColor = 'var(--flux-border)' },
  })

  function startPolling(jobId, resolvedMachineId) {
    let prevLen = 0
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/agents/install-jobs/${jobId}`, { headers })
        // Append only new output chunks
        const newText = data.log.slice(prevLen)
        if (newText) { setLog(l => l + newText); prevLen = data.log.length }
        if (data.done) {
          clearInterval(pollRef.current)
          if (data.success) {
            setResultId(resolvedMachineId)
            setPhase('success')
          } else {
            setErrMsg(data.error || 'Install failed')
            setPhase('error')
          }
        }
      } catch {
        clearInterval(pollRef.current)
        setErrMsg('Lost connection to server while polling')
        setPhase('error')
      }
    }, 1000)
  }

  async function runInstall(e) {
    if (e) e.preventDefault()
    setPhase('installing')
    setLog('')
    try {
      let data
      if (isMigration) {
        const res = await axios.post(
          `/api/devices/${deviceId}/machines/${machineId}/install-agent`,
          { role: migrRole || null }, { headers }
        )
        data = res.data
      } else {
        const payload = {
	          host: form.host, sshPort: Number(form.sshPort) || 22,
	          sshUser: form.sshUser || 'root', sshAuthType: form.sshAuthType,
	          role: role || null, upsGroupId: upsGroupId || deviceId || null,
	        }
	        if (nutConfig) payload.nutConfig = nutConfig
        if (form.sshAuthType === 'password') {
          payload.sshPassword = form.sshPassword
        } else {
          // sshKeyContent takes precedence over sshKeyPath
          if (form.useKeyContent && form.sshKeyContent) payload.sshKeyContent = form.sshKeyContent
          else payload.sshKeyPath = form.sshKeyPath
        }
        const res = await axios.post('/api/agents/install-via-ssh', payload, { headers })
        data = res.data
      }
      setLog('Starting install…\n')
      startPolling(data.jobId, data.machineId)
    } catch (err) {
      setErrMsg(err.response?.data?.error || err.message || 'Install failed')
      setPhase('error')
    }
  }

  const content = (
    <div style={{ color: 'var(--flux-text)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '15px', margin: 0 }}>
          {isMigration ? '⬆ Install Agent (migrate)' : '🔑 Install via SSH'}
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--flux-muted)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      {phase === 'form' && !isMigration && (
        <form onSubmit={runInstall} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Host / IP *</label>
            <input {...f('host')} required placeholder="192.168.0.100" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>SSH Port</label>
              <input {...f('sshPort')} type="number" min={1} max={65535} />
            </div>
            <div>
              <label style={labelStyle}>SSH User</label>
              <input {...f('sshUser')} placeholder="root" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Auth Type</label>
            <select {...f('sshAuthType')} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="password">Password</option>
              <option value="key">SSH Key</option>
            </select>
          </div>
          {form.sshAuthType === 'password' ? (
            <div>
              <label style={labelStyle}>Password</label>
              <input {...f('sshPassword')} type="password" autoComplete="new-password" />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <button type="button"
                  onClick={() => setForm(p => ({ ...p, useKeyContent: false }))}
                  style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                    background: !form.useKeyContent ? 'var(--flux-accent)' : 'none',
                    color: !form.useKeyContent ? '#fff' : 'var(--flux-muted)',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                  Key File Path
                </button>
                <button type="button"
                  onClick={() => setForm(p => ({ ...p, useKeyContent: true }))}
                  style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid var(--flux-border)',
                    background: form.useKeyContent ? 'var(--flux-accent)' : 'none',
                    color: form.useKeyContent ? '#fff' : 'var(--flux-muted)',
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', cursor: 'pointer' }}>
                  Paste Key
                </button>
              </div>
              {!form.useKeyContent ? (
                <div>
                  <label style={labelStyle}>Key File Path (on server)</label>
                  <input {...f('sshKeyPath')} placeholder="/root/.ssh/id_rsa" />
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>Private Key Content (PEM)</label>
                  <textarea {...f('sshKeyContent')}
                    rows={6} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'IBM Plex Mono, monospace' }} />
                </div>
              )}
            </>
          )}
          {role && (
            <p style={{ color: 'var(--flux-muted)', fontSize: '12px', margin: 0 }}>
              Role: <span style={{ color: 'var(--flux-accent)', fontFamily: 'monospace' }}>{role}</span>
            </p>
          )}
          <button type="submit"
            style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: 'pointer', marginTop: '4px' }}>
            Install Agent
          </button>
        </form>
      )}

      {phase === 'form' && isMigration && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ color: 'var(--flux-muted)', fontSize: '13px', margin: 0 }}>
            Uses stored SSH credentials to install the Flux agent, then migrates
            this host to an agent record. The SSH host will be removed on success.
          </p>
          <div>
            <label style={labelStyle}>Role</label>
            <select
              value={migrRole}
              onChange={e => setMigrRole(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">Auto-detect</option>
              <option value="controlled">controlled — standard machine</option>
              <option value="pve-node">pve-node — Proxmox VE node</option>
              <option value="pbs">pbs — Proxmox Backup Server</option>
              <option value="ups-host">ups-host — UPS attached (NUT server)</option>
            </select>
          </div>
          <button onClick={runInstall}
            style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Install Agent & Migrate
          </button>
        </div>
      )}

      {phase === 'installing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ color: 'var(--flux-muted)', fontSize: '12px', margin: 0 }}>
            Installing… this takes 30–60 seconds
          </p>
          <pre ref={termRef} style={termStyle}>{log || ' '}</pre>
        </div>
      )}

      {phase === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ color: 'var(--flux-healthy)', fontSize: '14px', margin: 0 }}>✓ Agent installed successfully</p>
          <pre ref={termRef} style={{ ...termStyle, maxHeight: '160px' }}>{log}</pre>
          <p style={{ color: 'var(--flux-muted)', fontSize: '13px', margin: 0 }}>
            The machine is now enrolling. It will appear in Power Center once connected.
          </p>
          <button onClick={() => onSuccess && onSuccess(resultId)}
            style={{ background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ color: 'var(--flux-critical)', fontSize: '14px', margin: 0 }}>✗ Install failed</p>
          {log && <pre ref={termRef} style={{ ...termStyle, maxHeight: '120px' }}>{log}</pre>}
          <pre style={{ ...termStyle, color: 'var(--flux-critical)', maxHeight: '80px' }}>{errMsg}</pre>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setPhase('form'); setLog('') }}
              style={{ flex: 1, background: 'var(--flux-accent)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              Try Again
            </button>
            <button onClick={onClose}
              style={{ flex: 1, background: 'none', border: '1px solid var(--flux-border)', borderRadius: '8px', padding: '10px', color: 'var(--flux-muted)', fontSize: '14px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )

  if (inline) return content

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ ...panelStyle, borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  )
}
