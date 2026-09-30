import { createContext, useContext, useEffect, useState } from 'react'
import { divisionsApi } from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'

const DivisionConfigContext = createContext(null)

// Shown until the first /divisions/:code/config fetch resolves — mirrors
// DEFAULT_RULES in backend/src/config/divisionRules.js.
const FALLBACK_RULES = {
  orderWorkflow: {
    initialStatus: 'pending-l1',
    steps: [
      { step: 1, label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'], fromStatus: 'pending-l1', toStatus: 'approved-l1' },
      { step: 2, label: 'Marketing Approval', approverRoles: ['mm'], fromStatus: 'approved-l1', toStatus: 'approved' },
    ],
  },
  customerWorkflow: {
    initialStatus: 'pending-l1',
    steps: [
      { step: 1, label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'], fromStatus: 'pending-l1', toStatus: 'approved-l1' },
      { step: 2, label: 'Distribution Approval', approverRoles: ['dm'], fromStatus: 'approved-l1', toStatus: 'approved' },
    ],
  },
  orderEntry: { showPrices: true, minOrderValue: 0, paymentOptions: [] },
  documents: {
    customer: { patient: [], doctor: [], 'doctor-pharmacy': [], hospital: [] },
    order: [],
  },
}

export function DivisionConfigProvider({ children, divisionCodeOverride }) {
  const { user } = useAuth()
  const effectiveDivisionCode = divisionCodeOverride ?? user?.divisionCode
  const [rules, setRules] = useState(FALLBACK_RULES)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user && !divisionCodeOverride) return
    let cancelled = false
    setLoading(true)
    divisionsApi.getConfig(effectiveDivisionCode || 'default')
      .then(data => { if (!cancelled) setRules(data) })
      .catch(() => { if (!cancelled) setRules(FALLBACK_RULES) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [effectiveDivisionCode, user, divisionCodeOverride])

  return (
    <DivisionConfigContext.Provider value={{ rules, loading }}>
      {children}
    </DivisionConfigContext.Provider>
  )
}

export function useDivisionConfig() {
  const context = useContext(DivisionConfigContext)
  if (!context) throw new Error('useDivisionConfig must be used within a DivisionConfigProvider')
  return context
}
