import { useEffect, useState } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import FileDropzone from './FileDropzone.jsx'
import { lookupPinCode } from '../api.js'
import { pinCodeRule, required, optionalFileValidator } from '../validation.js'
import { cfaApi } from '../../lib/api.js'

const CFA_STATUS_MESSAGE = {
  idle:     'Enter a state to auto-assign a CFA',
  loading:  'Resolving…',
  unmapped: 'No CFA mapped for this state — contact admin',
}

function AddressFields({ control, register, errors, setValue, clearErrors }) {
  const [pinLookup, setPinLookup] = useState({ status: 'idle', message: '' })
  const [cfaResolution, setCfaResolution] = useState({ status: 'idle', cfaName: '' })

  const city  = useWatch({ control, name: 'city' })
  const state = useWatch({ control, name: 'state' })
  const isMumbai = String(city ?? '').trim().toLowerCase() === 'mumbai'

  // CFA is state-derived — re-resolve whenever state changes.
  useEffect(() => {
    if (!state || !state.trim()) {
      setCfaResolution({ status: 'idle', cfaName: '' })
      setValue('cfaCode', '', { shouldValidate: true, shouldDirty: true })
      return
    }
    let cancelled = false
    setCfaResolution({ status: 'loading', cfaName: '' })
    cfaApi.resolveByState(state).then((result) => {
      if (cancelled) return
      if (result) {
        setValue('cfaCode', result.cfaCode, { shouldValidate: true, shouldDirty: true })
        setCfaResolution({ status: 'resolved', cfaName: result.cfaName })
      } else {
        setValue('cfaCode', '', { shouldValidate: true, shouldDirty: true })
        setCfaResolution({ status: 'unmapped', cfaName: '' })
      }
    })
    return () => { cancelled = true }
  }, [state, setValue])

  const handlePinCodeChange = async (event) => {
    const { value } = event.target
    if (!/^\d{0,6}$/.test(value)) return
    setValue('pinCode', value, { shouldValidate: true, shouldDirty: true })

    if (value.length !== 6) {
      setPinLookup({ status: 'idle', message: '' })
      return
    }

    setPinLookup({ status: 'loading', message: '' })
    try {
      const { city, state } = await lookupPinCode(value)
      setValue('city',  city,  { shouldValidate: true, shouldDirty: true })
      setValue('state', state, { shouldValidate: true, shouldDirty: true })
      clearErrors(['city', 'state'])
      setPinLookup({ status: 'success', message: 'City & state auto-filled — edit if needed' })
    } catch {
      setPinLookup({ status: 'error', message: 'Could not auto-fill — please enter city & state manually' })
    }
  }

  const cfaDisplayValue = cfaResolution.status === 'resolved' ? cfaResolution.cfaName : CFA_STATUS_MESSAGE[cfaResolution.status]

  return (
    <div className="reg-grid">
      <div className="reg-col reg-col--full">
        <div className="reg-field">
          <label>Address *</label>
          <textarea
            className="reg-textarea"
            rows={2}
            {...register('address', required('Address'))}
          />
          {errors.address && <span className="reg-err">{errors.address.message}</span>}
        </div>
      </div>

      <div className="reg-col reg-col--sm">
        <div className="reg-field">
          <label>PIN Code *</label>
          <div className="reg-input-wrap">
            <input
              className="reg-input"
              inputMode="numeric"
              {...register('pinCode', { ...pinCodeRule, onChange: handlePinCodeChange })}
            />
            {pinLookup.status === 'loading' && <span className="reg-spinner" />}
            {pinLookup.status === 'success'  && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
          </div>
          {errors.pinCode && <span className="reg-err">{errors.pinCode.message}</span>}
        </div>
      </div>

      <div className="reg-col reg-col--sm">
        <div className="reg-field">
          <label>City *</label>
          <input className="reg-input" {...register('city', required('City'))} />
          {errors.city && <span className="reg-err">{errors.city.message}</span>}
        </div>
      </div>

      <div className="reg-col reg-col--sm">
        <div className="reg-field">
          <label>State *</label>
          <input className="reg-input reg-input--readonly" readOnly placeholder="Auto-filled from PIN code" {...register('state', required('State'))} />
          {errors.state && <span className="reg-err">{errors.state.message}</span>}
        </div>
      </div>

      <div className="reg-col reg-col--sm">
        <Controller
          name="cfaCode"
          control={control}
          rules={required('CFA Code')}
          render={({ fieldState: { error } }) => (
            <div className="reg-field">
              <label>CFA</label>
              <input className="reg-input" value={cfaDisplayValue} disabled readOnly />
              {error && <span className="reg-err">{error.message}</span>}
            </div>
          )}
        />
      </div>

      {(pinLookup.status === 'success' || pinLookup.status === 'error') && (
        <div className="reg-col reg-col--full">
          <span className={`reg-hint reg-hint--${pinLookup.status}`}>{pinLookup.message}</span>
        </div>
      )}

      {isMumbai && (
        <div className="reg-col reg-col--full">
          <Controller
            name="securityCheque"
            control={control}
            rules={{ validate: optionalFileValidator }}
            render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
              <FileDropzone
                label="Security Cheque"
                required={false}
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                error={error?.message}
                helperText="Shown for customers located in Mumbai."
              />
            )}
          />
        </div>
      )}
    </div>
  )
}

export default AddressFields
