import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, createContext, useContext } from 'react'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import DeviceDetail from './pages/DeviceDetail'
import AlertsPage from './pages/AlertsPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import SystemPage from './pages/SystemPage'
import MachineDetail from './pages/MachineDetail'
import PowerCenter from './pages/PowerCenter'

export const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

function PrivateRoute({ children }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('flux_token'))
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('flux_user') || 'null'))

  function login(token, user) {
    localStorage.setItem('flux_token', token)
    localStorage.setItem('flux_user', JSON.stringify(user))
    setToken(token)
    setUser(user)
  }

  function logout() {
    localStorage.removeItem('flux_token')
    localStorage.removeItem('flux_user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Navbar /></PrivateRoute>}>
            <Route index element={<PowerCenter />} />
            <Route path="devices/:id" element={<DeviceDetail />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="machines/:id"    element={<MachineDetail />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="system" element={<SystemPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
