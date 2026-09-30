const EMPTY_BENEFIT = { freeQty: 0, totalQty: 0, eligibleBlocks: 0, giftUnlocked: false, giftValue: 0 }

/**
 * Computes the benefit a scheme unlocks for a given ordered quantity.
 *
 * Two scheme shapes are supported:
 * - Quantity schemes (`buyQty`/`freeQty`) apply per complete eligible block —
 *   e.g. "Buy 5 Get 1 Free" at an ordered quantity of 12 unlocks 2 free units
 *   (two complete blocks of 5).
 * - Gift schemes (`type: 'gift'`) unlock a one-time free product worth
 *   `giftValue` once the order reaches `minQty` — they don't add extra units
 *   of the ordered product itself.
 */
export function calculateSchemeBenefit(orderedQty, scheme) {
  const qty = Number(orderedQty) || 0

  if (!scheme || qty <= 0) {
    return { ...EMPTY_BENEFIT, totalQty: qty }
  }

  if (scheme.type === 'gift') {
    const giftUnlocked = qty >= scheme.minQty
    return {
      freeQty: 0,
      totalQty: qty,
      eligibleBlocks: giftUnlocked ? 1 : 0,
      giftUnlocked,
      giftValue: giftUnlocked ? scheme.giftValue : 0,
    }
  }

  const eligibleBlocks = Math.floor(qty / scheme.buyQty)
  const freeQty = eligibleBlocks * scheme.freeQty

  return { freeQty, totalQty: qty + freeQty, eligibleBlocks, giftUnlocked: false, giftValue: 0 }
}

/**
 * Picks the scheme that yields the highest free quantity for the given
 * ordered quantity — used to suggest the best-value scheme to the shopper.
 */
export function findBestScheme(orderedQty, schemes) {
  if (!schemes?.length) return null

  return schemes.reduce((best, scheme) => {
    const { freeQty } = calculateSchemeBenefit(orderedQty, scheme)
    const bestFreeQty = best ? calculateSchemeBenefit(orderedQty, best).freeQty : -1
    return freeQty > bestFreeQty ? scheme : best
  }, null)
}
