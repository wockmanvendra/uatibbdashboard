import { useState } from 'react'

// Shared by every "check as you blur" registration field (Doctor
// Registration Number, GST, Drug Licence, PAN, Aadhaar, Email, Mobile) —
// tracks the idle/loading/success/error UI state for the spinner/checkmark
// (.reg-spinner / .reg-input-icon--ok) and wraps an async availability
// check into something usable as a react-hook-form `validate` function.
// `checkFn` resolves to `{ available: boolean }`. `check` doubles as an RHF
// `validate` directly for simple fields, or gets called from inside a
// field's own composed validate (e.g. GST's format/composition-scheme gate)
// when extra logic must run first.
export function useLiveCheck(checkFn, message) {
  const [status, setStatus] = useState({ state: 'idle' })

  const check = async (value) => {
    if (!value || !String(value).trim()) { setStatus({ state: 'idle' }); return true }
    setStatus({ state: 'loading' })
    try {
      const { available } = await checkFn(value.trim())
      setStatus({ state: available ? 'success' : 'error' })
      return available || message
    } catch {
      // Network hiccup: don't block the user — final submit still has the
      // DB's own constraint (where one exists) as a backstop.
      setStatus({ state: 'idle' })
      return true
    }
  }

  return { status, check }
}
