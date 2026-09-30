import { SMS_URL, SMS_USERNAME, SMS_PWD, SMS_FROM, SMS_ENABLED } from '../config/smsConfig.js'

// ── Template IDs (DLT-registered) ────────────────────────────────────────────
// Add one key per SMS event. Sourced from env so they can be changed without a
// code deploy (DLT re-registration gives a new ID without changing the text).
const TEMPLATES = {
  OTP: process.env.SMS_TEMPLATE_OTP || '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Replace {key} placeholders in a DLT template string with runtime values.
// e.g. fillTemplate('OTP is {otp}.', { otp: '123456' }) → 'OTP is 123456.'
export function fillTemplate(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}

// Strip country code prefix and leading zero; validate 10-digit Indian mobile.
function normalizeMobile(mobile) {
  const stripped = String(mobile).replace(/^\+?91/, '').replace(/^0/, '').trim()
  return /^\d{10}$/.test(stripped) ? stripped : null
}

// ── Private sender ────────────────────────────────────────────────────────────

async function dispatch({ mobile, templateId, text }) {
  if (process.env.SEND_SMS === 'false') {
    console.warn('[sms] skipped — SEND_SMS=false')
    return { success: false, reason: 'disabled' }
  }

  if (!SMS_ENABLED) {
    console.warn('[sms] SMS not configured (SMS_URL / SMS_USERNAME / SMS_FROM missing) — skipping.')
    return { success: false, reason: 'not-configured' }
  }

  const normalizedMobile = normalizeMobile(mobile)
  if (!normalizedMobile) {
    console.warn('[sms] Invalid mobile number:', mobile)
    return { success: false, reason: 'invalid-mobile' }
  }

  try {
    const url = new URL(SMS_URL)
    url.searchParams.set('username',    SMS_USERNAME)
    url.searchParams.set('password',    SMS_PWD)
    url.searchParams.set('from',        SMS_FROM)
    url.searchParams.set('to',          normalizedMobile)
    url.searchParams.set('msg',         text)
    url.searchParams.set('type',        '1')   // 1 = plain text, 2 = Unicode
    url.searchParams.set('template_id', templateId)

    const res  = await fetch(url.toString(), { method: 'GET' })
    const body = await res.text()

    if (!res.ok) {
      console.error('[sms] Gateway error:', res.status, body)
      return { success: false, error: body }
    }

    console.log(`[sms] Sent to ${normalizedMobile} | template: ${templateId} | response: ${body}`)
    return { success: true, response: body }
  } catch (err) {
    console.error('[sms] dispatch error:', err)
    return { success: false, error: err.message }
  }
}

// ── Named event functions ─────────────────────────────────────────────────────
// One export per SMS event. Each function:
//   1. Builds the final text via fillTemplate (text must match the DLT template)
//   2. Delegates to dispatch — never throws, returns { success, ... }
//
// To add a new event:
//   1. Add its DLT template ID to TEMPLATES above
//   2. Add SMS_TEMPLATE_<NAME>=<id> to .env files
//   3. Export a new function here following the same pattern

export async function sendOtpSms_sample({ mobile, otp, expiryMinutes = 10 }) {
  const text = fillTemplate(
    'Your OTP is {otp}. It is valid for {expiryMinutes} minutes. Do not share this with anyone.',
    { otp, expiryMinutes }
  )
  return dispatch({ mobile, templateId: TEMPLATES.OTP, text })
}

export async function sendOtpSms({ mobile, otp, expiryMinutes = 10 }) {
  const text = fillTemplate(
    'Unique OTP for login to Wockhardtonline Portal is {otp} - A Wockhardt Group Initiative',
    { otp }
  )
  return dispatch({ mobile, templateId: TEMPLATES.OTP, text })
}
