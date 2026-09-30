import { createContext, useContext, useEffect, useRef } from 'react'
import { useCartState, dedupeItems } from '../hooks/useCart.js'
import { useAuth } from './AuthContext.jsx'

const CartContext = createContext(null)

const CART_KEY = 'd2d_cart'

// Only restores a cart if it belongs to the currently logged-in user — same
// ownership check as AuthContext's session, so switching users on a shared
// browser never leaks the previous user's cart. Also collapses any duplicate
// product lines a cart may have picked up before addItem started merging
// them, so an already-persisted cart gets cleaned up the moment this loads.
function loadPersistedCart(userId) {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return []
    const stored = JSON.parse(raw)
    return stored?.userId === (userId ?? null) ? dedupeItems(stored.items ?? []) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }) {
  const { user } = useAuth()
  const cart = useCartState(loadPersistedCart(user?.id))
  const { clearCart, items } = cart
  const lastUserId = useRef(user?.id ?? null)

  useEffect(() => {
    if (lastUserId.current !== (user?.id ?? null)) {
      lastUserId.current = user?.id ?? null
      clearCart()
    }
  }, [user?.id, clearCart])

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify({ userId: user?.id ?? null, items }))
  }, [user?.id, items])

  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within a CartProvider')
  return context
}
