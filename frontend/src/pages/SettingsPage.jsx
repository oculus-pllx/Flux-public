import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'
import { useNavigate } from 'react-router-dom'

const BLANK = {
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
  smtp_from: '', smtp_recipient: '', smtp_secure: 'false',
}

export default function SettingsPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(BLANK)
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState(null)
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    if (user?.role !== 'admin') { navigate('/'); return }
    axios.get('/api/settings', { headers }).then(r => {
      const data = { ...r.data }
      if (data.smtp_pass === '••••••') data.smtp_pass = ''
      setForm(f => ({ ...f, ...data }))
    })
  }, [])

  async function save(e) {
    e.preventDefault()
    await axios.put('/api/settings', form, { headers })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
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

  function field(key) {
    return {
      value: form[key],
      onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
      className: 'w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors',
      style: { background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' },
      onFocus: e => e.target.style.borderColor = 'var(--flux-accent)',
      onBlur: e => e.target.style.borderColor = 'var(--flux-border)',
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="font-display font-bold text-xl mb-6" style={{ color: 'var(--flux-text)' }}>Settings</h1>
      <form onSubmit={save}>
        <div className="rounded-xl p-6 mb-4 space-y-3"
          style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
          <p className="font-display text-xs font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--flux-dim)' }}>Email / SMTP</p>

          {[
            ['smtp_host',      'SMTP Host',        'text',     'smtp.gmail.com'],
            ['smtp_port',      'SMTP Port',         'number',   '587'],
            ['smtp_user',      'SMTP Username',     'email',    'you@example.com'],
            ['smtp_pass',      'SMTP Password',     'password', 'leave blank to keep saved password'],
            ['smtp_from',      'From Address',      'text',     'Flux Alerts <you@example.com>'],
            ['smtp_recipient', 'Alert Recipient',   'email',    'you@example.com'],
          ].map(([key, label, type, placeholder]) => (
            <div key={key}>
              <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
              <input type={type} placeholder={placeholder} {...field(key)} />
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <input type="checkbox" id="smtp_secure"
              checked={form.smtp_secure === 'true'}
              onChange={e => setForm(f => ({ ...f, smtp_secure: e.target.checked ? 'true' : 'false' }))} />
            <label htmlFor="smtp_secure" className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              Use TLS (port 465)
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="submit"
            className="font-display font-semibold text-sm px-5 py-2 rounded-lg transition-all"
            style={{ background: 'var(--flux-accent)', color: '#fff' }}
            onMouseEnter={e => e.target.style.boxShadow = '0 0 20px var(--flux-glow)'}
            onMouseLeave={e => e.target.style.boxShadow = 'none'}>
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
          <button type="button" onClick={testEmail} disabled={testStatus === 'sending'}
            className="font-sans text-sm px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}
            onMouseEnter={e => { if (testStatus !== 'sending') e.target.style.color = 'var(--flux-text)' }}
            onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
            {testStatus === 'sending' ? 'Sending…' : 'Send Test Email'}
          </button>
          {testStatus && testStatus !== 'sending' && (
            <span className="font-sans text-sm"
              style={{ color: testStatus === 'ok' ? 'var(--flux-healthy)' : 'var(--flux-critical)' }}>
              {testStatus === 'ok' ? 'Test email sent!' : testStatus}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
