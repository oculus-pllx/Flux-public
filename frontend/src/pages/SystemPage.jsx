import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import axios from 'axios'

const cardPanel = {
  background: 'var(--flux-panel)',
  border: '1px solid var(--flux-border)',
  borderRadius: '12px',
  padding: '24px',
}

const cardLabel = {
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--flux-dim)',
  marginBottom: '12px',
}

function ServerUpdateCard({ headers }) {
  const [status, setStatus] = useState(null)
  const [job, setJob]       = useState(null)   // { state, log }
  const [busy, setBusy]     = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError]   = useState(null)

  async function checkUpdates() {
    setChecking(true)
    setError(null)
    try {
      const { data } = await axios.get('/api/system/update', { headers })
      setStatus(data)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { checkUpdates() }, [])

  useEffect(() => {
    if (!busy) return
    const t = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/system/update/log', { headers })
        setJob(data)
        if (data.state === 'success' || data.state === 'failed') setBusy(false)
      } catch {
        // backend restarting mid-update is expected; keep polling
      }
    }, 3000)
    return () => clearInterval(t)
  }, [busy])

  async function startUpdate() {
    setError(null)
    try {
      await axios.post('/api/system/update', {}, { headers })
      setJob({ state: 'requested' })
      setBusy(true)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    }
  }

  const jobColor = job?.state === 'failed' ? 'var(--flux-critical)'
                 : job?.state === 'success' ? 'var(--flux-healthy)'
                 : 'var(--flux-warning)'

  const canOneClick = status && status.mode !== 'manual'

  return (
    <div style={{ ...cardPanel, marginBottom: 24 }}>
      <p style={cardLabel}>Server Update</p>

      {!status && !error && (
        <p className="font-mono text-xs" style={{ color: 'var(--flux-dim)' }}>Checking for updates…</p>
      )}

      {status && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-mono text-sm" style={{ color: 'var(--flux-text)' }}>
              v{status.currentVersion}
              {status.latestVersion && status.updateAvailable && (
                <span style={{ color: 'var(--flux-warning)' }}> → v{status.latestVersion} available</span>
              )}
              {status.latestVersion && !status.updateAvailable && (
                <span style={{ color: 'var(--flux-healthy)' }}> · up to date</span>
              )}
            </p>
            {status.publishedAt && status.updateAvailable && (
              <p className="font-sans text-xs mt-1" style={{ color: 'var(--flux-dim)' }}>
                Released {new Date(status.publishedAt).toLocaleDateString()}
              </p>
            )}
            {status.error && (
              <p className="font-sans text-xs mt-1" style={{ color: 'var(--flux-warning)' }}>
                Update check failed: {status.error}
              </p>
            )}
            <p className="font-mono text-xs mt-1" style={{ color: 'var(--flux-dim)' }}>
              mode: {status.mode || 'unknown'} · repo: {status.repo || 'default'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={checkUpdates}
              disabled={checking || busy}
              className="font-display font-semibold text-sm px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: 'none', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}
            >
              {checking ? 'Checking...' : 'Check for Updates'}
            </button>
            {canOneClick && (
              <button
                onClick={startUpdate}
                disabled={busy}
                className="font-display font-semibold text-sm px-5 py-2 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--flux-accent)', color: '#fff' }}
                title={status.updateAvailable ? 'Apply the latest release' : 'Manually run the updater for this install'}
              >
                {busy ? 'Updating...' : status.updateAvailable ? 'Update Now' : 'Run Manual Update'}
              </button>
            )}
          </div>
        </div>
      )}

      {status?.mode === 'manual' && (
        <div className="font-mono text-xs rounded-lg p-3 mt-3"
          style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
          One-click update is not available for this install.<br />
          Docker: run <span style={{ color: 'var(--flux-text)' }}>git pull && docker compose up -d --build</span> in the Flux directory.<br />
          Systemd: run <span style={{ color: 'var(--flux-text)' }}>{status.manualCommand || 'install.sh'}</span> once to enable the updater.
          {status.manualCommand && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => navigator.clipboard.writeText(status.manualCommand).catch(() => {})}
                className="font-display font-semibold text-xs px-3 py-1.5 rounded"
                style={{ background: 'none', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                Copy Systemd Update Command
              </button>
            </div>
          )}
        </div>
      )}

      {status?.updateAvailable && status.notes && (
        <pre className="font-sans text-xs mt-3 rounded-lg p-3 overflow-auto"
          style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', maxHeight: 120, whiteSpace: 'pre-wrap' }}>
          {status.notes.slice(0, 2000)}
        </pre>
      )}

      {error && (
        <p className="font-sans text-xs mt-3" style={{ color: 'var(--flux-critical)' }}>{error}</p>
      )}

      {job && (
        <div className="mt-3">
          <p className="font-mono text-xs mb-2" style={{ color: jobColor }}>
            {job.state === 'requested' && '… update requested, waiting for the updater to start'}
            {job.state === 'running'   && '… update running (the page may briefly disconnect while services restart)'}
            {job.state === 'success'   && '✓ update finished — reload the page to use the new version'}
            {job.state === 'failed'    && '✗ update failed — see log below'}
            {job.state === 'idle'      && 'updater idle'}
          </p>
          {job.log && (
            <pre className="font-mono text-xs rounded-lg p-3 overflow-auto"
              style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-muted)', maxHeight: 240 }}>
              {job.log}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function SystemPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const headers = { Authorization: `Bearer ${token}` }

  const fileInputRef = useRef(null)
  const [parsed, setParsed]             = useState(null)   // parsed backup JSON for preview
  const [fileName, setFileName]         = useState('')
  const [parseError, setParseError]     = useState(null)
  const [armed, setArmed]               = useState(false)
  const [restoring, setRestoring]       = useState(false)
  const [restoreError, setRestoreError] = useState(null)
  const [restoreDone, setRestoreDone]   = useState(false)
  const [dragOver, setDragOver]         = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  // Redirect non-admins (after all hooks)
  if (user?.role !== 'admin') {
    navigate('/')
    return null
  }

  function handleFile(file) {
    if (!file) return
    setParseError(null)
    setRestoreError(null)
    setArmed(false)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.version || !data.createdAt || !data.counts || !data.data) {
          setParseError('File does not look like a Flux backup (missing required fields).')
          setParsed(null)
          return
        }
        setParsed(data)
      } catch {
        setParseError('Could not parse file as JSON.')
        setParsed(null)
      }
    }
    reader.onerror = () => {
      setParseError('Could not read file.')
      setParsed(null)
    }
    reader.readAsText(file)
  }

  function onFileInput(e) {
    handleFile(e.target.files[0])
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  function resetFile() {
    setParsed(null)
    setFileName('')
    setParseError(null)
    setArmed(false)
    setRestoreError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function doRestore() {
    if (!fileInputRef.current?.files[0]) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const formData = new FormData()
      formData.append('file', fileInputRef.current.files[0])
      await axios.post('/api/system/restore', formData, {
        headers,
      })
      setRestoring(false)
      setRestoreDone(true)
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setRestoreError(err.response?.data?.error || 'Restore failed. See server logs.')
      setArmed(false)
      setRestoring(false)
    }
  }

  function handleRestoreClick() {
    if (armed) {
      doRestore()
    } else {
      setArmed(true)
    }
  }

  const panel = {
    background: 'var(--flux-panel)',
    border: '1px solid var(--flux-border)',
    borderRadius: '12px',
    padding: '24px',
  }

  const sectionLabel = {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: 'var(--flux-dim)',
    marginBottom: '12px',
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 className="font-display font-bold text-xl mb-6" style={{ color: 'var(--flux-text)' }}>
        🗄 System
      </h1>

      <ServerUpdateCard headers={headers} />

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

        {/* ── Export column ── */}
        <div style={panel}>
          <p style={sectionLabel}>Export Backup</p>
          <p className="font-sans text-sm mb-4" style={{ color: 'var(--flux-muted)' }}>
            Downloads a JSON file containing all devices, machines, agents, users, alert rules, and settings.
          </p>
          <button
            onClick={() => { window.location.href = `/api/system/backup?token=${token}` }}
            className="w-full font-display font-semibold text-sm py-2 rounded-lg mb-2"
            style={{ background: 'var(--flux-accent)', color: '#fff' }}
          >
            ⬇ Download Backup
          </button>
          <p className="font-mono text-xs text-center" style={{ color: 'var(--flux-dim)' }}>
            flux-backup-{today}.json
          </p>
        </div>

        {/* ── Restore column ── */}
        <div style={panel}>
          <p style={sectionLabel}>Restore from Backup</p>
          <p className="font-sans text-sm mb-3" style={{ color: 'var(--flux-muted)' }}>
            Upload a previously exported JSON file.{' '}
            <span style={{ color: 'var(--flux-critical)' }}>⚠ Replaces all current data.</span>
          </p>

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${dragOver ? 'var(--flux-accent)' : 'var(--flux-border)'}`,
              borderRadius: 8,
              padding: '16px',
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: 10,
              color: 'var(--flux-dim)',
              fontSize: 12,
              transition: 'border-color 0.15s',
            }}
          >
            {fileName ? fileName : 'Drop .json file here or click to browse'}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={onFileInput}
            style={{ display: 'none' }}
          />

          {/* Parse error */}
          {parseError && (
            <p className="font-sans text-xs mb-2" style={{ color: 'var(--flux-critical)' }}>
              {parseError}
            </p>
          )}

          {/* Preview card */}
          {parsed && (
            <div className="font-mono text-xs mb-3 rounded-lg p-3"
              style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)' }}>
              <p className="font-semibold mb-1" style={{ color: 'var(--flux-text)' }}>{fileName}</p>
              <p style={{ color: 'var(--flux-muted)' }}>
                {Object.entries(parsed.counts)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(' · ')}
              </p>
              <p style={{ color: 'var(--flux-dim)', marginTop: 4 }}>
                Created: {new Date(parsed.createdAt).toLocaleString()} · Flux v{parsed.version}
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); resetFile() }}
                className="font-sans text-xs mt-2"
                style={{ color: 'var(--flux-dim)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Remove
              </button>
            </div>
          )}

          {/* Warning banner */}
          {parsed && (
            <div className="font-sans text-xs rounded-lg p-2 mb-3"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--flux-critical)' }}>
              ⚠ This will replace ALL current data and reload the page. You will need to log in again.
            </div>
          )}

          {/* Restore error */}
          {restoreError && (
            <p className="font-sans text-xs mb-2" style={{ color: 'var(--flux-critical)' }}>
              {restoreError}
            </p>
          )}

          {/* Success */}
          {restoreDone && (
            <p className="font-sans text-sm mb-2" style={{ color: 'var(--flux-healthy)' }}>
              ✓ Restore complete. Reloading…
            </p>
          )}

          {/* Restore button */}
          <button
            onClick={handleRestoreClick}
            disabled={!parsed || restoring || restoreDone}
            className="w-full font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-40"
            style={{
              background: parsed ? 'var(--flux-critical)' : 'var(--flux-border)',
              color: '#fff',
              cursor: parsed && !restoring ? 'pointer' : 'default',
            }}
          >
            {restoring
              ? 'Restoring…'
              : armed
              ? '⚠ Confirm — click again to proceed'
              : 'Restore & Replace'}
          </button>
        </div>
      </div>

      {/* What's included */}
      <div className="rounded-xl p-5" style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
        <p style={sectionLabel}>What's included in the backup</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            ['Devices & Groups',  'UPS devices, groups, poll config, NUT credentials'],
            ['Machines',          'SSH hosts + credentials, agent machines, shutdown config'],
            ['Config',            'Users, alert rules, SMTP settings, all app settings'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg p-3"
              style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)' }}>
              <p className="font-display text-xs font-semibold mb-1" style={{ color: 'var(--flux-accent)' }}>{title}</p>
              <p className="font-sans text-xs" style={{ color: 'var(--flux-muted)' }}>{desc}</p>
            </div>
          ))}
        </div>
        <p className="font-sans text-xs mt-3" style={{ color: 'var(--flux-dim)' }}>
          Not included: metrics history, agent event logs (transient/high-volume data)
        </p>
      </div>
    </div>
  )
}
