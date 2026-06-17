import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../App'

const BLANK = { username: '', email: '', password: '', role: 'viewer' }
const BLANK_EDIT = { username: '', email: '', role: 'viewer', password: '' }

export default function UsersPage() {
  const { token, user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [editUser, setEditUser] = useState(null)
  const [editForm, setEditForm] = useState(BLANK_EDIT)
  const [confirmDel, setConfirmDel] = useState(null)
  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    axios.get('/api/users', { headers }).then(r => setUsers(r.data))
  }, [])

  async function addUser(e) {
    e.preventDefault()
    const { data } = await axios.post('/api/users', form, { headers })
    setUsers(u => [...u, data])
    setModal(false)
    setForm(BLANK)
  }

  function openEdit(u) {
    setEditUser(u)
    setEditForm({ username: u.username, email: u.email, role: u.role, password: '' })
  }

  async function saveEdit(e) {
    e.preventDefault()
    const payload = { username: editForm.username, email: editForm.email, role: editForm.role }
    if (editForm.password) payload.password = editForm.password
    const { data } = await axios.put(`/api/users/${editUser.id}`, payload, { headers })
    setUsers(u => u.map(x => x.id === data.id ? { ...x, ...data } : x))
    setEditUser(null)
  }

  async function deleteUser() {
    await axios.delete(`/api/users/${confirmDel.id}`, { headers })
    setUsers(u => u.filter(x => x.id !== confirmDel.id))
    setConfirmDel(null)
  }

  const ROLE_COLOR = {
    admin:    'var(--flux-accent)',
    operator: 'var(--flux-warning)',
    viewer:   'var(--flux-muted)',
  }

  const inputCls = 'w-full font-mono text-sm rounded-lg px-3 py-2 outline-none transition-colors'
  const inputStyle = { background: 'var(--flux-bg)', border: '1px solid var(--flux-border)', color: 'var(--flux-text)' }
  const onFocus = e => e.target.style.borderColor = 'var(--flux-accent)'
  const onBlur  = e => e.target.style.borderColor = 'var(--flux-border)'

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-xl" style={{ color: 'var(--flux-text)' }}>Users</h1>
        <button onClick={() => setModal(true)}
          className="font-display font-semibold text-sm px-4 py-2 rounded-lg transition-all"
          style={{ background: 'var(--flux-accent)', color: '#fff' }}
          onMouseEnter={e => e.target.style.boxShadow = '0 0 20px var(--flux-glow)'}
          onMouseLeave={e => e.target.style.boxShadow = 'none'}>
          + Add User
        </button>
      </div>

      <div className="rounded-lg overflow-hidden"
        style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--flux-border)' }}>
              {['Username', 'Email', 'Role', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 font-display text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--flux-dim)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--flux-border)' }} className="last:border-0">
                <td className="px-4 py-3">
                  <span className="font-mono text-sm" style={{ color: 'var(--flux-text)' }}>
                    {u.username}
                    {u.id === me?.id && (
                      <span className="ml-2 font-sans text-xs" style={{ color: 'var(--flux-dim)' }}>(you)</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-sm" style={{ color: 'var(--flux-muted)' }}>{u.email}</td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold uppercase"
                    style={{ color: ROLE_COLOR[u.role] || 'var(--flux-muted)' }}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => openEdit(u)}
                      className="font-sans text-xs transition-colors"
                      style={{ color: 'var(--flux-muted)' }}
                      onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
                      onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
                      Edit
                    </button>
                    {u.id !== me?.id && (
                      <button onClick={() => setConfirmDel(u)}
                        className="font-sans text-xs transition-colors"
                        style={{ color: 'var(--flux-muted)' }}
                        onMouseEnter={e => e.target.style.color = 'var(--flux-critical)'}
                        onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add user modal */}
      {modal && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>Add User</h2>
              <button onClick={() => setModal(false)} className="font-mono text-lg" style={{ color: 'var(--flux-muted)' }}>×</button>
            </div>
            <form onSubmit={addUser} className="space-y-3">
              {[['username','Username','text'],['email','Email','email'],['password','Password','password']].map(([key,label,type]) => (
                <div key={key}>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                  <input type={type} value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required />
                </div>
              ))}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className={inputCls} style={inputStyle}>
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                  style={{ background: 'var(--flux-accent)', color: '#fff' }}>Add User</button>
                <button type="button" onClick={() => setModal(false)}
                  className="flex-1 font-sans text-sm py-2 rounded-lg"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--flux-text)' }}>Edit User</h2>
              <button onClick={() => setEditUser(null)} className="font-mono text-lg" style={{ color: 'var(--flux-muted)' }}>×</button>
            </div>
            <form onSubmit={saveEdit} className="space-y-3">
              {[['username','Username','text'],['email','Email','email']].map(([key,label,type]) => (
                <div key={key}>
                  <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>{label}</label>
                  <input type={type} value={editForm[key]}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} required />
                </div>
              ))}
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>Role</label>
                <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className={inputCls} style={inputStyle}>
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="font-sans text-xs block mb-1" style={{ color: 'var(--flux-muted)' }}>
                  New Password <span style={{ color: 'var(--flux-dim)' }}>(leave blank to keep current)</span>
                </label>
                <input type="password" value={editForm.password} placeholder="Leave blank to keep current"
                  onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                  className={inputCls} style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                  style={{ background: 'var(--flux-accent)', color: '#fff' }}>Save Changes</button>
                <button type="button" onClick={() => setEditUser(null)}
                  className="flex-1 font-sans text-sm py-2 rounded-lg"
                  style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-xl p-6"
            style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}>
            <h2 className="font-display font-bold text-base mb-3" style={{ color: 'var(--flux-text)' }}>Remove User</h2>
            <p className="font-sans text-sm mb-6" style={{ color: 'var(--flux-muted)' }}>
              Remove <span style={{ color: 'var(--flux-text)' }} className="font-semibold">{confirmDel.username}</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={deleteUser}
                className="flex-1 font-display font-semibold text-sm py-2 rounded-lg"
                style={{ background: 'var(--flux-critical)', color: '#fff' }}>Remove</button>
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 font-sans text-sm py-2 rounded-lg"
                style={{ border: '1px solid var(--flux-border)', color: 'var(--flux-muted)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
