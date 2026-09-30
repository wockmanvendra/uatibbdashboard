import { createContext, useContext, useEffect, useState } from 'react'
import { appConfigApi } from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'

const AppConfigContext = createContext({ adminContactMobile: null })

export function AppConfigProvider({ children }) {
  const { user } = useAuth()
  const [adminContactMobile, setAdminContactMobile] = useState(null)

  useEffect(() => {
    if (!user) return
    appConfigApi.get(user.divisionCode)
      .then(({ adminContactMobile }) => setAdminContactMobile(adminContactMobile))
      .catch(() => {})
  }, [user, user?.divisionCode])

  return (
    <AppConfigContext.Provider value={{ adminContactMobile }}>
      {children}
    </AppConfigContext.Provider>
  )
}

export function useAppConfig() {
  return useContext(AppConfigContext)
}
