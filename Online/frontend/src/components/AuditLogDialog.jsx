import { USERTYPE_LABELS, fmtDate } from '../utils/format.js'
import './AuditLogDialog.css'

const ACTION_LABELS = { place: 'Placed', approve: 'Approved', reject: 'Rejected', resubmit: 'Resubmitted', dispatch: 'Dispatch Updated', 'payment-update': 'Payment Confirmed' }

function AuditLogDialog({ title, entries, loading, onClose }) {
  return (
    <div className="audit-log-overlay" onClick={onClose}>
      <div className="audit-log-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="audit-log-dialog__header">
          <h3 className="audit-log-dialog__title">{title}</h3>
          <button type="button" className="audit-log-dialog__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>

        <div className="audit-log-dialog__body">
          {loading ? (
            <p className="audit-log-dialog__empty">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="audit-log-dialog__empty">No history yet.</p>
          ) : (
            <ul className="audit-log-dialog__list">
              {entries.map((entry) => (
                <li key={entry.id} className="audit-log-dialog__row">
                  <span className={`audit-log-dialog__pill audit-log-dialog__pill--${entry.action}`}>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  <div className="audit-log-dialog__details">
                    <p className="audit-log-dialog__person">
                      {entry.approver?.name ?? '—'}
                      <span className="audit-log-dialog__designation">
                        {USERTYPE_LABELS[entry.approver?.usertype] ?? entry.approver?.usertype ?? ''}
                      </span>
                    </p>
                    <p className="audit-log-dialog__reason">{entry.reason || '—'}</p>
                  </div>
                  <span className="audit-log-dialog__time">{fmtDate(entry.approvedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default AuditLogDialog
