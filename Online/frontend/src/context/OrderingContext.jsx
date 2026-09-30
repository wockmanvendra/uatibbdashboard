import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext.jsx'

const OrderingContext = createContext(null)

const ORDERING_KEY = 'd2d_ordering'

// Same ownership check as CartContext's persisted cart — only restores
// selection state that belongs to the currently logged-in user.
function loadPersistedOrdering(userId) {
  try {
    const raw = localStorage.getItem(ORDERING_KEY)
    if (!raw) return {}
    const stored = JSON.parse(raw)
    return stored?.userId === (userId ?? null) ? stored : {}
  } catch {
    return {}
  }
}

export function OrderingProvider({ children }) {
  const { user } = useAuth()
  const persisted = loadPersistedOrdering(user?.id)
  const [orderingFor, setOrderingFor] = useState(persisted.orderingFor ?? null)
  const [resubmitOrderId, setResubmitOrderId] = useState(persisted.resubmitOrderId ?? null)
  const [resubmitOrderNumber, setResubmitOrderNumber] = useState(persisted.resubmitOrderNumber ?? null)
  const lastUserId = useRef(user?.id ?? null)

  useEffect(() => {
    if (lastUserId.current !== (user?.id ?? null)) {
      lastUserId.current = user?.id ?? null
      setOrderingFor(null)
      setResubmitOrderId(null)
      setResubmitOrderNumber(null)
    }
  }, [user?.id])

  useEffect(() => {
    localStorage.setItem(ORDERING_KEY, JSON.stringify({
      userId: user?.id ?? null,
      orderingFor,
      resubmitOrderId,
      resubmitOrderNumber,
    }))
  }, [user?.id, orderingFor, resubmitOrderId, resubmitOrderNumber])

  return (
    <OrderingContext.Provider value={{
      orderingFor,
      selectCustomer: setOrderingFor,
      clearCustomer: () => setOrderingFor(null),
      resubmitOrderId,
      setResubmitOrderId,
      resubmitOrderNumber,
      setResubmitOrderNumber,
      clearResubmit: () => { setResubmitOrderId(null); setResubmitOrderNumber(null) },
    }}>
      {children}
    </OrderingContext.Provider>
  )
}

export function useOrdering() {
  return useContext(OrderingContext)
}
