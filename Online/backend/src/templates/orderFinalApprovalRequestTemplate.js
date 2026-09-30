import { renderLayout, renderButton, renderDetailsTable, formatDateTime, formatCurrency, buildReviewUrl } from './layout.js'

export function orderFinalApprovalRequestTemplate({ orderId, orderNumber, customerName, orderAmount, step1ApprovedBy, step1ApprovedDate }) {
  const subject = `Final Approval Needed — Order ${orderNumber}`
  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Hello, this order has cleared the first review and now needs your final approval. Please review the details below at your earliest convenience.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Order Details</h2>
    ${renderDetailsTable([
      ['Order Number', orderNumber],
      ['Customer Name', customerName],
      ['Order Amount', formatCurrency(orderAmount)],
      ['First Approved By', step1ApprovedBy],
      ['First Approved Date', formatDateTime(step1ApprovedDate)],
    ])}
    ${renderButton('Review & Approve', buildReviewUrl({ type: 'order', id: orderId }))}
    <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">You'll need to log in to Wockhardt Online first — the button above will take you straight to this order once you do.</p>
  `
  return { subject, html: renderLayout({ title: subject, bodyHtml }) }
}
