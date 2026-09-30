import { customersApi } from '../../lib/api.js'
import { gstinOrSchemeRule, required, PATTERNS } from '../validation.js'
import { useLiveCheck } from '../hooks/useLiveCheck.js'

// Shared by PharmacyForm.jsx and HospitalForm.jsx — both have identical
// GST Number / Drug Licence Number fields (same customers.gst_number /
// customers.drug_licence_number columns), so the live-check field UI lives
// here once instead of being duplicated per form.

// Layers a live uniqueness check on top of gstinOrSchemeRule's existing
// format/composition-scheme validation (composed via named validate keys —
// see gstinOrSchemeRule in validation.js) — skipped while composition
// scheme is declared or the value isn't yet a well-formed GSTIN, so it only
// fires once the format check would otherwise pass.
export function GstNumberField({ register, errors, compositionScheme, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkGstNumber(value, editingCustomerId),
    'A customer with this GST number is already registered',
  )
  const gstRule = gstinOrSchemeRule(() => compositionScheme)

  return (
    <div className="reg-field">
      <label>GST Number{!compositionScheme && ' *'}</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          {...register('gstNumber', {
            validate: {
              ...gstRule.validate,
              unique: (value) => {
                if (compositionScheme || !value || !PATTERNS.gstin.test(value)) return true
                return check(value)
              },
            },
          })}
          disabled={compositionScheme}
          placeholder="e.g. 27AAACW1234F1Z5"
          style={{ textTransform: 'uppercase' }}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.gstNumber
        ? <span className="reg-err">{errors.gstNumber.message}</span>
        : compositionScheme && <span className="reg-hint">Disabled — composition scheme declared instead</span>
      }
    </div>
  )
}

export function DrugLicenceNumberField({ register, errors, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkDrugLicenceNumber(value, editingCustomerId),
    'A customer with this drug licence number is already registered',
  )

  return (
    <div className="reg-field">
      <label>Drug Licence Number *</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          {...register('drugLicenceNumber', { ...required('Drug licence number'), validate: check })}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.drugLicenceNumber && <span className="reg-err">{errors.drugLicenceNumber.message}</span>}
    </div>
  )
}
