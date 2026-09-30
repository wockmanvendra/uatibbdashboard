import { renderLayout, renderButton, renderDetailsTable, formatDateTime, formatLabel, buildReviewUrl } from './layout.js'

export function customerRejectedTemplate({ customerId, customerCode, customerName, customerType, rejectedBy, rejectedDate, reason }) {
  const subject = `Customer ${customerCode} Rejected`
  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">This customer registration has been rejected. Please review the reason below — you're welcome to correct the details and resubmit it for approval.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Customer Details</h2>
    ${renderDetailsTable([
      ['Customer Code', customerCode],
      ['Customer Name', customerName],
      ['Customer Type', formatLabel(customerType)],
      ['Rejected By', rejectedBy],
      ['Rejected Date', formatDateTime(rejectedDate)],
      ['Reason', reason || '—'],
    ])}
    ${renderButton('View Customer', buildReviewUrl({ type: 'customer', id: customerId }))}
    <p style="margin:16px 0 0; color:#6b7280; font-size:12px;">You'll need to log in to Wockhardt Online first — the button above will take you straight to this customer once you do.</p>
  `
  return { subject, html: renderLayout({ title: subject, bodyHtml }) }
}
