import { PAYMENT_OPTION_LABELS } from '../data/paymentOptions.js'
import { fmtDate } from '../utils/format.js'
import './AuditLogDialog.css'

const STATUS_LABELS = {
  Initiated: 'Initiated', Success: 'Success', Failure: 'Failed', Aborted: 'Aborted', Pending: 'Pending',
  Selected: 'Selected', Changed: 'Changed',
}
// Reuses AuditLogDialog's pill colors: green for success, coral for a failed
// attempt, steel for a method change (mirrors the resubmit pill), neutral
// gray for the initial choice or one still in flight.
const STATUS_PILL = {
  Success: 'approve', Failure: 'reject', Aborted: 'reject',
  Initiated: 'place', Pending: 'place', Selected: 'place', Changed: 'resubmit',
}

const METHOD_EVENT_STATUSES = new Set(['Selected', 'Changed'])

function PaymentLogDialog({ title, entries, loading, onClose }) {
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
              {entries.map((entry) => {
                const isMethodEvent = METHOD_EVENT_STATUSES.has(entry.status)
                return (
                  <li key={entry.id} className="audit-log-dialog__row">
                    <span className={`audit-log-dialog__pill audit-log-dialog__pill--${STATUS_PILL[entry.status] ?? 'place'}`}>
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </span>
                    <div className="audit-log-dialog__details">
                      {isMethodEvent ? (
                        <>
                          <p className="audit-log-dialog__person">
                            {PAYMENT_OPTION_LABELS[entry.paymentMethod] ?? entry.paymentMethod ?? '—'}
                          </p>
                          <p className="audit-log-dialog__reason">
                            {entry.status === 'Selected' ? 'Chosen at order placement' : 'Updated on resubmit'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="audit-log-dialog__person">{entry.paymentMode || '—'}</p>
                          <p className="audit-log-dialog__reason">
                            {[
                              entry.trackingId && `Ref: ${entry.trackingId}`,
                              entry.bankRefNo && `Bank ref: ${entry.bankRefNo}`,
                              entry.failureMessage,
                            ].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </>
                      )}
                    </div>
                    <span className="audit-log-dialog__time">{fmtDate(entry.recordedAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default PaymentLogDialog
