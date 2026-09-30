import { useMemo, useState } from 'react'
import { calculateSchemeBenefit } from '../utils/schemeCalculator.js'

let cartItemSequence = 0
const nextCartItemId = () => `cart-${++cartItemSequence}`

// Collapses any items sharing the same productId into one line, summing
// orderedQty (clamped to the product's min/max, same as updateQuantity) and
// recalculating scheme benefit off the *later* item's scheme/price — so
// re-adding a product with a different scheme selected updates the merged
// line's scheme too, not just its quantity. Keeps the *first* occurrence's
// cartItemId so the row that was already there keeps a stable identity.
export function dedupeItems(items) {
  const byProduct = new Map()
  for (const item of items) {
    const existing = byProduct.get(item.productId)
    if (!existing) { byProduct.set(item.productId, item); continue }
    const minQty = item.initMinOrderQty ?? item.minOrderQty ?? 1
    const maxQty = item.maxOrderQty ?? Infinity
    const orderedQty = Math.min(maxQty, Math.max(minQty, existing.orderedQty + item.orderedQty))
    const benefit = calculateSchemeBenefit(orderedQty, item.scheme)
    const isGiftScheme = item.scheme?.type === 'gift'
    byProduct.set(item.productId, {
      ...existing, ...item, cartItemId: existing.cartItemId, orderedQty,
      freeQty: benefit.freeQty, totalQty: benefit.totalQty, giftUnlocked: benefit.giftUnlocked,
      payableAmount: item.price * orderedQty,
      discountAmount: isGiftScheme ? benefit.giftValue : item.price * benefit.freeQty,
    })
  }
  return [...byProduct.values()]
}

export function useCartState(initialItems = []) {
  const [items, setItems] = useState(initialItems)

  // Adding a product already in the cart replaces its existing line (the
  // product page's quantity stepper pre-fills with the current in-cart
  // amount, so entry.orderedQty is always the full desired total, not a
  // delta) instead of creating a second line for the same product.
  const addItem = (entry) => {
    setItems((current) => {
      const idx = current.findIndex((item) => item.productId === entry.productId)
      if (idx === -1) return [...current, { ...entry, cartItemId: nextCartItemId() }]
      const updated = [...current]
      updated[idx] = { ...entry, cartItemId: current[idx].cartItemId }
      return updated
    })
  }

  const removeItem = (cartItemId) => {
    setItems((current) => current.filter((item) => item.cartItemId !== cartItemId))
  }

  const clearCart = () => {
    setItems([])
  }

  // Bulk-replaces the cart contents (e.g. pre-loading a rejected order's items for resubmission).
  const replaceItems = (entries) => {
    setItems(dedupeItems(entries.map((entry) => ({ ...entry, cartItemId: nextCartItemId() }))))
  }

  const updateQuantity = (cartItemId, nextQty) => {
    setItems((current) =>
      current.map((item) => {
        if (item.cartItemId !== cartItemId) return item
        const minQty = item.initMinOrderQty ?? item.minOrderQty ?? 1
        const maxQty = item.maxOrderQty ?? Infinity
        const orderedQty = Math.min(maxQty, Math.max(minQty, Number(nextQty) || 0))
        const benefit = calculateSchemeBenefit(orderedQty, item.scheme)
        const isGiftScheme = item.scheme?.type === 'gift'
        return {
          ...item,
          orderedQty,
          freeQty: benefit.freeQty,
          totalQty: benefit.totalQty,
          giftUnlocked: benefit.giftUnlocked,
          payableAmount: item.price * orderedQty,
          discountAmount: isGiftScheme ? benefit.giftValue : item.price * benefit.freeQty,
        }
      }),
    )
  }

  const totals = useMemo(() => {
    const itemCount = items.length
    const totalUnits = items.reduce((sum, item) => sum + item.totalQty, 0)
    const totalPayable = items.reduce((sum, item) => sum + item.payableAmount, 0)
    const totalDiscount = items.reduce((sum, item) => sum + item.discountAmount, 0)
    return { itemCount, totalUnits, totalPayable, totalDiscount }
  }, [items])

  return { items, addItem, removeItem, updateQuantity, clearCart, replaceItems, ...totals }
}
