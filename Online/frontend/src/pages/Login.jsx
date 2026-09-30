import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getPasswordRules, validatePasswordStrength } from '../utils/passwordPolicy.js'
import './Login.css'

// ── OTP digit-box input ──────────────────────────────────────────────────────

function OtpInput({ value, onChange }) {
  const boxRefs = useRef([])

  const handleChange = (index, raw) => {
    const char = raw.replace(/\D/g, '').slice(-1)
    const next = [...value]
    next[index] = char
    onChange(next)
    if (char && index < 5) boxRefs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      boxRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) boxRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) boxRefs.current[index + 1]?.focus()
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    const next = Array(6).fill('')
    digits.split('').forEach((d, i) => { next[i] = d })
    onChange(next)
    boxRefs.current[Math.min(digits.length, 5)]?.focus()
  }

  return (
    <div className="otp-input">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={el => { boxRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          className={`otp-input__box${digit ? ' otp-input__box--filled' : ''}`}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          aria-label={`OTP digit ${i + 1}`}
          autoComplete="one-time-code"
        />
      ))}
    </div>
  )
}

// ── Customer login — mobile + OTP ────────────────────────────────────────────

function CustomerLogin() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [mobile, setMobile] = useState('')
  const [step, setStep] = useState('mobile')  // 'mobile' | 'otp'
  const [otp, setOtp] = useState(Array(6).fill(''))
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [devOtp, setDevOtp] = useState(null)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter a valid 10-digit mobile number.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await auth.requestOtp(mobile)
      setDevOtp(res._devOtp ?? null)
      setStep('otp')
      setCountdown(30)
    } catch (err) {
      setError(err.message === 'User not found' ? 'Mobile number not registered.' : 'Could not send OTP. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setOtp(Array(6).fill(''))
    setError('')
    setLoading(true)
    try {
      const res = await auth.requestOtp(mobile)
      setDevOtp(res._devOtp ?? null)
      setCountdown(30)
    } catch (err) {
      setError('Could not resend OTP. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (otp.join('').length < 6) { setError('Enter all 6 digits of the OTP.'); return }
    setError('')
    setLoading(true)
    try {
      const { token, user } = await auth.verifyOtp(mobile, otp.join(''))
      login({ token, user })
      navigate('/dashboard')
    } catch (err) {
      if (err.message?.includes('expired')) {
        setError('OTP expired. Please request a new one.')
        setCountdown(0)
      } else {
        setError(err.message === 'Invalid OTP' ? 'Invalid OTP. Please try again.' : 'Verification failed. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-form">
      <div className="login-field">
        <label className="login-label">Mobile number</label>
        <div className="login-mobile-row">
          <span className="login-mobile-prefix">+91</span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            className={`login-input login-input--mobile${step === 'otp' ? '' : ' login-input--mobile-end'}`}
            placeholder="98XXXXXXXX"
            value={mobile}
            onChange={e => { setMobile(e.target.value.replace(/\D/g, '')); setError('') }}
            disabled={step === 'otp'}
          />
          {step === 'mobile' && (
            <button
              type="button"
              className="login-btn-send-otp"
              onClick={handleSendOtp}
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          )}
        </div>
      </div>

      {step === 'otp' && (
        <div className="otp-section">
          {devOtp && new URLSearchParams(window.location.search).get('SHOW_OTP') === 'true' && (
            <div className="otp-dev-banner">
              <span className="otp-dev-banner__label">DEV — OTP</span>
              <span className="otp-dev-banner__code">{devOtp}</span>
              <button type="button" className="otp-dev-banner__dismiss" onClick={() => setDevOtp(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          <div className="login-field">
            <label className="login-label">
              One-time password
            </label>
            <OtpInput value={otp} onChange={setOtp} />
          </div>
          <div className="otp-resend">
            {countdown > 0 ? (
              <span className="otp-countdown">Resend in {countdown}s</span>
            ) : (
              <button type="button" className="otp-resend-btn" onClick={handleResend}>
                Resend OTP
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="login-error" role="alert">{error}</p>}

      {step === 'otp' && (
        <button
          type="button"
          className="login-btn-primary"
          onClick={handleVerify}
          disabled={loading || otp.join('').length < 6}
        >
          {loading ? 'Verifying…' : 'Verify & Enter Portal'}
        </button>
      )}
    </div>
  )
}

// ── Eye-toggle SVGs shared by both login and change-password forms ───────────

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// ── Password strength checklist ───────────────────────────────────────────────

function PasswordStrengthList({ password }) {
  if (!password) return null
  const rules = getPasswordRules(password)
  return (
    <ul className="login-pwd-rules" aria-label="Password requirements">
      {rules.map(r => (
        <li key={r.label} className={`login-pwd-rule${r.ok ? ' login-pwd-rule--ok' : ''}`}>
          <span className="login-pwd-rule-icon" aria-hidden="true">{r.ok ? '✓' : '○'}</span>
          {r.label}
        </li>
      ))}
    </ul>
  )
}

// ── Forced change-password form ───────────────────────────────────────────────

function ChangePasswordForm({ changeToken, onSuccess }) {
  const [newPwd, setNewPwd]         = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showNew, setShowNew]       = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  const strengthError = validatePasswordStrength(newPwd)
  const mismatch      = confirmPwd && newPwd !== confirmPwd
  const canSubmit     = !strengthError && newPwd && confirmPwd && !mismatch

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      const res = await auth.changePassword(changeToken, newPwd)
      onSuccess(res)
    } catch (err) {
      setError(err.message || 'Failed to update password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-form">
      <p className="login-change-pwd-hint">
        Your password must be updated before you can continue. Choose a strong password — it will expire after 3 months.
      </p>

      <div className="login-field">
        <label className="login-label">New password</label>
        <div className="login-password-row">
          <input
            type={showNew ? 'text' : 'password'}
            className="login-input"
            placeholder="Create a strong password"
            value={newPwd}
            onChange={e => { setNewPwd(e.target.value); setError('') }}
          />
          <button type="button" className="login-eye" onClick={() => setShowNew(s => !s)} aria-label={showNew ? 'Hide' : 'Show'}>
            <EyeIcon open={showNew} />
          </button>
        </div>
        <PasswordStrengthList password={newPwd} />
      </div>

      <div className="login-field">
        <label className="login-label">Confirm new password</label>
        <div className="login-password-row">
          <input
            type={showConfirm ? 'text' : 'password'}
            className="login-input"
            placeholder="Re-enter your new password"
            value={confirmPwd}
            onChange={e => { setConfirmPwd(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
          <button type="button" className="login-eye" onClick={() => setShowConfirm(s => !s)} aria-label={showConfirm ? 'Hide' : 'Show'}>
            <EyeIcon open={showConfirm} />
          </button>
        </div>
        {mismatch && <p className="login-error" role="alert">Passwords do not match.</p>}
      </div>

      {error && <p className="login-error" role="alert">{error}</p>}

      <button
        type="button"
        className="login-btn-primary"
        onClick={handleSubmit}
        disabled={loading || !canSubmit}
      >
        {loading ? 'Saving…' : 'Set Password & Enter Portal'}
      </button>
    </div>
  )
}

// ── Forgot-password 3-step flow ───────────────────────────────────────────────

function ForgotPasswordFlow({ onSuccess, onBack }) {
  const [step, setStep]               = useState('mobile')  // 'mobile' | 'otp' | 'change'
  const [mobile, setMobile]           = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otp, setOtp]                 = useState(Array(6).fill(''))
  const [changeToken, setChangeToken] = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  const sendOtp = async (mob) => {
    setError('')
    setLoading(true)
    try {
      const res = await auth.forgotPassword(mob)
      setMaskedEmail(res.email)
      setStep('otp')
    } catch (err) {
      setError(err.message || 'Failed to send OTP. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleMobileSubmit = () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter a valid 10-digit mobile number.'); return }
    sendOtp(mobile)
  }

  const handleOtpSubmit = async () => {
    const code = otp.join('')
    if (code.length < 6) { setError('Enter the 6-digit OTP.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await auth.forgotPasswordVerify(mobile, code)
      setChangeToken(res.changeToken)
      setStep('change')
    } catch (err) {
      setError(err.message || 'Verification failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'change') {
    return (
      <ChangePasswordForm
        changeToken={changeToken}
        onSuccess={onSuccess}
      />
    )
  }

  return (
    <div className="login-form">
      <button type="button" className="login-back-btn" onClick={onBack} aria-label="Back to login">
        ← Back to login
      </button>

      {step === 'mobile' && (
        <>
          <p className="login-change-pwd-hint">
            Enter your registered mobile number. We'll send an OTP to your email to verify your identity.
          </p>
          <div className="login-field">
            <label className="login-label">Mobile number</label>
            <div className="login-mobile-row">
              <span className="login-mobile-prefix">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                className="login-input login-input--mobile login-input--mobile-end"
                placeholder="98XXXXXXXX"
                value={mobile}
                onChange={e => { setMobile(e.target.value.replace(/\D/g, '')); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleMobileSubmit()}
              />
            </div>
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button
            type="button"
            className="login-btn-primary"
            onClick={handleMobileSubmit}
            disabled={loading}
          >
            {loading ? 'Sending OTP…' : 'Send OTP'}
          </button>
        </>
      )}

      {step === 'otp' && (
        <>
          <p className="login-change-pwd-hint">
            OTP sent to <strong>{maskedEmail}</strong>. Enter it below within {10} minutes.
          </p>
          <div className="login-field">
            <label className="login-label">One-time password</label>
            <OtpInput value={otp} onChange={setOtp} />
          </div>
          <button
            type="button"
            className="login-resend-btn"
            onClick={() => { setOtp(Array(6).fill('')); setError(''); sendOtp(mobile) }}
            disabled={loading}
          >
            Resend OTP
          </button>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button
            type="button"
            className="login-btn-primary"
            onClick={handleOtpSubmit}
            disabled={loading || otp.join('').length < 6}
          >
            {loading ? 'Verifying…' : 'Verify OTP'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Staff login — mobile + password ─────────────────────────────────────────

function StaffLogin() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [mobile, setMobile]       = useState('')
  const [password, setPassword]   = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [changeState, setChangeState] = useState(null)   // { changeToken } when forced change required
  const [forgotMode, setForgotMode]   = useState(false)  // show forgot-password flow

  const handleLogin = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter a valid 10-digit mobile number.'); return }
    if (!password) { setError('Password is required.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await auth.loginPassword(mobile, password)
      if (res.mustChangePassword) {
        setChangeState({ changeToken: res.changeToken })
        return
      }
      login({ token: res.token, user: res.user })
      navigate('/dashboard')
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('locked')) {
        setError(msg)
      } else if (msg === 'User not found') {
        setError('Invalid mobile number or password.')
      } else if (msg.includes('attempt')) {
        setError(msg)
      } else if (msg.includes('Invalid password')) {
        setError(msg)
      } else {
        setError('Login failed. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (changeState) {
    return (
      <ChangePasswordForm
        changeToken={changeState.changeToken}
        onSuccess={({ token, user }) => {
          login({ token, user })
          navigate('/dashboard')
        }}
      />
    )
  }

  if (forgotMode) {
    return (
      <ForgotPasswordFlow
        onSuccess={({ token, user }) => {
          login({ token, user })
          navigate('/dashboard')
        }}
        onBack={() => setForgotMode(false)}
      />
    )
  }

  return (
    <div className="login-form">
      <div className="login-field">
        <label className="login-label">Mobile number</label>
        <div className="login-mobile-row">
          <span className="login-mobile-prefix">+91</span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            className="login-input login-input--mobile login-input--mobile-end"
            placeholder="98XXXXXXXX"
            value={mobile}
            onChange={e => { setMobile(e.target.value.replace(/\D/g, '')); setError('') }}
          />
        </div>
      </div>

      <div className="login-field">
        <label className="login-label">Password</label>
        <div className="login-password-row">
          <input
            type={showPwd ? 'text' : 'password'}
            className="login-input"
            placeholder="Enter your password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
          <button
            type="button"
            className="login-eye"
            onClick={() => setShowPwd(s => !s)}
            aria-label={showPwd ? 'Hide password' : 'Show password'}
          >
            <EyeIcon open={showPwd} />
          </button>
        </div>
        <button type="button" className="login-forgot" onClick={() => setForgotMode(true)}>Forgot password?</button>
      </div>

      {error && <p className="login-error" role="alert">{error}</p>}

      <button
        type="button"
        className="login-btn-primary"
        onClick={handleLogin}
        disabled={loading}
      >
        {loading ? 'Authenticating…' : 'Enter Portal'}
      </button>
    </div>
  )
}

// ── Login shell ──────────────────────────────────────────────────────────────

function Login() {
  const location = useLocation()
  const isStaff = location.pathname === '/admin'

  return (
    <div className="login">
      {/* Left — dark brand panel */}
      <div className="login__brand" aria-hidden="true">
        <img src="/wing_white.png" alt="" className="login__brand-watermark" />
        <div className="login__brand-inner">
          <img src="/wing_white.png" alt="" className="login__brand-mark" />
          <span className="login__brand-rule" />
          <span className="login__brand-eyebrow">Distribution Portal</span>
          <h1 className="login__brand-title">D2C</h1>
          <p className="login__brand-subtitle">Direct to Customer</p>
          <p className="login__brand-tagline">
            Unified ordering &amp; distribution management — built for modern pharma supply chains.
          </p>
        </div>
      </div>

      {/* Right — form panel */}
      <div className="login__form-panel">
        <div className="login__form-inner">
          <div className="login__card">
            <header className="login__form-header">
              <p className="login__form-eyebrow">Secure access</p>
              <h2 className="login__form-title">
                Login
              </h2>
            </header>

            {/* Re-mount form when mode changes so state resets cleanly */}
            {isStaff ? <StaffLogin key="staff" /> : <CustomerLogin key="customer" />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
