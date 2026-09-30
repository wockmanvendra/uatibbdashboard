function ConfirmSubmitDialog({ open, onClose, onConfirm, customerTypeLabel, summary, submitting, isAdminEditMode }) {
  if (!open) return null
  return (
    <div className="reg-modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="reg-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="reg-modal__title">{isAdminEditMode ? 'Save changes to this approved record?' : 'Confirm registration'}</h3>
        <p className="reg-modal__desc">
          {isAdminEditMode
            ? <>Please review the updated details below. Changes will be saved immediately without re-triggering the approval workflow.</>
            : <>Please review the details below before submitting this{' '}<strong>{customerTypeLabel}</strong> registration. You can still go back and edit any field.</>
          }
        </p>
        <hr className="reg-divider" />
        <dl className="reg-summary">
          {summary.map((row) => (
            <div key={row.label} className="reg-summary__row">
              <dt>{row.label}</dt>
              <dd>{row.value || '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="reg-modal__actions">
          <button type="button" className="reg-btn reg-btn--ghost" onClick={onClose} disabled={submitting}>
            Go back
          </button>
          <button type="button" className="reg-btn reg-btn--primary" onClick={onConfirm} disabled={submitting}>
            {submitting ? (isAdminEditMode ? 'Saving…' : 'Submitting…') : (isAdminEditMode ? 'Save changes' : 'Confirm & submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmSubmitDialog
