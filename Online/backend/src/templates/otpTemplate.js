import { renderLayout } from './layout.js'

export function otpTemplate({ name, otp, expiryMinutes }) {
  const subject = 'Wockhardt Online - OTP Verification'
  const bodyHtml = `
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Dear ${name || 'User'},</p>
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">Your One-Time Password (OTP) for verification is:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 16px;">
      <tr>
        <td style="background-color:#f2ece0; border: 1px solid #e6ddcd; border-radius: 6px; padding: 14px 28px;">
          <span style="font-family:'IBM Plex Mono', monospace; font-size: 28px; font-weight:700; letter-spacing: 0.3em; color:#4f7585;">${otp}</span>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px; color:#1a1d21; font-size:14px;">This OTP is valid for <strong>${expiryMinutes} minutes</strong>.</p>
    <p style="margin:0; color:#6b7280; font-size:13px;">If you did not request this OTP, please ignore this email.</p>
  `
  return { subject, html: renderLayout({ title: 'OTP Verification', bodyHtml }) }
}
