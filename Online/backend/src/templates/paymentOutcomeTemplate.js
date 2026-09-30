import { renderLayout, renderButton, renderDetailsTable, formatCurrency, formatLabel, buildReviewUrl } from './layout.js'

const STATUS_COPY = {
  Success: 'has been received successfully',
  Failure: 'could not be completed',
  Aborted: 'was cancelled before completion',
}

export function paymentOutcomeTemplate({ orderId, orderNumber, customerId, customerCode, customerName, amount, paymentMethod, status, failureMessage }) {
  const subject = orderNumber
    ? `Payment ${status} — Order ${orderNumber}`
    : `Payment ${status} — Customer ${customerCode} (${customerName})`

  const reviewUrl = orderNumber
    ? buildReviewUrl({ type: 'order', id: orderId })
    : buildReviewUrl({ type: 'customer', id: customerId })

  const rows = orderNumber
    ? [['Order Number', orderNumber], ['Customer Name', customerName]]
    : [['Customer Code', customerCode], ['Customer Name', customerName]]
  rows.push(['Amount', formatCurrency(amount)])
  if (paymentMethod) rows.push(['Payment Method', formatLabel(paymentMethod)])
  rows.push(['Status', status])
  if (status !== 'Success' && failureMessage) rows.push(['Reason', failureMessage])

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Hello, the payment of ${formatCurrency(amount)} ${STATUS_COPY[status] ?? `is now marked as ${status}`}.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Payment Details</h2>
    ${renderDetailsTable(rows)}
    ${renderButton('View Details', reviewUrl)}
    <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">You'll need to log in to Wockhardt Online first — the button above will take you straight there once you do.</p>
  `
  return { subject, html: renderLayout({ title: subject, bodyHtml }) }
}
