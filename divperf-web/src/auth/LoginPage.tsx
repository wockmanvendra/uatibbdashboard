/**
 * Sign-in for everyone — field force, BU heads and admins: the mobile number
 * registered in the Central User Service, then the one-time password it emails.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiRequestError, requestOtp, verifyOtp } from '../lib/api';
import { useAuthStore } from './authStore';
import { OtpInput } from './OtpInput';
import { Spinner } from '../components/ui/States';

const OTP_LENGTH = 6;
const EMPTY_OTP: string[] = Array(OTP_LENGTH).fill('');
const MOBILE_RE = /^[6-9]\d{9}$/;

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback;
}

function formatMobile(m: string): string {
  return `+91 ${m.slice(0, 5)} ${m.slice(5)}`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useAuthStore((s) => s.signIn);

  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState<string[]>(EMPTY_OTP);
  const [countdown, setCountdown] = useState(0);
  /** Where the code was emailed, masked — e.g. "r***@wockhardt.com". */
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState('');

  const mobileRef = useRef<HTMLInputElement>(null);
  const otpGroupRef = useRef<HTMLDivElement>(null);
  const focusFirstOtpBox = () => otpGroupRef.current?.querySelector('input')?.focus();

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (step === 'otp') focusFirstOtpBox();
    else mobileRef.current?.focus();
  }, [step]);

  const sendOtp = async () => {
    if (!MOBILE_RE.test(mobile)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setError('');
    setBusy('send');
    try {
      const res = await requestOtp(mobile);
      setSentTo(res.sentTo);
      setOtp(EMPTY_OTP);
      setCountdown(res.resendInSeconds);
      if (step === 'otp') focusFirstOtpBox();
      setStep('otp');
    } catch (err) {
      setError(messageOf(err, 'Could not send the OTP. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    const code = otp.join('');
    if (code.length < OTP_LENGTH) {
      setError(`Enter all ${OTP_LENGTH} digits of the OTP.`);
      return;
    }
    setError('');
    setBusy('verify');
    try {
      signIn(await verifyOtp(mobile, code));
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(messageOf(err, 'Sign-in failed. Try again.'));
      setOtp(EMPTY_OTP);
      // An expired code, or one burned by wrong guesses: offer a new one straight away.
      if (err instanceof ApiRequestError && (err.status === 429 || /expired/i.test(err.message))) {
        setCountdown(0);
      }
      setBusy(null);
      focusFirstOtpBox();
    }
  };

  const changeNumber = () => {
    setStep('mobile');
    setOtp(EMPTY_OTP);
    setSentTo('');
    setCountdown(0);
    setError('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void (step === 'mobile' ? sendOtp() : verify());
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <BrandPanel />

      <main className="login-form-panel flex flex-1 items-start justify-center px-4 py-7 md:items-center md:px-12 md:py-14">
        <div className="login-card rise-in w-full max-w-[25rem]">
          <header className="mb-6">
            <p className="login-eyebrow text-[var(--series-disp)]">Secure access</p>
            <h2 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              Sign in
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {step === 'mobile'
                ? 'Use the mobile number registered for you in the Wockhardt user service.'
                : 'We emailed you a 6-digit code.'}
            </p>
          </header>

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="login-mobile" className="login-label">
                  Mobile number
                </label>
                {step === 'otp' && (
                  <button type="button" onClick={changeNumber} className="login-link">
                    Change
                  </button>
                )}
              </div>
              <div className="login-mobile-row">
                <span className="login-mobile-prefix" aria-hidden="true">
                  +91
                </span>
                <input
                  ref={mobileRef}
                  id="login-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  placeholder="98XXXXXXXX"
                  value={mobile}
                  disabled={step === 'otp'}
                  onChange={(e) => {
                    setMobile(e.target.value.replace(/\D/g, ''));
                    setError('');
                  }}
                  className="login-mobile-input"
                />
                {step === 'mobile' && (
                  <button type="submit" disabled={busy !== null} className="login-send-btn">
                    {busy === 'send' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Spinner size={13} />
                        Sending…
                      </span>
                    ) : (
                      'Send OTP'
                    )}
                  </button>
                )}
              </div>
            </div>

            {step === 'otp' && (
              <div className="rise-in flex flex-col gap-3">
                <div className="flex flex-col gap-1.5" ref={otpGroupRef}>
                  <span id="login-otp-label" className="login-label">
                    One-time password
                  </span>
                  <OtpInput
                    value={otp}
                    onChange={(next) => {
                      setOtp(next);
                      setError('');
                    }}
                    labelledBy="login-otp-label"
                    disabled={busy === 'verify'}
                  />
                </div>

                <div className="flex items-center justify-between text-[12px] text-ink-3" aria-live="polite">
                  <span>Sent to {sentTo || `the email for ${formatMobile(mobile)}`}</span>
                  {countdown > 0 ? (
                    <span className="tnum font-mono">Resend in {countdown}s</span>
                  ) : (
                    <button
                      type="button"
                      className="login-link"
                      onClick={() => void sendOtp()}
                      disabled={busy !== null}
                    >
                      {busy === 'send' ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner size={12} />
                          Sending…
                        </span>
                      ) : (
                        'Resend OTP'
                      )}
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

            {step === 'otp' && (
              <button
                type="submit"
                disabled={busy !== null || otp.join('').length < OTP_LENGTH}
                className="login-primary-btn"
              >
                {busy === 'verify' ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Spinner size={16} />
                    Verifying…
                  </span>
                ) : (
                  'Verify & open dashboard'
                )}
              </button>
            )}
          </form>

          <p className="mt-6 border-t border-rule-soft pt-4 text-[12px] leading-relaxed text-ink-3">
            You will see figures for your own territory — HQ, region, zone or division — as set in
            Infinity&rsquo;s field structure. No access? Ask your administrator to add you to the
            Wockhardt user service.
          </p>
        </div>
      </main>
    </div>
  );
}

/** The left-hand brand panel. */
export function BrandPanel() {
  return (
    <aside className="login-brand rise-in">
      <img src="/wing_white.png" alt="" className="login-brand-watermark" />
      <div className="login-brand-inner">
        <img src="/wing_white.png" alt="" className="login-brand-mark" />
        <span className="login-brand-rule hidden md:block" />
        <p className="login-eyebrow text-[var(--series-sec)]">Field force dashboard</p>
        <h1 className="login-brand-title">Division Performance</h1>
        <p className="login-brand-tagline hidden md:block">
          Target, dispatch, collection and credit notes for your territory — the numbers from the
          monthly review, kept current.
        </p>
      </div>
    </aside>
  );
}
