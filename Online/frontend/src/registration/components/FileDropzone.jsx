import { useId, useRef, useState } from 'react'
import { ACCEPTED_DOC_LABEL, formatBytes } from '../validation.js'

const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

function FileDropzone({ label, required, helperText, value, onChange, onBlur, error, tooltip }) {
  const inputId  = useId()
  const inputRef = useRef(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const handleFiles = (fileList) => {
    const file = fileList?.[0]
    if (file) onChange(file)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragActive(false)
    handleFiles(event.dataTransfer.files)
  }

  const handleRemove = (event) => {
    event.stopPropagation()
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="reg-field">
      <p className="reg-field-label">
        {label}
        {required && <span className="reg-req"> *</span>}
        {tooltip && <span className="reg-tooltip" title={tooltip}> ⓘ</span>}
      </p>

      <label
        htmlFor={inputId}
        className={`reg-dropzone${isDragActive ? ' reg-dropzone--drag' : ''}${error ? ' reg-dropzone--error' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragActive(true) }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => handleFiles(e.target.files)}
          onBlur={onBlur}
        />

        {value ? (
          <div className="reg-dropzone__file">
            <span className="reg-dropzone__filename">{value.name}</span>
            <span className="reg-dropzone__size">{value.size != null ? formatBytes(value.size) : 'Already uploaded'}</span>
            <button
              type="button"
              className="reg-icon-btn"
              onClick={handleRemove}
              aria-label={`Remove ${label}`}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="reg-dropzone__prompt">
            <span className="reg-dropzone__cta">Drag &amp; drop, or click to browse</span>
            <span className="reg-dropzone__types">Accepted: {ACCEPTED_DOC_LABEL} · Max 10 MB</span>
          </div>
        )}
      </label>

      <span className={`reg-hint${error ? ' reg-hint--error' : ''}`}>
        {error || helperText || ' '}
      </span>
    </div>
  )
}

export default FileDropzone
