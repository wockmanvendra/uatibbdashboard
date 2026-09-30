import { FRONTEND_BASE_URL } from '../config/mailConfig.js'

export const DASHBOARD_URL = `${FRONTEND_BASE_URL}/dashboard`

// Deep link that opens a specific order/customer in the approver's dashboard for review
export function buildReviewUrl({ type, id }) {
  return `${DASHBOARD_URL}?review=${type}&id=${encodeURIComponent(id)}`
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatCurrency(amount) {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)
}

export function formatLabel(value) {
  if (!value) return '—'
  return value
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function renderDetailsTable(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding: 6px 16px 6px 0; color: #6b7280; font-size: 13px; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; vertical-align: top;">${label}</td>
          <td style="padding: 6px 0; color: #1a1d21; font-size: 14px; font-weight: 600;">${value}</td>
        </tr>
      `).join('')}
    </table>
  `
}

export function renderButton(text, url) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td style="border-radius: 6px; background-color: #4f7585;">
          <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 28px; color: #ffffff; font-family: 'IBM Plex Sans', Arial, sans-serif; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px;">${text}</a>
        </td>
      </tr>
    </table>
  `
}

export function renderLayout({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f2ece0; font-family:'IBM Plex Sans', Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2ece0; padding: 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width: 560px; background-color:#ffffff; border-radius: 8px; overflow:hidden; border: 1px solid #e6ddcd;">
            <tr>
              <td style="background-color:#177e63; padding: 20px 32px;">
                <span style="color:#f2ece0; font-size: 20px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace;">Wockhardt Online</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px;">
                <h1 style="margin:0 0 16px; font-size: 20px; color:#1a1d21;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background-color:#f2ece0; padding: 16px 32px; border-top: 1px solid #e6ddcd;">
                <p style="margin:0; font-size: 12px; color:#6b7280;">This is an automated message from Wockhardt Online. Please do not reply to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
