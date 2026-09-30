import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ccavenueApi } from '../lib/api.js'
import { formatCurrency } from '../utils/currency.js'
import './PaymentMockPage.css'

function PaymentMockPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('orderId')
  const amount = searchParams.get('amount')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const simulate = async (status) => {
    setError('')
    setSubmitting(true)
    try {
      const result = await ccavenueApi.mockCallback(orderId, status)
      navigate(`/payment-result?orderId=${encodeURIComponent(result.orderId)}&type=${result.type}&status=${status === 'Success' ? 'success' : 'failure'}`)
    } catch (err) {
      setError(err.message || 'Could not record the simulated payment.')
      setSubmitting(false)
    }
  }

  // orderId carries the "order:<uuid>" / "customer:<uuid>" composite reference
  // (see backend/src/config/ccavenue.js) until the mock-callback round-trip
  // above resolves it — strip the type prefix for display purposes only.
  const displayOrderId = orderId?.includes(':') ? orderId.slice(orderId.indexOf(':') + 1) : orderId

  return (
    <div className="mockpay">
      <div className="mockpay__card">
        <span className="mockpay__badge">Test mode — no real payment will be made</span>

        <p className="mockpay__eyebrow">Simulated payment gateway</p>
        <h1 className="mockpay__amount">{amount != null ? formatCurrency(Number(amount)) : '—'}</h1>
        <p className="mockpay__order">Order {displayOrderId}</p>

        <p className="mockpay__hint">
          Choose an outcome below to continue — this stands in for the real CCAvenue checkout while
          payment gateway credentials aren&rsquo;t configured.
        </p>

        {error && <p className="mockpay__error" role="alert">{error}</p>}

        <div className="mockpay__actions">
          <button
            type="button"
            className="mockpay__btn mockpay__btn--success"
            onClick={() => simulate('Success')}
            disabled={submitting}
          >
            Simulate Success
          </button>
          <button
            type="button"
            className="mockpay__btn mockpay__btn--failure"
            onClick={() => simulate('Failure')}
            disabled={submitting}
          >
            Simulate Failure
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaymentMockPage
