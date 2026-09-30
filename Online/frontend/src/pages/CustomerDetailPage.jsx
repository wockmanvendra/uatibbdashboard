import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCustomers } from '../context/CustomersContext.jsx'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { STATUS_LABELS, getCustomerStep } from '../data/workflow.js'
import { USERTYPE_LABELS, fmtDate } from '../utils/format.js'
import { customersApi } from '../lib/api.js'
import { lookupPinCode } from '../registration/api.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import AuditLogDialog from '../components/AuditLogDialog.jsx'
import PaymentLogDialog from '../components/PaymentLogDialog.jsx'
import OutcomeModal from '../components/OutcomeModal.jsx'
import { Field, IdentitySection, DistributionSection, TypeSpecificSections, DocumentsSection } from '../components/CustomerProfileFields.jsx'
import { buildSuccessOutcome } from '../utils/outcomeMessages.js'
import './CustomerDetailPage.css'

const CUSTOMER_LOGIN_TYPES = ['patient', 'doctor', 'hospital', 'doctor-pharmacy']

function CustomerDetailPage() {
  const { state } = useLocation()
  const id = state?.id
  const navigate = useNavigate()
  const { user } = useAuth()
  const { customers, updateCustomer, approveCustomer, rejectCustomer } = useCustomers()
  const { rules } = useDivisionConfig()
  const [confirmAction, setConfirmAction] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [outcome, setOutcome] = useState(null)

  const [confirmAdminEdit, setConfirmAdminEdit] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const [logEntries, setLogEntries] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [paymentLogOpen, setPaymentLogOpen] = useState(false)
  const [paymentLogEntries, setPaymentLogEntries] = useState([])
  const [paymentLogLoading, setPaymentLogLoading] = useState(false)

  const customer = id ? customers.find(c => c.id === id) : null

  const customerStep = customer ? getCustomerStep(rules.customerWorkflow, user.usertype) : null
  const canAct = customerStep && customer?.approvalStatus === customerStep.fromStatus && customer?.registeredBy?.id !== user.id
  const canResubmit = customer?.registeredBy?.id === user.id && customer?.approvalStatus === 'rejected'
  const canAdminEdit = ['admin', 'super-admin'].includes(user.usertype) && customer?.approvalStatus === 'approved'

  if (!customer) {
    return (
      <div className="customer-detail">
        <button type="button" className="customer-detail__back" onClick={() => navigate('/dashboard')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div className="customer-detail__empty">
          <p>{!id || customers.length > 0 ? 'Customer not found.' : 'Loading…'}</p>
        </div>
      </div>
    )
  }

  const typeLabel = {
    patient:           'Patient',
    doctor:            'Doctor',
    'doctor-pharmacy': 'Doctor Pharmacy',
    hospital:          'Hospital',
  }[customer.customerType] ?? customer.customerType

  const approver = { id: user.id, name: user.name, usertype: user.usertype }

  const handleApprove = async () => {
    setConfirmAction(null)
    try {
      await approveCustomer(customer.id, approver)
      setOutcome({ status: 'success', ...buildSuccessOutcome({ entity: 'customer', action: 'approved', identifier: customer.customerCode }) })
    } catch (err) {
      setOutcome({ status: 'error', title: "Couldn't approve customer", message: err.message || 'Something went wrong while approving this customer.' })
    }
  }

  const handleReject = async () => {
    setConfirmAction(null)
    try {
      await rejectCustomer(customer.id, approver, rejectReason.trim())
      setOutcome({ status: 'success', ...buildSuccessOutcome({ entity: 'customer', action: 'rejected', identifier: customer.customerCode }) })
    } catch (err) {
      setOutcome({ status: 'error', title: "Couldn't reject customer", message: err.message || 'Something went wrong while rejecting this customer.' })
    } finally {
      setRejectReason('')
    }
  }

  const closeConfirm = () => {
    setConfirmAction(null)
    setRejectReason('')
  }

  // Navigates away only after the user dismisses the success modal, so they
  // get to read the approve/reject confirmation before leaving the page.
  const handleOutcomeClose = () => {
    const wasSuccess = outcome?.status === 'success'
    setOutcome(null)
    if (wasSuccess) navigate('/dashboard')
  }

  const openLog = async () => {
    setLogOpen(true)
    setLogLoading(true)
    try {
      setLogEntries(await customersApi.getApprovals(customer.id))
    } finally {
      setLogLoading(false)
    }
  }

  const openPaymentLog = async () => {
    setPaymentLogOpen(true)
    setPaymentLogLoading(true)
    try {
      setPaymentLogEntries(await customersApi.getPaymentLog(customer.id))
    } finally {
      setPaymentLogLoading(false)
    }
  }

  const handleEditResubmit = () => {
    navigate('/register', { state: { resubmitCustomerId: customer.id } })
  }

  const handleAdminEditConfirm = () => {
    setConfirmAdminEdit(false)
    navigate('/register', { state: { adminEditCustomerId: customer.id } })
  }

  const startEdit = () => {
    setDraft({
      address: customer.address ?? '',
      pinCode: customer.pinCode ?? '',
      city:    customer.city    ?? '',
      state:   customer.state   ?? '',
    })
    setSaveError('')
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(null)
    setSaveError('')
  }

  const handlePinChange = async (value) => {
    if (!/^\d{0,6}$/.test(value)) return
    setDraft(d => ({ ...d, pinCode: value }))
    if (value.length !== 6) return
    try {
      const { city, state } = await lookupPinCode(value)
      setDraft(d => ({ ...d, city, state }))
    } catch {
      // lookup failed — user can fill city/state manually
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await updateCustomer(customer.id, {
        address:  draft.address  || null,
        pin_code: draft.pinCode  || null,
        city:     draft.city     || null,
        state:    draft.state    || null,
      })
      setIsEditing(false)
      setDraft(null)
    } catch (err) {
      setSaveError(err.message || 'Failed to save — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="customer-detail">
      <div className="customer-detail__top-actions">
        <button type="button" className="customer-detail__back" onClick={() => navigate('/dashboard')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {canAdminEdit && (
            <button type="button" className="customer-detail__view-log customer-detail__view-log--edit" onClick={() => setConfirmAdminEdit(true)}>
              Edit Record
            </button>
          )}
          {!CUSTOMER_LOGIN_TYPES.includes(user.usertype) && (
            <button type="button" className="customer-detail__view-log" onClick={openLog}>
              View Approval Log
            </button>
          )}
          <button type="button" className="customer-detail__view-log" onClick={openPaymentLog}>
            View Payment Log
          </button>
        </div>
      </div>

      <header className="customer-detail__header">
        <div className="customer-detail__heading">
          <p className="customer-detail__eyebrow">Customer registration</p>
          <h1 className="customer-detail__id">{customer.customerCode}</h1>
        </div>
        <div className="customer-detail__badges">
          <span className="customer-detail__type-badge">{typeLabel}</span>
          <span className={`customer-detail__status customer-detail__status--${customer.approvalStatus}`}>
            {STATUS_LABELS[customer.approvalStatus] ?? customer.approvalStatus}
          </span>
        </div>
      </header>

      {customer.approvalStatus === 'rejected' && customer.rejectionReason && (
        <div className="customer-detail__rejection">
          <p className="customer-detail__rejection-label">Rejection reason</p>
          <p className="customer-detail__rejection-text">{customer.rejectionReason}</p>
        </div>
      )}

      {canResubmit && (
        <div className="customer-detail__resubmit">
          <p className="customer-detail__resubmit-text">This registration was rejected. You can edit it and send it back for approval.</p>
          <button type="button" className="customer-detail__resubmit-btn" onClick={handleEditResubmit}>
            Edit &amp; Resubmit
          </button>
        </div>
      )}

      <div className="customer-detail__meta-grid">
        <div className="customer-detail__meta-card">
          <p className="customer-detail__meta-label">Registered by</p>
          <p className="customer-detail__meta-value">{customer.registeredBy?.name ?? '—'}</p>
        </div>
        <div className="customer-detail__meta-card">
          <p className="customer-detail__meta-label">Role</p>
          <p className="customer-detail__meta-value">{USERTYPE_LABELS[customer.registeredBy?.usertype] ?? customer.registeredBy?.usertype ?? '—'}</p>
        </div>
        <div className="customer-detail__meta-card">
          <p className="customer-detail__meta-label">Registered on</p>
          <p className="customer-detail__meta-value">{customer.registeredAt ? fmtDate(customer.registeredAt) : '—'}</p>
        </div>
      </div>

      <IdentitySection customer={customer} />

      <section className="customer-detail__card">
        <div className="customer-detail__card-title-row">
          <p className="customer-detail__card-title">Address</p>
          {canAct && !isEditing && (
            <button type="button" className="customer-detail__edit-btn" onClick={startEdit}>
              Edit
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="customer-detail__edit-form">
            <div className="customer-detail__edit-row">
              <div className="customer-detail__edit-field customer-detail__edit-field--full">
                <label className="customer-detail__edit-label">Address</label>
                <textarea
                  className="customer-detail__edit-input customer-detail__edit-textarea"
                  value={draft.address}
                  onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
                />
              </div>
            </div>
            <div className="customer-detail__edit-row customer-detail__edit-row--3">
              <div className="customer-detail__edit-field">
                <label className="customer-detail__edit-label">PIN Code</label>
                <input
                  className="customer-detail__edit-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={draft.pinCode}
                  onChange={e => handlePinChange(e.target.value)}
                />
              </div>
              <div className="customer-detail__edit-field">
                <label className="customer-detail__edit-label">City</label>
                <input
                  className="customer-detail__edit-input"
                  type="text"
                  value={draft.city}
                  onChange={e => setDraft(d => ({ ...d, city: e.target.value }))}
                />
              </div>
              <div className="customer-detail__edit-field">
                <label className="customer-detail__edit-label">State</label>
                <input
                  className="customer-detail__edit-input"
                  type="text"
                  value={draft.state}
                  onChange={e => setDraft(d => ({ ...d, state: e.target.value }))}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="customer-detail__field-grid customer-detail__field-grid--2">
            <Field label="Address"  value={customer.address} />
            <Field label="PIN code" value={customer.pinCode} />
            <Field label="City"     value={customer.city} />
            <Field label="State"    value={customer.state} />
          </div>
        )}
      </section>

      <DistributionSection customer={customer} />

      {isEditing && (
        <div className="customer-detail__card">
          {saveError && <p className="customer-detail__edit-error">{saveError}</p>}
          <div className="customer-detail__edit-controls">
            <button type="button" className="customer-detail__edit-save" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="customer-detail__edit-cancel" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <TypeSpecificSections customer={customer} />

      <DocumentsSection customer={customer} rules={rules} />

      {canAct && (
        <div className="customer-detail__actions">
          <button className="customer-detail__action-btn customer-detail__action-btn--approve" onClick={() => setConfirmAction('approve')} disabled={isEditing}>
            Approve
          </button>
          <button className="customer-detail__action-btn customer-detail__action-btn--reject" onClick={() => setConfirmAction('reject')} disabled={isEditing}>
            Reject
          </button>
        </div>
      )}

      {confirmAdminEdit && (
        <ConfirmDialog
          title="Edit approved customer record"
          message="You are about to edit an approved customer record. Changes take effect immediately without re-triggering the approval workflow. Customer name, DML code, and mobile number are locked and cannot be changed."
          confirmLabel="Proceed to Edit"
          confirmVariant="approve"
          onConfirm={handleAdminEditConfirm}
          onCancel={() => setConfirmAdminEdit(false)}
        />
      )}

      {confirmAction === 'approve' && (
        <ConfirmDialog
          message="Are you sure you want to approve this customer?"
          confirmLabel="Approve Customer"
          confirmVariant="approve"
          onConfirm={handleApprove}
          onCancel={closeConfirm}
        />
      )}

      {confirmAction === 'reject' && (
        <ConfirmDialog
          message="Are you sure you want to reject this customer?"
          confirmLabel="Reject Customer"
          confirmVariant="reject"
          onConfirm={handleReject}
          onCancel={closeConfirm}
          reasonValue={rejectReason}
          onReasonChange={setRejectReason}
        />
      )}

      {logOpen && (
        <AuditLogDialog
          title={`Approval log — ${customer.customerCode}`}
          entries={logEntries}
          loading={logLoading}
          onClose={() => setLogOpen(false)}
        />
      )}

      {paymentLogOpen && (
        <PaymentLogDialog
          title={`Payment log — ${customer.customerCode}`}
          entries={paymentLogEntries}
          loading={paymentLogLoading}
          onClose={() => setPaymentLogOpen(false)}
        />
      )}

      {outcome && (
        <OutcomeModal
          status={outcome.status}
          title={outcome.title}
          message={outcome.message}
          onClose={handleOutcomeClose}
        />
      )}
    </div>
  )
}

export default CustomerDetailPage
