import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PAYMENT_OPTION_LABELS } from '../data/paymentOptions.js'
import { ccavenueApi } from '../lib/api.js'
import { submitCcavenueForm } from '../lib/submitCcavenueForm.js'
import { formatCurrency } from '../utils/currency.js'

export function PayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="13" rx="2.2" />
      <path d="M2.5 10.5 L21.5 10.5" />
      <path d="M6 15 L10 15" />
    </svg>
  )
}

// Pay Now modal — choose Online Payment or Send Payment Link to Customer.
// Mirrors the payment-method modal on /cart (CartSummary.jsx / CartPage.jsx),
// reusing its CSS classes (.payment-modal*, .cart-panel__*, .cart-page__link-*).
// `kind` picks which pair of ccavenueApi endpoints to call — orders vs. a
// customer's outstanding balance — without duplicating this whole component.
function PayNowModal({ order, kind = 'order', title, payNowOptions, onClose, onLinkCreated }) {
  const navigate = useNavigate()
  const [method, setMethod] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generatedLink, setGeneratedLink] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)

  const initiateFn   = kind === 'customer' ? ccavenueApi.initiateCustomer   : ccavenueApi.initiate
  const createLinkFn = kind === 'customer' ? ccavenueApi.createLinkCustomer : ccavenueApi.createLink

  const handleConfirm = async () => {
    if (!method) { setError('Select a payment option to continue.'); return }
    setSubmitting(true)
    setError('')
    try {
      if (method === 'online') {
        const result = await initiateFn(order.id)
        if (result.mockMode) {
          navigate(`/payment/mock?orderId=${encodeURIComponent(result.orderId)}&amount=${encodeURIComponent(result.amount)}`)
        } else {
          submitCcavenueForm({ actionUrl: result.actionUrl, fields: result.fields })
        }
      } else {
        const result = await createLinkFn(order.id)
        setGeneratedLink(result)
        onLinkCreated?.()
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink.paymentLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // clipboard API unavailable — the link is still selectable/visible in the input
    }
  }

  if (generatedLink) {
    return (
      <>
        <div className="payment-modal-overlay" aria-hidden="true" />
        <div className="payment-modal" role="dialog" aria-modal="true" aria-label="Payment link generated">
          <header className="payment-modal__header">
            <h3 className="payment-modal__title">Payment link generated</h3>
          </header>
          <div className="payment-modal__body">
            <p className="cart-page__link-hint">
              Share this link with the customer to collect payment of {formatCurrency(generatedLink.amount)}.
            </p>
            <div className="cart-page__link-row">
              <input
                type="text"
                className="cart-page__link-input"
                readOnly
                value={generatedLink.paymentLink}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="cart-page__link-copy" onClick={handleCopyLink}>
                {linkCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
          <footer className="payment-modal__footer">
            <button type="button" className="cart-panel__place-order" onClick={onClose}>Done</button>
          </footer>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="payment-modal-overlay" onClick={submitting ? undefined : onClose} aria-hidden="true" />
      <div className="payment-modal" role="dialog" aria-modal="true" aria-label="Pay now">
        <header className="payment-modal__header">
          <h3 className="payment-modal__title">{title ?? `Pay Now — ${order.orderNumber}`}</h3>
          <button type="button" className="payment-modal__close" onClick={onClose} aria-label="Close">&times;</button>
        </header>

        <div className="payment-modal__body">
          <div className="payment-modal__options">
            {payNowOptions.map((option) => (
              <label key={option} className="cart-panel__payment-option">
                <input
                  type="radio"
                  name="pay-now-method"
                  value={option}
                  checked={method === option}
                  onChange={() => { setMethod(option); setError('') }}
                />
                {PAYMENT_OPTION_LABELS[option]}
              </label>
            ))}
            {error && <p className="cart-panel__payment-error" role="alert">{error}</p>}
          </div>
        </div>

        <footer className="payment-modal__footer">
          <button type="button" className="payment-modal__back" onClick={onClose}>Back</button>
          <button type="button" className="cart-panel__place-order" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Processing…' : 'Pay Now'}
          </button>
        </footer>
      </div>
    </>
  )
}

export default PayNowModal
