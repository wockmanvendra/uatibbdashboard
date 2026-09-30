import { customersApi } from '../../lib/api.js'
import { emailRule, mobileRule } from '../validation.js'
import { useLiveCheck } from '../hooks/useLiveCheck.js'

// Shared by all 4 registration forms (Doctor/Pharmacy/Hospital/Patient) —
// customers.email / customers.mobile are both required + UNIQUE (and, as of
// the NOT NULL migration, enforced at the DB level too).

export function EmailField({ register, errors, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkEmail(value, editingCustomerId),
    'A customer with this email is already registered',
  )

  return (
    <div className="reg-field">
      <label>Email ID *</label>
      <div className="reg-input-wrap">
        <input className="reg-input" type="email" {...register('email', { ...emailRule, validate: check })} />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.email && <span className="reg-err">{errors.email.message}</span>}
    </div>
  )
}

// Locked (readOnly, no validation) in admin-edit mode, same as before this
// field had a live check — an already-saved, uneditable value needs no check.
export function MobileField({ register, errors, editingCustomerId, isAdminEditMode }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkMobile(value, editingCustomerId),
    'A customer with this mobile number is already registered',
  )

  return (
    <div className="reg-field">
      <label>Mobile Number {isAdminEditMode ? <span className="reg-locked-badge">locked</span> : '*'}</label>
      <div className="reg-input-wrap">
        <input
          className={`reg-input${isAdminEditMode ? ' reg-input--readonly' : ''}`}
          inputMode="numeric"
          maxLength={10}
          readOnly={isAdminEditMode}
          {...register('mobile', isAdminEditMode ? {} : { ...mobileRule, validate: check })}
        />
        {!isAdminEditMode && status.state === 'loading' && <span className="reg-spinner" />}
        {!isAdminEditMode && status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.mobile && <span className="reg-err">{errors.mobile.message}</span>}
    </div>
  )
}
