import { useEffect, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { searchDirectory } from '../api.js'
import { useAuth } from '../../context/AuthContext.jsx'

const DEBOUNCE_MS = 250

function DirectorySelect({ name, control, label, required, directoryType, labelKey, extraKeys, helperText, onSelect, showRegistrationStatus = false, isDisabled = (option) => Boolean(option.isRegistered), excludeCustomerId }) {
  const { user } = useAuth()
  const [open, setOpen]           = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [options, setOptions]     = useState([])
  const [loading, setLoading]     = useState(false)
  const debounceRef = useRef(null)
  const wrapRef     = useRef(null)

  const location = user?.usertype === 'tm' ? user?.userLocation : undefined

  useEffect(() => {
    if (!open) return undefined
    setLoading(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchDirectory(directoryType, inputValue, user?.divisionCode, user?.sapCode, location, excludeCustomerId)
        .then(setOptions)
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [open, inputValue, directoryType, user?.divisionCode, user?.sapCode, location, excludeCustomerId])

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <Controller
      name={name}
      control={control}
      rules={required ? { required: `${label} is required` } : undefined}
      render={({ field: { onChange, value }, fieldState: { error } }) => (
        <div className="reg-field reg-directory-field" ref={wrapRef}>
          <label>
            {label}
            {required && <span className="reg-req"> *</span>}
          </label>
          <div className="reg-input-wrap">
            <input
              className="reg-input"
              type="text"
              placeholder={`Search…`}
              value={value ? (value[labelKey] ?? inputValue) : inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                if (value) onChange(null)
                if (!open) setOpen(true)
              }}
              onFocus={() => setOpen(true)}
            />
            {loading && <span className="reg-spinner" />}
          </div>
          {open && options.length > 0 && (
            <ul className="reg-dropdown">
              {options.map((option, i) => (
                <li
                  key={option.id ?? i}
                  className={`reg-dropdown__option${showRegistrationStatus && isDisabled(option) ? ' reg-dropdown__option--registered' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (showRegistrationStatus && isDisabled(option)) return
                    onChange(option)
                    setInputValue(option[labelKey] ?? '')
                    onSelect?.(option)
                    setOpen(false)
                  }}
                >
                  <span className="reg-dropdown__primary">
                    {option[labelKey]}
                    {showRegistrationStatus && isDisabled(option) && (
                      <span className="reg-dropdown__badge">Registered</span>
                    )}
                  </span>
                  {extraKeys?.map((k) => option[k] ? (
                    <span key={k} className="reg-dropdown__secondary">{option[k]}</span>
                  ) : null)}
                </li>
              ))}
            </ul>
          )}
          {open && !loading && options.length === 0 && inputValue.length > 0 && (
            <div className="reg-dropdown reg-dropdown--empty">No results found</div>
          )}
          {error    && <span className="reg-err">{error.message}</span>}
          {!error && helperText && <span className="reg-hint">{helperText}</span>}
        </div>
      )}
    />
  )
}

export default DirectorySelect
