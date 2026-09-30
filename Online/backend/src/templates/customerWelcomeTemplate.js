import { renderLayout, renderDetailsTable } from './layout.js'

const CONTACT_LABELS = {
  tm:  'Territory Manager',
  rm:  'Regional Manager',
  zsm: 'Zonal Sales Manager',
  nsm: 'National Sales Manager',
}

function formatAddress({ customerAddress, customerCity, customerState, customerPinCode }) {
  return [customerAddress, customerCity, customerState, customerPinCode].filter(Boolean).join(', ') || '—'
}

// One row per TM/RM/ZSM/NSM that actually has a mobile number on file —
// a level with no assigned person (or no mobile synced) is silently
// skipped rather than shown as "—", since there's no one to contact there.
function buildContactRows(data) {
  return Object.entries(CONTACT_LABELS)
    .map(([role, label]) => {
      const mobile = data[`${role}Mobile`]
      if (!mobile) return null
      const name = data[`${role}Name`]
      return [name ? `${label} (${name})` : label, mobile]
    })
    .filter(Boolean)
}

export function customerWelcomeTemplate(data) {
  const { customerName, customerEmail, customerMobile } = data
  const subject = `Welcome to Wockhardt Online, ${customerName}!`
  const contactRows = buildContactRows(data)

  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Dear ${customerName},</p>
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Welcome to Wockhardt Online! We're pleased to let you know that your registration has been approved and your account is now active.</p>
    <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Your Details</h2>
    ${renderDetailsTable([
      ['Name', customerName],
      ['Address', formatAddress(data)],
      ['Email', customerEmail],
      ['Mobile', customerMobile],
    ])}
    ${contactRows.length ? `
      <h2 style="margin: 24px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:#4f7585;">Need Help? Contact Us</h2>
      <p style="margin:0 0 8px; color:#1a1d21; font-size:14px;">Feel free to reach out to your Wockhardt representatives any time:</p>
      ${renderDetailsTable(contactRows)}
    ` : ''}
    <p style="margin:16px 0 0; color:#1a1d21; font-size:14px;">Thank you for choosing Wockhardt Online — we look forward to serving you.</p>
  `
  return { subject, html: renderLayout({ title: 'Welcome to Wockhardt Online', bodyHtml }) }
}
