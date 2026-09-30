// Catalog of all possible order payment methods. Divisions don't define their
// own labels — they opt into a subset of these keys via
// rules.orderEntry.paymentOptions (see backend/src/config/divisionRules.js).
export const PAYMENT_OPTION_LABELS = {
  'pdc-delivery': 'PDC on Delivery',
  online: 'Online Payment',
  'payment-link': 'Send Payment Link to Customer',
  'post-dated-cheque': 'Post Dated Cheque',
}
