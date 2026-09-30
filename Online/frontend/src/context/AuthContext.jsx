import { createContext, useContext, useEffect, useState } from 'react'
import { setAuthToken, setUnauthorizedHandler } from '../lib/api.js'

const AuthContext = createContext(null)

const SESSION_KEY = 'd2d_session'

// empcode only applies to field/management/back-office users — these usertypes
// have no Infinity empcode mapping, so don't carry it in the session
const NO_EMPCODE_USERTYPES = ['doctor', 'doctor-pharmacy', 'patient', 'stockiest']

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const session = loadSession()
    setAuthToken(session?.token ?? null)
    return session?.user ?? null
  })

  const login = ({ token, user: userData }) => {
    const session = {
      id: userData.id,
      name: userData.name,
      usertype: userData.usertype,
      mobileno: userData.mobileno,
      divisionCode: userData.divisionCode ?? null,
      sapCode: userData.sapCode ?? null,
      userLocation: userData.userLocation ?? null,
      empcode: NO_EMPCODE_USERTYPES.includes(userData.usertype) ? null : (userData.empcode ?? null),
      cfaCodes: userData.cfaCodes ?? null,
      cfaCode: userData.cfaCode ?? null,
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user: session }))
    setAuthToken(token)
    setUser(session)
  }

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setAuthToken(null)
    setUser(null)
  }

  useEffect(() => {
    setUnauthorizedHandler(() => logout())
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
