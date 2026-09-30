import { renderLayout, renderButton, renderDetailsTable, formatDateTime, formatCurrency, formatLabel, buildReviewUrl } from './layout.js'

export function orderApprovedTemplate({
  orderId, orderNumber, customerName, orderAmount, approvedBy, approvedDate,
  paymentMethod, paymentStatus, totalDiscount, paymentReceivedDate, paymentReceivedAmount,
}) {
  const subject = `Order ${orderNumber} Approved`

  const paymentRows = [
    ['Payment Method', formatLabel(paymentMethod)],
    ['Payment Status', paymentStatus],
    ['Amount Payable', formatCurrency(orderAmount)],
  ]
  if (totalDiscount) paymentRows.push(['Discount', formatCurrency(totalDiscount)])
  if (paymentReceivedDate) paymentRows.push(['Payment Received Date', formatDateTime(paymentReceivedDate)])
  if (paymentReceivedAmount) paymentRows.push(['Payment Received Amount', formatCurrency(paymentReceivedAmount)])

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Good news — this order has been approved.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Order Details</h2>
    ${renderDetailsTable([
      ['Order Number', orderNumber],
      ['Customer Name', customerName],
      ['Order Amount', formatCurrency(orderAmount)],
      ['Approved By', approvedBy],
      ['Approved Date', formatDateTime(approvedDate)],
    ])}
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Payment Details</h2>
    ${renderDetailsTable(paymentRows)}
    ${renderButton('View Order', buildReviewUrl({ type: 'order', id: orderId }))}
    <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">You'll need to log in to Wockhardt Online first — the button above will take you straight to this order once you do.</p>
  `
  return { subject, html: renderLayout({ title: subject, bodyHtml }) }
}
