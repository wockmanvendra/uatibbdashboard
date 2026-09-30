import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ordersApi } from '../lib/api.js'
import { formatCurrency } from '../utils/currency.js'
import './PaymentResultPage.css'

function PaymentResultPage() {
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('orderId')
  const type = searchParams.get('type')
  const status = searchParams.get('status')
  const isSuccess = status === 'success'
  const [order, setOrder] = useState(null)
  const [fetchFailed, setFetchFailed] = useState(false)

  // orders.id and customers.id are both opaque UUIDs of identical shape — a
  // customer-outstanding payment lands here with the customer's id instead of
  // an order's, which ordersApi.get would 404 on, so gate on the explicit
  // `type` param instead of sniffing the id's shape.
  useEffect(() => {
    if (!orderId || type !== 'order') return
    ordersApi.get(orderId)
      .then(setOrder)
      .catch(() => setFetchFailed(true))
  }, [orderId, type])

  const ccavenue = order?.extraData?.ccavenue

  return (
    <div className={`payresult payresult--${isSuccess ? 'success' : 'failure'}`}>
      <div className="payresult__card">
        <span className={`payresult__icon payresult__icon--${isSuccess ? 'success' : 'failure'}`} aria-hidden="true">
          {isSuccess ? '✓' : '×'}
        </span>

        <p className="payresult__eyebrow">{isSuccess ? 'Payment successful' : 'Payment failed'}</p>
        <h1 className="payresult__title">
          {isSuccess ? 'Thank you — your payment went through' : 'We couldn’t complete this payment'}
        </h1>

        {orderId && <p className="payresult__order">Order {orderId}</p>}

        {order && (
          <div className="payresult__details">
            <div className="payresult__detail-row">
              <span>Amount</span>
              <span>{formatCurrency(order.totalPayable)}</span>
            </div>
            {ccavenue?.trackingId && (
              <div className="payresult__detail-row">
                <span>Reference</span>
                <span>{ccavenue.trackingId}</span>
              </div>
            )}
            {ccavenue?.paymentMode && (
              <div className="payresult__detail-row">
                <span>Mode</span>
                <span>{ccavenue.paymentMode}</span>
              </div>
            )}
            {!isSuccess && ccavenue?.failureMessage && (
              <p className="payresult__failure-message">{ccavenue.failureMessage}</p>
            )}
          </div>
        )}

        {fetchFailed && (
          <p className="payresult__fallback">
            Payment recorded — log in and check Dashboard &rarr; Orders to view the receipt.
          </p>
        )}

        <a className="payresult__link" href={fetchFailed ? '/login' : '/dashboard'}>
          {fetchFailed ? 'Go to login' : 'Back to dashboard'}
        </a>
      </div>
    </div>
  )
}

export default PaymentResultPage
