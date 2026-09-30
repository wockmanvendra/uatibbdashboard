import nodemailer from 'nodemailer'

const isProd = process.env.NODE_ENV === 'production'

export const EMAIL_FROM         = process.env.EMAIL_FROM         || 'noreply@example.com'
export const FRONTEND_BASE_URL  = process.env.FRONTEND_BASE_URL  || 'http://localhost:5173'
export const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 10

function createTransporter() {
  // if (isProd) {
  if (1===1) {
    if (!process.env.SMTP_HOST) {
      throw new Error('[mail] SMTP_HOST is required when NODE_ENV=production')
    }
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      tls: {
        rejectUnauthorized: false,
      },
    })
  }

  console.info('[mail] NODE_ENV is not "production" — using jsonTransport (emails logged, not sent)')
  return nodemailer.createTransport({ jsonTransport: true })
}

export const transporter = createTransporter()
