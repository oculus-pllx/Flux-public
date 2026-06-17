import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'
import DeviceCard from '../components/DeviceCard'

const BLANK = { name: '', host: '', port: 3493, upsName: 'ups', pollInterval: 30, nutUsername: '', nutPassword: '' }

const FIELDS = [
  ['name',        'Device Name',        'text'],
  ['host',        'Host / IP',          'text'],
  ['port',        'NUT Port',           'number'],
  ['upsName',     'UPS Name',           'text'],
  ['pollInterval','Poll Interval (s)',   'number'],
]

const AUTH_FIELDS = [
  ['nutUsername', 'NUT Username (optional)', 'text'],
  ['nutPassword', 'NUT Password (optional)', 'password'],
]

export default function Dashboard() {
  const { token, user } = useAuth()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | 'edit'
  const [form, setForm] = useState(BLANK)
  const [confirm, setConfirm] = useState(null) // device to delete
  const [polling, setPolling] = useState(null) // id currently being polled
  const [saveError, setSaveError] = useState('')
  const headers = { Authorization: `Bearer ${token}` }
  const canWrite = user?.role === 'admin' || user?.role === 'operator'

  useEffect(() => {
    axios.get('/api/devices', { headers }).then(r => setDevices(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!token) return
    const es = new EventSource(`/api/metrics/stream?token=${token}`)
    es.addEventListener('poll', e => {
      const { deviceId, data, lastSeen } = JSON.parse(e.data)
      setDevices(d => d.map(x => x.id === deviceId ? { ...x, lastStatus: data, lastSeen } : x))
    })
    return () => es.close()
  }, [token])

  function openAdd() { setForm(BLANK); setSaveError(''); setModal('add') }
  function openEdit(device) { setForm({ ...device }); setSaveError(''); setModal('edit') }
  function closeModal() { setModal(null); setForm(BLANK); setSaveError('') }

  async function saveDevice(e) {
    e.preventDefault()
    setSaveError('')
    try {
      if (modal === 'add') {
        const { data } = await axios.post('/api/devices', form, { headers })
        setDevices(d => [...d, data])
      } else {
        const { data } = await axios.put(`/api/devices/${form.id}`, form, { headers })
        setDevices(d => d.map(x => x.id === data.id ? data : x))
      }
      closeModal()
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Failed to save device')
    }
  }

  async function deleteDevice() {
    await axios.delete(`/api/devices/${confirm.id}`, { headers })
    setDevices(d => d.filter(x => x.id !== confirm.id))
    setConfirm(null)
  }

  async function pollNow(device) {
    setPolling(device.id)
    try {
      const { data } = await axios.post(`/api/devices/${device.id}/poll`, {}, { headers })
      setDevices(d => d.map(x => x.id === device.id ? { ...x, lastStatus: data.data, lastSeen: new Date().toISOString() } : x))
    } catch {}
    setPolling(null)
  }

  if (loading) return <p className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>Loading…</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>Devices</h1>
        {canWrite && (
          <button onClick={openAdd}
            className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all"
            style={{ background: 'var(--flux-accent)', color: '#fff' }}
            onMouseEnter={e => e.target.style.boxShadow = '0 0 20px var(--flux-glow)'}
            onMouseLeave={e => e.target.style.boxShadow = 'none'}>
            + Add Device
          </button>
        )}
      </div>

      {devices.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-sans text-sm mb-2" style={{ color: 'var(--flux-muted)' }}>No devices yet.</p>
          <p className="font-sans text-sm" style={{ color: 'var(--flux-dim)' }}>Add a NUT server to start monitoring.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {devices.map(d => (
            <div key={d.id} className="relative">
              <DeviceCard device={d} onEdit={openEdit} onDelete={setConfirm} />
              {canWrite && (
                <button
                  onClick={() => pollNow(d)}
                  disabled={polling === d.id}
                  className="absolute top-3 right-3 font-mono text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--flux-muted)', border: '1px solid var(--flux-border)' }}
                  title="Poll now">
                  {polling === d.id ? '…' : '↻'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <Modal title={modal === 'add' ? 'Add Device' : 'Edit Device'} onClose={closeModal}>
          <form onSubmit={saveDevice} className="space-y-3">
            {FIELDS.map(([key, label, type]) => (
              <Field key={key} label={label}>
                <input
                  type={type}
                  value={form[key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                  required
                />
              </Field>
            ))}
            <p className="font-display text-xs font-semibold uppercase tracking-widest pt-1" style={{ color: 'var(--flux-dim)' }}>
              NUT Auth — required for UPS control commands
            </p>
            {AUTH_FIELDS.map(([key, label, type]) => (
              <Field key={key} label={label}>
                <input
                  type={type}
                  value={form[key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </Field>
            ))}
            {saveError && (
              <p className="font-sans text-xs py-1" style={{ color: 'var(--flux-critical)' }}>{saveError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <SubmitBtn>{modal === 'add' ? 'Add Device' : 'Save Changes'}</SubmitBtn>
              <CancelBtn onClick={closeModal} />
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirm */}
      {confirm && (
        <Modal title="Delete Device" onClose={() => setConfirm(null)}>
          <p className="font-sans text-sm mb-6" style={{ color: 'var(--flux-muted)' }}>
            Delete <span style={{ color: 'var(--flux-text)' }} className="font-semibold">{confirm.name}</span>? This removes all associated metrics. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={deleteDevice}
              className="flex-1 font-display font-semibold text-sm py-2 rounded-lg transition-all"
              style={{ background: 'var(--flux-critical)', color: '#fff' }}>
              Delete
            </button>
            <CancelBtn onClick={() => setConfirm(null)} />
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Shared form primitives ────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>{title}</h2>
          <button onClick={onClose} className="font-mono text-lg leading-none"
            style={{ color: 'var(--flux-muted)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
      {children && React.cloneElement(children, {
        className: 'w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors',
        style: { background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' },
        onFocus: e => e.target.style.borderColor = 'var(--flux-accent)',
        onBlur: e => e.target.style.borderColor = 'var(--flux-border)',
      })}
    </div>
  )
}

import React from 'react'

function SubmitBtn({ children }) {
  return (
    <button type="submit"
      className="flex-1 font-display font-semibold text-sm py-2 rounded-lg transition-all"
      style={{ background: 'var(--flux-accent)', color: '#fff' }}
      onMouseEnter={e => e.target.style.boxShadow = '0 0 20px var(--flux-glow)'}
      onMouseLeave={e => e.target.style.boxShadow = 'none'}>
      {children}
    </button>
  )
}

function CancelBtn({ onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 font-sans text-sm py-2 rounded-lg transition-colors"
      style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}
      onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
      onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
      Cancel
    </button>
  )
}
