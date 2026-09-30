import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ccavenueApi } from '../lib/api.js'
import { submitCcavenueForm } from '../lib/submitCcavenueForm.js'
import { formatCurrency } from '../utils/currency.js'
import './PayLinkPage.css'

function PayLinkPage() {
  const navigate = useNavigate()
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    ccavenueApi.getLink(token)
      .then((result) => {
        if (cancelled) return

        if (result.alreadyPaid) {
          setState({ status: 'already-paid', amount: result.amount })
          return
        }

        if (result.mockMode) {
          navigate(`/payment/mock?orderId=${encodeURIComponent(result.orderId)}&amount=${encodeURIComponent(result.amount)}`)
          return
        }

        setState({ status: 'redirecting' })
        submitCcavenueForm({ actionUrl: result.actionUrl, fields: result.fields })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'invalid', message: err.message })
      })

    return () => { cancelled = true }
  }, [token, navigate])

  return (
    <div className="paylink">
      <div className="paylink__card">
        {state.status === 'loading' && (
          <>
            <p className="paylink__eyebrow">Payment link</p>
            <h1 className="paylink__title">Checking your link&hellip;</h1>
          </>
        )}

        {state.status === 'redirecting' && (
          <>
            <p className="paylink__eyebrow">Payment link</p>
            <h1 className="paylink__title">Redirecting to the payment gateway&hellip;</h1>
            <p className="paylink__hint">Please wait, you&rsquo;ll be taken to a secure page to complete your payment.</p>
          </>
        )}

        {state.status === 'already-paid' && (
          <>
            <span className="paylink__icon paylink__icon--ok" aria-hidden="true">&#10003;</span>
            <h1 className="paylink__title">This order has already been paid</h1>
            <p className="paylink__hint">
              {state.amount != null && `A payment of ${formatCurrency(Number(state.amount))} has already been recorded for this order. `}
              No further action is needed.
            </p>
          </>
        )}

        {state.status === 'invalid' && (
          <>
            <span className="paylink__icon paylink__icon--failure" aria-hidden="true">&times;</span>
            <h1 className="paylink__title">This payment link is invalid or has expired</h1>
            <p className="paylink__hint">Please contact the person who shared this link with you for a new one.</p>
          </>
        )}
      </div>
    </div>
  )
}

export default PayLinkPage
