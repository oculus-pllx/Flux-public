import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../App'
import { ParallaxMark } from '../components/ParallaxMark'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const { data } = await axios.post(endpoint, form)
      login(data.token, data.user)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = "w-full font-mono text-sm rounded-lg px-4 py-2.5 outline-none transition-colors"

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--flux-bg)' }}>
      <div className="w-full max-w-sm">
        {/* Brand block */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <ParallaxMark size={48} />
          <div className="flex flex-col items-center gap-1">
            <span className="font-display font-extrabold text-5xl tracking-tight" style={{ color: 'var(--flux-text)' }}>
              Flux
            </span>
            <span className="font-sans text-sm" style={{ color: 'var(--flux-muted)' }}>
              by Parallax Group
            </span>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-xl p-8"
          style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="font-sans text-xs block mb-1.5" style={{ color: 'var(--flux-muted)' }}>
                Username
              </label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className={inputClass}
                style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                required
              />
            </div>
            {mode === 'register' && (
              <div>
                <label className="font-sans text-xs block mb-1.5" style={{ color: 'var(--flux-muted)' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className={inputClass}
                  style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                  required
                />
              </div>
            )}
            <div>
              <label className="font-sans text-xs block mb-1.5" style={{ color: 'var(--flux-muted)' }}>
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className={inputClass}
                style={{ background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }}
                onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                required
              />
            </div>

            {error && (
              <p className="font-sans text-sm" style={{ color: 'var(--flux-critical)' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-display font-semibold text-sm py-2.5 rounded-lg transition-all disabled:opacity-50"
              style={{ background: 'var(--flux-accent)', color: '#fff' }}
              onMouseEnter={e => !loading && (e.target.style.boxShadow = '0 0 20px var(--flux-glow)')}
              onMouseLeave={e => e.target.style.boxShadow = 'none'}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            onClick={() => setMode(m => m === 'login' ? 'register' : 'login')}
            className="mt-4 font-sans text-sm w-full text-center transition-colors"
            style={{ color: 'var(--flux-muted)' }}
            onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
            onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
