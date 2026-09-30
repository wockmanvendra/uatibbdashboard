/**
 * Sends a one-time password by SMS and by email, whichever are configured —
 * the same two channels, and the same SMS gateway protocol, as the D2D portal.
 */
import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';

export interface Recipient {
  name: string;
  mobileno: string;
  email: string | null;
}

export interface DeliveryResult {
  /** Channels that were configured and had an address to send to. */
  attempted: number;
  sent: number;
}

const smsConfigured = () =>
  !!(config.SMS_URL && config.SMS_USERNAME && config.SMS_FROM && config.SMS_TEMPLATE_ID && config.SMS_OTP_TEXT);
const emailConfigured = () => !!(config.SMTP_HOST && config.EMAIL_FROM);

export const anyChannelConfigured = () => smsConfigured() || emailConfigured();

async function sendSms(to: string, otp: string): Promise<void> {
  const url = new URL(config.SMS_URL!);
  url.searchParams.set('username', config.SMS_USERNAME!);
  url.searchParams.set('password', config.SMS_PASSWORD ?? '');
  url.searchParams.set('from', config.SMS_FROM!);
  url.searchParams.set('to', to);
  url.searchParams.set('msg', config.SMS_OTP_TEXT!.replaceAll('{otp}', otp));
  url.searchParams.set('type', '1'); // plain text
  url.searchParams.set('template_id', config.SMS_TEMPLATE_ID!);

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`SMS gateway answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

let transporter: nodemailer.Transporter | null = null;

function mailer(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
    // For an internal relay with a self-signed certificate, as the D2D portal's is.
    tls: config.SMTP_INSECURE_TLS ? { rejectUnauthorized: false } : undefined,
  });
  return transporter;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function sendEmail(to: string, name: string, otp: string): Promise<void> {
  const minutes = config.OTP_EXPIRY_MINUTES;
  await mailer().sendMail({
    from: config.EMAIL_FROM,
    to,
    subject: 'Division Performance — your sign-in code',
    text: `Dear ${name},\n\nYour one-time password is ${otp}. It is valid for ${minutes} minutes.\n\nIf you did not request it, ignore this email.`,
    html: `<p>Dear ${escapeHtml(name)},</p>
<p>Your one-time password for the Division Performance dashboard is:</p>
<p style="font-family:monospace;font-size:26px;font-weight:700;letter-spacing:0.3em">${otp}</p>
<p>It is valid for <strong>${minutes} minutes</strong>. If you did not request it, ignore this email.</p>`,
  });
}

const mask = (mobile: string) => `${'•'.repeat(6)}${mobile.slice(-4)}`;

/** Never throws; reports what went out. The code itself is never logged. */
export async function deliverOtp(
  to: Recipient,
  otp: string,
  log: FastifyBaseLogger,
): Promise<DeliveryResult> {
  const jobs: { channel: string; run: Promise<void> }[] = [];
  if (smsConfigured()) jobs.push({ channel: 'sms', run: sendSms(to.mobileno, otp) });
  if (emailConfigured() && to.email) jobs.push({ channel: 'email', run: sendEmail(to.email, to.name, otp) });

  const settled = await Promise.allSettled(jobs.map((j) => j.run));
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      log.error({ err: s.reason, channel: jobs[i]!.channel, mobile: mask(to.mobileno) }, 'otp delivery failed');
    }
  });
  return { attempted: jobs.length, sent: settled.filter((s) => s.status === 'fulfilled').length };
}
