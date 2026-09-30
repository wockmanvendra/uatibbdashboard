import nodemailer from 'nodemailer'
import { transporter, EMAIL_FROM } from '../config/mailConfig.js'
import { otpTemplate } from '../templates/otpTemplate.js'
import { customerApprovalRequestTemplate } from '../templates/customerApprovalRequestTemplate.js'
import { customerApprovedTemplate } from '../templates/customerApprovedTemplate.js'
import { orderApprovalRequestTemplate } from '../templates/orderApprovalRequestTemplate.js'
import { orderApprovedTemplate } from '../templates/orderApprovedTemplate.js'
import { customerRejectedTemplate } from '../templates/customerRejectedTemplate.js'
import { orderRejectedTemplate } from '../templates/orderRejectedTemplate.js'
import { customerFinalApprovalRequestTemplate } from '../templates/customerFinalApprovalRequestTemplate.js'
import { orderFinalApprovalRequestTemplate } from '../templates/orderFinalApprovalRequestTemplate.js'
import { paymentOutcomeTemplate } from '../templates/paymentOutcomeTemplate.js'
import { customerWelcomeTemplate } from '../templates/customerWelcomeTemplate.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanAddresses(addresses) {
  const list = Array.isArray(addresses) ? addresses : [addresses]
  return [...new Set(list.filter(addr => addr && EMAIL_RE.test(addr)))]
}

async function dispatch({ to, cc, subject, html }) {
  if (process.env.SEND_EMAIL === 'false') {
    console.warn(`[email] skipped "${subject}" — SEND_EMAIL=false`)
    return { success: false, reason: 'disabled' }
  }

  const toList = cleanAddresses(to)
  const ccList = cleanAddresses(cc)

  if (!toList.length) {
    console.warn(`[email] skipped "${subject}" — no valid recipients`)
    return { success: false, reason: 'no valid recipients' }
  }

  try {
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      subject,
      html,
    })
    console.log(`[email] sent "${subject}" to ${toList.join(', ')}${ccList.length ? ` (cc: ${ccList.join(', ')})` : ''}`)
    const previewUrl = nodemailer.getTestMessageUrl(info)
    if (previewUrl) console.log(`[email] preview: ${previewUrl}`)
    return { success: true, info }
  } catch (err) {
    console.error(`[email] failed "${subject}":`, err.message)
    return { success: false, error: err.message }
  }
}

export async function sendOTPEmail({ to, name, otp, expiryMinutes }) {
  const { subject, html } = otpTemplate({ name, otp, expiryMinutes })
  return dispatch({ to, subject, html })
}

export async function sendCustomerApprovalRequestEmail({ to, cc, ...data }) {
  const { subject, html } = customerApprovalRequestTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendCustomerApprovedEmail({ to, cc, ...data }) {
  const { subject, html } = customerApprovedTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendOrderApprovalRequestEmail({ to, cc, ...data }) {
  const { subject, html } = orderApprovalRequestTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendOrderApprovedEmail({ to, cc, ...data }) {
  const { subject, html } = orderApprovedTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendCustomerRejectedEmail({ to, cc, ...data }) {
  const { subject, html } = customerRejectedTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendOrderRejectedEmail({ to, cc, ...data }) {
  const { subject, html } = orderRejectedTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendCustomerFinalApprovalRequestEmail({ to, cc, ...data }) {
  const { subject, html } = customerFinalApprovalRequestTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendOrderFinalApprovalRequestEmail({ to, cc, ...data }) {
  const { subject, html } = orderFinalApprovalRequestTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendPaymentOutcomeEmail({ to, cc, ...data }) {
  const { subject, html } = paymentOutcomeTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendCustomerWelcomeEmail({ to, cc, ...data }) {
  const { subject, html } = customerWelcomeTemplate(data)
  return dispatch({ to, cc, subject, html })
}

export async function sendTestEmail({ to, sentBy }) {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  const subject = 'D2D Portal — Email Configuration Test'
  const html = `
    <p style="font-family: sans-serif; font-size: 14px; line-height: 1.7;">
      This is a <strong>test email</strong> sent from the D2D Portal admin dashboard.<br>
      <strong>Sent by:</strong> ${sentBy || 'Admin'}<br>
      <strong>Sent at:</strong> ${now} IST<br><br>
      If you can read this, the email configuration is working correctly.
    </p>`
  const result = await dispatch({ to, subject, html })
  const previewUrl = result.info ? nodemailer.getTestMessageUrl(result.info) : null
  return { ...result, previewUrl: previewUrl || null }
}
