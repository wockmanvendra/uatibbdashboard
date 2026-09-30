// Shared regex patterns + react-hook-form `validate` helpers for the
// registration forms. Centralised so every form (Patient/Doctor/Pharmacy/
// Hospital) checks email, mobile, PAN, Aadhaar, GSTIN and dates the same way.

export const PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  mobile: /^[6-9]\d{9}$/,
  pinCode: /^\d{6}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  aadhaar: /^\d{12}$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/,
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
export const ACCEPTED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
export const ACCEPTED_DOC_LABEL = 'PDF, JPG or PNG'

export const required = (label) => ({
  required: `${label} is required`,
})

export const emailRule = {
  required: 'Email ID is required',
  pattern: { value: PATTERNS.email, message: 'Enter a valid email address' },
}

export const mobileRule = {
  required: 'Mobile number is required',
  pattern: { value: PATTERNS.mobile, message: 'Enter a valid 10-digit Indian mobile number' },
}

export const pinCodeRule = {
  required: 'PIN code is required',
  pattern: { value: PATTERNS.pinCode, message: 'PIN code must be 6 digits' },
}

export const panRule = {
  required: 'PAN number is required',
  setValueAs: v => v?.toUpperCase(),
  pattern: { value: PATTERNS.pan, message: 'Format: 5 letters, 4 digits, 1 letter (e.g. AAACW1234F)' },
}

export const aadhaarRule = {
  required: 'Aadhaar number is required',
  pattern: { value: PATTERNS.aadhaar, message: 'Aadhaar number must be exactly 12 digits' },
}

export const panRuleOptional = {
  setValueAs: v => v?.toUpperCase(),
  pattern: panRule.pattern,
}

export const aadhaarRuleOptional = {
  pattern: aadhaarRule.pattern,
}

export const gstinRule = (isRequired) => ({
  required: isRequired ? 'GST number is required' : false,
  pattern: {
    value: PATTERNS.gstin,
    message: 'Enter a valid 15-character GSTIN (e.g. 27AAACW1234F1Z5)',
  },
})

// `validate` is a named-key object (not a single function) so callers that
// need an additional async check alongside this one (e.g. a live uniqueness
// lookup) can compose it in via `{ ...gstinOrSchemeRule(...).validate, ... }`
// instead of one overwriting the other — RHF treats a single fn and a
// named-key object identically when there's only one key, so this is a
// no-op for existing callers that just spread the whole rule object.
export const gstinOrSchemeRule = (getCompositionScheme) => ({
  validate: {
    formatOrScheme: (value) => {
      if (getCompositionScheme()) return true
      if (!value || !value.trim()) return 'Provide a GST Number or declare the Composition Scheme — one is required'
      return PATTERNS.gstin.test(value) || 'Enter a valid 15-character GSTIN (e.g. 27AAACW1234F1Z5)'
    },
  },
})

export const ageRule = {
  required: 'Age is required',
  min: { value: 18, message: 'Age must be at least 18' },
  max: { value: 110, message: 'Enter a realistic age' },
}

export function futureDateValidator(value) {
  if (!value) return 'Drug licence valid-till date is required'
  const date = value?.toDate ? value.toDate() : new Date(value)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date.getTime() > today.getTime() || 'Date must be in the future'
}

export function fileValidator(file) {
  if (!file) return 'This document is required'
  if (!ACCEPTED_DOC_TYPES.includes(file.type)) {
    return `Only ${ACCEPTED_DOC_LABEL} files are allowed`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File must be 10 MB or smaller'
  }
  return true
}

// Same type/size checks as fileValidator, but a missing file is valid (for
// optional uploads like Security Cheque, instead of failing as "required").
export function optionalFileValidator(file) {
  if (!file) return true
  return fileValidator(file)
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
