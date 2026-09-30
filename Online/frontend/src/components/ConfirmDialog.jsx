import './ConfirmDialog.css'

function ConfirmDialog({ title, message, confirmLabel, confirmVariant = 'approve', onConfirm, onCancel, reasonValue, onReasonChange }) {
  const showReason = onReasonChange != null
  const confirmDisabled = showReason && !reasonValue?.trim()

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        {title && <p className="confirm-dialog__title">{title}</p>}
        <p className="confirm-dialog__message">{message}</p>
        {showReason && (
          <textarea
            className="confirm-dialog__reason"
            placeholder="Enter rejection reason…"
            rows={3}
            value={reasonValue}
            onChange={e => onReasonChange(e.target.value)}
            autoFocus
          />
        )}
        <div className="confirm-dialog__actions">
          <button
            className={`confirm-dialog__btn confirm-dialog__btn--${confirmVariant}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
          <button className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
