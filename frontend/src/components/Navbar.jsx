import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'
import { ParallaxMark } from './ParallaxMark'

export default function Navbar() {
  const { user, token, logout } = useAuth()
  const navigate = useNavigate()
  const [unresolved, setUnresolved] = useState(0)
  const [updateAvailable, setUpdateAvailable] = useState(
    sessionStorage.getItem('flux-update-check') === 'available'
  )
  const [accountModal, setAccountModal] = useState(false)
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [pwStatus, setPwStatus] = useState(null) // null | 'saving' | 'ok' | error string
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    if (!token) return
    const fetchCount = () =>
      axios.get('/api/alerts/unresolved/count', { headers })
        .then(r => setUnresolved(r.data.count))
        .catch(() => {})
    fetchCount()
    const interval = setInterval(fetchCount, 30_000)
    return () => clearInterval(interval)
  }, [token])

  // Check for server updates once per session (admins only)
  useEffect(() => {
    if (!token || user?.role !== 'admin') return
    if (sessionStorage.getItem('flux-update-check')) return
    axios.get('/api/system/update', { headers })
      .then(r => {
        const available = !!r.data.updateAvailable
        sessionStorage.setItem('flux-update-check', available ? 'available' : 'none')
        setUpdateAvailable(available)
      })
      .catch(() => {})
  }, [token])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pwForm.newPassword !== pwForm.confirm) {
      setPwStatus('Passwords do not match')
      return
    }
    setPwStatus('saving')
    try {
      await axios.put('/api/auth/password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      }, { headers })
      setPwStatus('ok')
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' })
      setTimeout(() => { setPwStatus(null); setAccountModal(false) }, 2000)
    } catch (err) {
      setPwStatus(err.response?.data?.error || 'Failed')
    }
  }

  const link = ({ isActive }) =>
    `font-display text-base font-semibold tracking-wide transition-colors ${isActive
      ? 'text-flux-accent'
      : 'text-flux-muted hover:text-flux-text'}`

  const inputStyle = {
    background: 'var(--flux-bg)',
    border: '1px solid var(--flux-border)',
    color: 'var(--flux-text)',
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--flux-bg)' }}>
      <nav style={{ background: 'var(--flux-panel)', borderBottom: '1px solid var(--flux-border)' }}
        className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div style={{ filter: 'drop-shadow(0 0 8px rgba(249,115,22,0.55))' }}>
              <ParallaxMark size={32} />
            </div>
            <span className="font-display font-bold text-2xl tracking-wide"
              style={{
                color: 'var(--flux-text)',
                textShadow: '0 0 10px rgba(249,115,22,0.5), 0 0 22px rgba(249,115,22,0.2)',
              }}>
              Flux
            </span>
          </div>
          <div className="flex items-center gap-6">
            <NavLink to="/" end className={link}>Power Center</NavLink>
            <NavLink to="/alerts" className={link}>
              <span className="relative">
                Alerts
                {unresolved > 0 && (
                  <span className="absolute -top-2 -right-4 text-xs font-mono rounded-full px-1 min-w-[16px] text-center leading-4"
                    style={{ background: 'var(--flux-critical)', color: '#fff', fontSize: '10px' }}>
                    {unresolved}
                  </span>
                )}
              </span>
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink to="/users" className={link}>Users</NavLink>
            )}
            {user?.role === 'admin' && (
              <NavLink to="/settings" className={link}>Settings</NavLink>
            )}
            {user?.role === 'admin' && (
              <NavLink to="/system" className={link}>System</NavLink>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {updateAvailable && user?.role === 'admin' && (
            <NavLink to="/system"
              className="font-sans text-xs px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid var(--flux-accent)', color: 'var(--flux-accent)' }}>
              ⬆ Update available
            </NavLink>
          )}
          <button onClick={() => setAccountModal(true)}
            className="font-mono text-sm transition-colors"
            style={{ color: 'var(--flux-muted)' }}
            onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
            onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
            {user?.username}
          </button>
          <button onClick={handleLogout}
            className="font-sans text-sm transition-colors"
            style={{ color: 'var(--flux-muted)' }}
            onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
            onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
            Logout
          </button>
        </div>
      </nav>
      <main className="p-6">
        <Outlet />
      </main>
      <footer className="px-6 py-4 text-center">
        <span className="font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>
          Flux v2.0.0 by Parallax Group © 2026
        </span>
      </footer>

      {/* My Account modal */}
      {accountModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>My Account</h2>
              <button onClick={() => { setAccountModal(false); setPwStatus(null); setPwForm({ currentPassword: '', newPassword: '', confirm: '' }) }}
                className="font-mono text-lg" style={{ color: 'var(--flux-muted)' }}>×</button>
            </div>
            <p className="font-sans text-xs mb-4" style={{ color: 'var(--flux-dim)' }}>
              {user?.username} · {user?.role}
            </p>
            <form onSubmit={changePassword} className="space-y-3">
              <p className="font-display text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--flux-dim)' }}>Change Password</p>
              {[
                ['currentPassword', 'Current Password'],
                ['newPassword', 'New Password'],
                ['confirm', 'Confirm New Password'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                  <input type="password" value={pwForm[key]}
                    onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors"
                    style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--flux-accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--flux-border)'}
                    required />
                </div>
              ))}
              {pwStatus && pwStatus !== 'saving' && (
                <p className="font-sans text-sm"
                  style={{ color: pwStatus === 'ok' ? 'var(--flux-healthy)' : 'var(--flux-critical)' }}>
                  {pwStatus === 'ok' ? 'Password changed!' : pwStatus}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={pwStatus === 'saving'}
                  className="flex-1 font-display font-semibold text-sm py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--flux-accent)', color: '#fff' }}>
                  {pwStatus === 'saving' ? 'Saving…' : 'Change Password'}
                </button>
                <button type="button" onClick={() => { setAccountModal(false); setPwStatus(null); setPwForm({ currentPassword: '', newPassword: '', confirm: '' }) }}
                  className="flex-1 font-sans text-sm py-2 rounded-lg"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
