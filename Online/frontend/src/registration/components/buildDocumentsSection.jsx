import { Controller } from 'react-hook-form'
import FileDropzone from './FileDropzone.jsx'
import { fileValidator } from '../validation.js'

const FIELD_REQUIRED_IF = {
  panCopy:     'panNumber',
  aadhaarCopy: 'aadhaarNumber',
}

export function buildDocumentsSection(documents) {
  if (!documents || documents.length === 0) return null

  return {
    key:      'documents',
    label:    'Documents',
    icon:     null,
    title:    'Document upload',
    subtitle: 'Accepted formats: PDF, JPG, PNG · Max size 10 MB each',
    fields:   documents.map((doc) => doc.key),
    render: ({ control, watch }) => {
      const compositionScheme = Boolean(watch('compositionScheme'))
      return (
        <div className="reg-grid">
          {documents.map((doc) => {
            const isGstDoc = /gst/i.test(doc.key) || /gst/i.test(doc.label ?? '')
            const triggerField = FIELD_REQUIRED_IF[doc.key]
            const triggerValue = triggerField ? (watch(triggerField) ?? '').toString().trim() : null
            if (triggerField && !triggerValue) return null
            const conditionalRequired = !!triggerValue
            const isRequired = (doc.required || conditionalRequired) && !(compositionScheme && isGstDoc)
            return (
              <div key={doc.key} className="reg-col reg-col--half">
                <Controller
                  name={doc.key}
                  control={control}
                  rules={{ validate: isRequired ? fileValidator : undefined }}
                  render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
                    <FileDropzone
                      label={doc.label}
                      required={isRequired}
                      value={value}
                      onChange={onChange}
                      onBlur={onBlur}
                      error={error?.message}
                    />
                  )}
                />
              </div>
            )
          })}
        </div>
      )
    },
  }
}

export function documentDefaultValues(documents) {
  return Object.fromEntries((documents ?? []).map((doc) => [doc.key, null]))
}
