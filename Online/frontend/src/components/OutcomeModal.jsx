import './ConfirmDialog.css'
import './OutcomeModal.css'
import { useAppConfig } from '../context/AppConfigContext.jsx'

function OutcomeModal({ status = 'success', title, message, onClose }) {
  const { adminContactMobile } = useAppConfig()

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className={`outcome-modal__icon outcome-modal__icon--${status}`} aria-hidden="true">
          {status === 'success' ? '✓' : '!'}
        </div>
        {title && <p className="confirm-dialog__title">{title}</p>}
        <p className="confirm-dialog__message">{message}</p>
        {status === 'error' && (
          <p className="outcome-modal__support">
            {adminContactMobile
              ? <>If this keeps happening, contact the administrator at <a href={`tel:${adminContactMobile}`}>{adminContactMobile}</a>.</>
              : 'If this keeps happening, please contact the administrator for assistance.'}
          </p>
        )}
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className={`confirm-dialog__btn confirm-dialog__btn--${status === 'success' ? 'approve' : 'reject'}`}
            onClick={onClose}
          >
            {status === 'success' ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OutcomeModal
