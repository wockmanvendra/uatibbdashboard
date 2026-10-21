/**
 * BU head sign-in: mobile number and password, as the D2D portal's staff login
 * (its /admin page). At first sign-in, and when the password is 90 days old,
 * the user must choose a new one before the dashboard opens. "Forgot password"
 * sends a code by email; the code buys the same password change.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ApiRequestError, changePassword, loginWithPassword, requestPasswordReset, verifyPasswordReset,
} from '../lib/api';
import type { LoginResponse } from '../types/api';
import { useAuthStore } from './authStore';
import { OtpInput } from './OtpInput';
import { BrandPanel } from './LoginPage';
import { Spinner } from '../components/ui/States';

const MOBILE_RE = /^[6-9]\d{9}$/;
const OTP_LENGTH = 6;
const EMPTY_OTP: string[] = Array(OTP_LENGTH).fill('');

/** The API's rule (D2D portal's): checked here only to guide; the API decides. */
const RULES = [
  { label: 'At least 8 characters', ok: (p: string) => p.length >= 8 },
  { label: 'An uppercase letter', ok: (p: string) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', ok: (p: string) => /[a-z]/.test(p) },
  { label: 'A number', ok: (p: string) => /[0-9]/.test(p) },
  { label: 'A special character (e.g. @#$%)', ok: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

type Step =
  | { name: 'login' }
  /** Must set a new password; `why` explains whether it is first sign-in or a reset. */
  | { name: 'change'; changeToken: string; why: 'required' | 'reset' }
  | { name: 'forgot' }
  | { name: 'code'; sentTo: string; devOtp: string | null };

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

export function BuHeadLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useAuthStore((s) => s.signIn);

  const [step, setStep] = useState<Step>({ name: 'login' });
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState<string[]>(EMPTY_OTP);
  const [show, setShow] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstField = useRef<HTMLInputElement>(null);
  const otpGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (step.name === 'code') otpGroup.current?.querySelector('input')?.focus();
    else firstField.current?.focus();
  }, [step.name]);

  const go = (next: Step) => {
    setStep(next);
    setError('');
    setShow(false);
  };

  const finish = (session: LoginResponse) => {
    signIn(session);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? '/', { replace: true });
  };

  const run = async (work: () => Promise<void>, fallback: string) => {
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = () => {
    if (!MOBILE_RE.test(mobile)) return setError('Enter a valid 10-digit mobile number.');
    if (!password) return setError('Enter your password.');
    void run(async () => {
      const res = await loginWithPassword(mobile, password);
      if ('mustChangePassword' in res) {
        setPassword('');
        go({ name: 'change', changeToken: res.changeToken, why: 'required' });
      } else {
        finish(res);
      }
    }, 'Sign-in failed. Try again.');
  };

  const submitChange = (changeToken: string) => {
    const unmet = RULES.find((r) => !r.ok(newPassword));
    if (unmet) return setError(`The new password needs: ${unmet.label.toLowerCase()}.`);
    if (newPassword !== confirm) return setError('The two passwords do not match.');
    void run(async () => finish(await changePassword(changeToken, newPassword)), 'Could not set the password. Try again.');
  };

  const sendCode = () => {
    if (!MOBILE_RE.test(mobile)) return setError('Enter a valid 10-digit mobile number.');
    void run(async () => {
      const res = await requestPasswordReset(mobile);
      setOtp(EMPTY_OTP);
      setCountdown(res.resendInSeconds);
      go({ name: 'code', sentTo: res.sentTo, devOtp: res.devOtp ?? null });
    }, 'Could not send the code. Try again.');
  };

  const verifyCode = () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) return setError(`Enter all ${OTP_LENGTH} digits of the code.`);
    void run(async () => {
      const { changeToken } = await verifyPasswordReset(mobile, code);
      setNewPassword('');
      setConfirm('');
      go({ name: 'change', changeToken, why: 'reset' });
    }, 'Could not check the code. Try again.');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step.name === 'login') submitLogin();
    else if (step.name === 'change') submitChange(step.changeToken);
    else if (step.name === 'forgot') sendCode();
    else verifyCode();
  };

  const title = { login: 'BU head sign in', change: 'Set a new password', forgot: 'Forgot password', code: 'Enter the code' }[step.name];
  const intro = {
    login: 'Use the mobile number and password of your BU head account.',
    change:
      step.name === 'change' && step.why === 'reset'
        ? 'Choose a new password for your account.'
        : 'Your password must be changed before you continue. Choose a strong one — it expires after 90 days.',
    forgot: 'We will send a 6-digit code to the email on your account.',
    code: step.name === 'code' ? `We sent a 6-digit code to ${step.sentTo}.` : '',
  }[step.name];

  const button = (label: string, busyLabel: string) => (
    <button type="submit" disabled={busy} className="login-primary-btn">
      {busy ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner size={16} />
          {busyLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );

  const passwordField = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    autoComplete: string,
    ref?: React.Ref<HTMLInputElement>,
  ) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="login-label">{label}</label>
        <button type="button" className="login-link" onClick={() => setShow((s) => !s)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="login-mobile-row">
        <input
          ref={ref}
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => {
            set(e.target.value);
            setError('');
          }}
          className="login-mobile-input"
        />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <BrandPanel />

      <main className="login-form-panel flex flex-1 items-start justify-center px-4 py-7 md:items-center md:px-12 md:py-14">
        <div className="login-card rise-in w-full max-w-[25rem]">
          <header className="mb-6">
            <p className="login-eyebrow text-[var(--series-disp)]">Secure access</p>
            <h2 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{intro}</p>
          </header>

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {(step.name === 'login' || step.name === 'forgot') && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bu-mobile" className="login-label">Mobile number</label>
                <div className="login-mobile-row">
                  <span className="login-mobile-prefix" aria-hidden="true">+91</span>
                  <input
                    ref={firstField}
                    id="bu-mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    placeholder="98XXXXXXXX"
                    value={mobile}
                    onChange={(e) => {
                      setMobile(e.target.value.replace(/\D/g, ''));
                      setError('');
                    }}
                    className="login-mobile-input"
                  />
                </div>
              </div>
            )}

            {step.name === 'login' && (
              <>
                {passwordField('bu-password', 'Password', password, setPassword, 'current-password')}
                <button type="button" className="login-link self-start" onClick={() => go({ name: 'forgot' })}>
                  Forgot password?
                </button>
              </>
            )}

            {step.name === 'change' && (
              <>
                {passwordField('bu-new-password', 'New password', newPassword, setNewPassword, 'new-password', firstField)}
                <ul className="-mt-2 flex flex-col gap-0.5 text-[12px]" aria-label="Password rules">
                  {RULES.map((r) => {
                    const met = r.ok(newPassword);
                    return (
                      <li key={r.label} className={met ? 'text-[var(--good)]' : 'text-ink-3'}>
                        {met ? '✓' : '○'} {r.label}
                      </li>
                    );
                  })}
                </ul>
                {passwordField('bu-confirm', 'Confirm new password', confirm, setConfirm, 'new-password')}
              </>
            )}

            {step.name === 'code' && (
              <div className="flex flex-col gap-3">
                {step.devOtp && (
                  <div className="login-dev-banner" role="status">
                    <span className="login-dev-tag">Test</span>
                    <span className="flex-1 text-[12px] leading-snug">
                      Testing mode — your code is{' '}
                      <strong className="font-mono text-[14px] tracking-[0.2em]">{step.devOtp}</strong>
                    </span>
                    <button type="button" className="login-link" onClick={() => setOtp(step.devOtp!.split(''))}>
                      Fill
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-1.5" ref={otpGroup}>
                  <span id="bu-code-label" className="login-label">Code</span>
                  <OtpInput
                    value={otp}
                    onChange={(next) => {
                      setOtp(next);
                      setError('');
                    }}
                    labelledBy="bu-code-label"
                    disabled={busy}
                  />
                </div>
                <div className="flex justify-end text-[12px] text-ink-3" aria-live="polite">
                  {countdown > 0 ? (
                    <span className="tnum font-mono">Resend in {countdown}s</span>
                  ) : (
                    <button type="button" className="login-link" onClick={sendCode} disabled={busy}>
                      Resend code
                    </button>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}

            {step.name === 'login' && button('Sign in', 'Signing in…')}
            {step.name === 'change' && button('Set password & open dashboard', 'Saving…')}
            {step.name === 'forgot' && button('Send code', 'Sending…')}
            {step.name === 'code' && button('Verify code', 'Verifying…')}
          </form>

          <p className="mt-6 border-t border-rule-soft pt-4 text-[12px] leading-relaxed text-ink-3">
            {step.name === 'login' ? (
              <>
                Field force?{' '}
                <Link to="/login" state={location.state} className="login-link">
                  Sign in with an OTP
                </Link>
              </>
            ) : (
              <button type="button" className="login-link" onClick={() => go({ name: 'login' })}>
                ← Back to sign in
              </button>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
