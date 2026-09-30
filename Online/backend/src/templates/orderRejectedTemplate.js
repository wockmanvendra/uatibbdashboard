import { renderLayout, renderButton, renderDetailsTable, formatDateTime, formatCurrency, buildReviewUrl } from './layout.js'

export function orderRejectedTemplate({ orderId, orderNumber, customerName, orderAmount, rejectedBy, rejectedDate, reason }) {
  const subject = `Order ${orderNumber} Rejected`
  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">This order has been rejected. Please review the reason below — you're welcome to correct the details and resubmit it for approval.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Order Details</h2>
    ${renderDetailsTable([
      ['Order Number', orderNumber],
      ['Customer Name', customerName],
      ['Order Amount', formatCurrency(orderAmount)],
      ['Rejected By', rejectedBy],
      ['Rejected Date', formatDateTime(rejectedDate)],
      ['Reason', reason || '—'],
    ])}
    ${renderButton('View Order', buildReviewUrl({ type: 'order', id: orderId }))}
    <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">You'll need to log in to Wockhardt Online first — the button above will take you straight to this order once you do.</p>
  `
  return { subject, html: renderLayout({ title: subject, bodyHtml }) }
}
