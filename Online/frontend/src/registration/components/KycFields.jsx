import { customersApi } from '../../lib/api.js'
import { panRuleOptional, aadhaarRuleOptional } from '../validation.js'
import { useLiveCheck } from '../hooks/useLiveCheck.js'

// Shared by Doctor/Pharmacy/Hospital forms' identical KYC sections (Patient
// has no KYC section) — customers.pan_number / customers.aadhaar_number are
// both optional but UNIQUE at the DB level, so the live check still applies
// whenever a value is actually entered.

export function PanNumberField({ register, errors, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkPanNumber(value, editingCustomerId),
    'A customer with this PAN number is already registered',
  )

  return (
    <div className="reg-field">
      <label>PAN Number</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          placeholder="e.g. AAACW1234F"
          maxLength={10}
          style={{ textTransform: 'uppercase' }}
          {...register('panNumber', { ...panRuleOptional, validate: check })}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.panNumber && <span className="reg-err">{errors.panNumber.message}</span>}
    </div>
  )
}

export function AadhaarNumberField({ register, errors, setValue, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkAadhaarNumber(value, editingCustomerId),
    'A customer with this Aadhaar number is already registered',
  )

  // inputMode="numeric" only hints the on-screen keyboard on mobile — it
  // doesn't stop a physical keyboard or paste from entering letters. Strip
  // anything non-digit immediately so it's never actually typeable, rather
  // than just flagging it as invalid after the fact.
  const { onChange: rhfOnChange, ...aadhaarField } = register('aadhaarNumber', { ...aadhaarRuleOptional, validate: check })
  const handleAadhaarChange = (event) => {
    const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 12)
    setValue('aadhaarNumber', digitsOnly, { shouldValidate: true, shouldDirty: true })
    rhfOnChange(event)
  }

  return (
    <div className="reg-field">
      <label>Aadhaar Number</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          inputMode="numeric"
          maxLength={12}
          {...aadhaarField}
          onChange={handleAadhaarChange}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.aadhaarNumber && <span className="reg-err">{errors.aadhaarNumber.message}</span>}
    </div>
  )
}
