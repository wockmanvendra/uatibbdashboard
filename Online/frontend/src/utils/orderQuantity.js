// A valid order quantity is initMinOrderQty, or initMinOrderQty plus any
// whole number of minOrderQty steps — the same sequence the +/- stepper
// can reach. Used to validate quantities typed in directly, which aren't
// otherwise constrained to that sequence.
export function getOrderQuantityIssue(qty, { initMinOrderQty, minOrderQty, maxOrderQty }) {
  if (qty < initMinOrderQty) return `Minimum order quantity is ${initMinOrderQty} units.`
  if (qty > maxOrderQty) return `Maximum order quantity is ${maxOrderQty} units.`
  if ((qty - initMinOrderQty) % minOrderQty !== 0) {
    return `Order quantity must be ${initMinOrderQty}, or increase in steps of ${minOrderQty} units (e.g. ${initMinOrderQty + minOrderQty}, ${initMinOrderQty + 2 * minOrderQty}...).`
  }
  return null
}

export const isValidOrderQuantity = (qty, rules) => getOrderQuantityIssue(qty, rules) === null
