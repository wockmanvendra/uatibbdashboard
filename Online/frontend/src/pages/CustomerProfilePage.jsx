import { useNavigate } from 'react-router-dom'
import { useCustomers } from '../context/CustomersContext.jsx'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { STATUS_LABELS } from '../data/workflow.js'
import { formatCustomerDisplayName, fmtDateOnly } from '../utils/format.js'
import CustomerProfileFields from '../components/CustomerProfileFields.jsx'
import './CustomerDetailPage.css'
import './CustomerProfilePage.css'

const TYPE_LABELS = {
  patient:           'Patient',
  doctor:            'Doctor',
  'doctor-pharmacy': 'Doctor Pharmacy',
  hospital:          'Hospital',
}

function initials(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// The logged-in customer's own record only — no id is ever read from the
// URL/route state, so there is no way to point this page at anyone else's
// profile. `customers` is already server-scoped to this customer (see
// backend/src/utils/scope.js), so the first (only) row is always "me".
function CustomerProfilePage() {
  const navigate = useNavigate()
  const { customers } = useCustomers()
  const { rules } = useDivisionConfig()
  const myCustomer = customers[0] ?? null

  if (!myCustomer) {
    return (
      <div className="customer-profile-page">
        <button type="button" className="customer-detail__back" onClick={() => navigate('/dashboard')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div className="customer-detail__empty">
          <p>{customers.length > 0 ? 'Profile not found.' : 'Loading…'}</p>
        </div>
      </div>
    )
  }

  const displayName = formatCustomerDisplayName(myCustomer)
  const typeLabel = TYPE_LABELS[myCustomer.customerType] ?? myCustomer.customerType

  return (
    <div className="customer-profile-page">
      <button type="button" className="customer-detail__back" onClick={() => navigate('/dashboard')}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Dashboard
      </button>

      <header className="customer-profile-page__hero">
        <div className="customer-profile-page__hero-blob customer-profile-page__hero-blob--a" aria-hidden="true" />
        <div className="customer-profile-page__hero-blob customer-profile-page__hero-blob--b" aria-hidden="true" />
        <div className="customer-profile-page__avatar" aria-hidden="true">{initials(myCustomer.name)}</div>
        <div className="customer-profile-page__hero-text">
          <p className="customer-profile-page__eyebrow">Your profile</p>
          <h1 className="customer-profile-page__name">{displayName}</h1>
          <div className="customer-profile-page__badges">
            <span className="customer-detail__type-badge">{typeLabel}</span>
            <span className={`customer-detail__status customer-detail__status--${myCustomer.approvalStatus}`}>
              {STATUS_LABELS[myCustomer.approvalStatus] ?? myCustomer.approvalStatus}
            </span>
          </div>
          <p className="customer-profile-page__meta">
            {myCustomer.customerCode}
            {myCustomer.registeredAt && <> · Customer since {fmtDateOnly(myCustomer.registeredAt)}</>}
          </p>
        </div>
      </header>

      {myCustomer.approvalStatus === 'rejected' && myCustomer.rejectionReason && (
        <div className="customer-detail__rejection">
          <p className="customer-detail__rejection-label">Rejection reason</p>
          <p className="customer-detail__rejection-text">{myCustomer.rejectionReason}</p>
        </div>
      )}

      <CustomerProfileFields customer={myCustomer} rules={rules} />
    </div>
  )
}

export default CustomerProfilePage
