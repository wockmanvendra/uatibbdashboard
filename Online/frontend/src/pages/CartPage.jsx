import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CartSummary from '../components/CartSummary.jsx'
import OutcomeModal from '../components/OutcomeModal.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useOrders } from '../context/OrdersContext.jsx'
import { useOrdering } from '../context/OrderingContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { ccavenueApi } from '../lib/api.js'
import { submitCcavenueForm } from '../lib/submitCcavenueForm.js'
import { buildSuccessOutcome } from '../utils/outcomeMessages.js'
import { formatCurrency } from '../utils/currency.js'
import './CartPage.css'

const DOC_CONDITIONAL_REQUIRED = { panCopy: 'panNumber', aadhaarCopy: 'aadhaarNumber' }

function getMissingRequiredDocs(customer, docConfig) {
  return (docConfig ?? []).filter(doc => {
    const conditionalField = DOC_CONDITIONAL_REQUIRED[doc.key]
    const conditionalRequired = conditionalField ? !!(customer[conditionalField] ?? '').toString().trim() : false
    const isGstDoc = /gst/i.test(doc.key) || /gst/i.test(doc.label ?? '')
    const isRequired = (doc.required || conditionalRequired) && !(customer.compositionScheme && isGstDoc)
    return isRequired && !customer.documents?.[doc.key]?.url
  })
}

function CartPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const cart = useCart()
  const { placeOrder, resubmitOrder } = useOrders()
  const { orderingFor, clearCustomer, resubmitOrderId, resubmitOrderNumber, clearResubmit } = useOrdering()
  const { rules } = useDivisionConfig()
  const [generatedLink, setGeneratedLink] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [orderOutcome, setOrderOutcome] = useState(null)
  const [pendingOrderFlow, setPendingOrderFlow] = useState(null)

  const handleCancelResubmit = () => {
    clearResubmit()
    cart.clearCart()
    navigate('/dashboard')
  }

  const handlePlaceOrder = async (extraData, paymentMethod, chequeDetails, remarks, deliveryAddress, orderEntityId) => {
    if (cart.items.length === 0) return
    if (orderingFor?.drugLicenceValidTill && (orderingFor.customerType === 'doctor-pharmacy' || orderingFor.customerType === 'hospital')) {
      const today = new Date().toISOString().slice(0, 10)
      if (orderingFor.drugLicenceValidTill < today) {
        const expiry = new Date(orderingFor.drugLicenceValidTill + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        setOrderOutcome({ status: 'error', title: 'Order blocked — Expired drug licence', message: `${orderingFor.name}'s drug licence expired on ${expiry}. Please ask the customer to renew before placing an order.` })
        return
      }
    }
    if (orderingFor) {
      const docConfig = rules.documents.customer[orderingFor.customerType] ?? []
      const missing = getMissingRequiredDocs(orderingFor, docConfig)
      if (missing.length > 0) {
        setOrderOutcome({ status: 'error', title: 'Order blocked — Missing documents', message: `The following required documents for ${orderingFor.name} have not been submitted: ${missing.map(d => d.label).join(', ')}. Please complete the customer's documents before placing an order.` })
        return
      }
    }
    const totals = { totalUnits: cart.totalUnits, totalPayable: cart.totalPayable, totalDiscount: cart.totalDiscount }
    const wasResubmit = !!resubmitOrderId
    try {
      const order = wasResubmit
        ? await resubmitOrder(resubmitOrderId, cart.items, totals, extraData, paymentMethod, chequeDetails, remarks, deliveryAddress)
        : await placeOrder(
            cart.items,
            totals,
            { placedBy: user ? { id: user.id, name: user.name, usertype: user.usertype, divisionCode: user.divisionCode } : null, orderingFor },
            extraData,
            paymentMethod,
            chequeDetails,
            remarks,
            deliveryAddress,
            orderEntityId,
          )
      cart.clearCart()
      if (wasResubmit) clearResubmit()
      setPendingOrderFlow({ order, paymentMethod, wasResubmit })
      setOrderOutcome({
        status: 'success',
        ...buildSuccessOutcome({ entity: 'order', action: wasResubmit ? 'resubmitted' : 'created', identifier: order.orderNumber }),
      })
    } catch (err) {
      setOrderOutcome({
        status: 'error',
        title: "Couldn't place order",
        message: err.message || 'Something went wrong while placing this order.',
      })
    }
  }

  // Runs the post-creation routing (online payment / payment link / navigate) only
  // after the user dismisses the success modal, so they get to read the order number first.
  const handleOutcomeClose = async () => {
    setOrderOutcome(null)
    if (!pendingOrderFlow) return
    const { order, paymentMethod, wasResubmit } = pendingOrderFlow
    setPendingOrderFlow(null)

    if (paymentMethod === 'online') {
      try {
        const result = await ccavenueApi.initiate(order.id)
        if (result.mockMode) {
          navigate(`/payment/mock?orderId=${encodeURIComponent(result.orderId)}&amount=${encodeURIComponent(result.amount)}`)
        } else {
          submitCcavenueForm({ actionUrl: result.actionUrl, fields: result.fields })
        }
      } catch {
        navigate('/products')
      }
      return
    }

    if (paymentMethod === 'payment-link') {
      try {
        const result = await ccavenueApi.createLink(order.id)
        setGeneratedLink(result)
      } catch {
        navigate('/products')
      }
      return
    }

    navigate(wasResubmit ? '/dashboard' : '/products')
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

  const handleDismissLink = () => {
    setGeneratedLink(null)
    navigate('/products')
  }

  return (
    <section className="cart-page">
      {orderingFor && (
        <div className="cart-page__ordering-banner">
          <div className="cart-page__ordering-info">
            <span className="cart-page__ordering-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="cart-page__ordering-label">Ordering for</span>
            <strong className="cart-page__ordering-name">{orderingFor.name}</strong>
            <span className="cart-page__ordering-type">{orderingFor.type}</span>
          </div>
          {/* !resubmitOrderId && (
            <button
              type="button"
              className="cart-page__ordering-change"
              onClick={() => { clearCustomer(); navigate('/dashboard') }}
            >
              Change customer
            </button>
          ) */}
        </div>
      )}

      {resubmitOrderId && (
        <div className="cart-page__resubmit-banner">
          <span className="cart-page__resubmit-text">Editing rejected order <strong>{resubmitOrderNumber ?? resubmitOrderId}</strong></span>
          <button type="button" className="cart-page__resubmit-cancel" onClick={handleCancelResubmit}>
            Cancel edit
          </button>
        </div>
      )}

      <header className="cart-page__header">
        <button type="button" className="cart-page__back" onClick={() => navigate('/products')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to catalogue
        </button>
        <div className="cart-page__heading">
          <p className="cart-page__eyebrow">Order summary</p>
          <h1 className="cart-page__title">Your cart</h1>
        </div>
      </header>

      {cart.items.length === 0 ? (
        <div className="cart-page__empty">
          <p className="cart-page__empty-title">Your cart is empty</p>
          <p className="cart-page__empty-hint">Add products from the catalogue to see them listed here.</p>
          <button type="button" className="cart-page__empty-cta" onClick={() => navigate('/products')}>
            Browse products
          </button>
        </div>
      ) : (
        <div className="cart-page__layout">
          <CartSummary
            items={cart.items}
            totalUnits={cart.totalUnits}
            totalPayable={cart.totalPayable}
            totalDiscount={cart.totalDiscount}
            onRemove={cart.removeItem}
            onUpdateQuantity={cart.updateQuantity}
            onClearCart={cart.clearCart}
            onPlaceOrder={handlePlaceOrder}
          />
        </div>
      )}

      {generatedLink && (
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
              <button type="button" className="cart-panel__place-order" onClick={handleDismissLink}>
                Done
              </button>
            </footer>
          </div>
        </>
      )}

      {orderOutcome && (
        <OutcomeModal
          status={orderOutcome.status}
          title={orderOutcome.title}
          message={orderOutcome.message}
          onClose={handleOutcomeClose}
        />
      )}
    </section>
  )
}

export default CartPage
