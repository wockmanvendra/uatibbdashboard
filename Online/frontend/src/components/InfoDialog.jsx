import './ConfirmDialog.css'

function InfoDialog({ title, message, onClose }) {
  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        {title && <p className="confirm-dialog__title">{title}</p>}
        <p className="confirm-dialog__message">{message}</p>
        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default InfoDialog
