import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrdering } from '../context/OrderingContext.jsx'
import { useOrders } from '../context/OrdersContext.jsx'
import { useCustomers } from '../context/CustomersContext.jsx'
import { DivisionConfigProvider, useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { ALL_APPROVER_ROLES, STATUS_LABELS, getOrderStep, getCustomerStep, getOrderStepForStatus, getCustomerStepForStatus, getStepGroupLabel } from '../data/workflow.js'
import { PAYMENT_OPTION_LABELS } from '../data/paymentOptions.js'
import { ordersApi, customersApi, usersApi, productsApi, mastersApi, adminUserDetailsApi, customerOutstandingApi, uploadsApi, divisionRulesApi, cfaStateMasterApi, cfaApi, stateMasterApi, lockedUsersApi, overviewApi, emailTestApi } from '../lib/api.js'
import { getPasswordRules, validatePasswordStrength } from '../utils/passwordPolicy.js'
import { formatCurrency } from '../utils/currency.js'
import { USERTYPE_LABELS, fmtDate, fmtElapsed, monthKey, monthKeyLabel, formatCustomerDisplayName } from '../utils/format.js'
import { formatBytes, PATTERNS } from '../registration/validation.js'
import { downloadCsv } from '../utils/csv.js'
import InfoDialog from '../components/InfoDialog.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import PayNowModal, { PayIcon } from '../components/PayNowModal.jsx'
import DivisionSelect from '../components/DivisionSelect.jsx'
import './Dashboard.css'

// ── Customer picker modal ────────────────────────────────────────────────────

// Mirrors the conditional-required logic in buildDocumentsSection.jsx
const DOC_CONDITIONAL_REQUIRED = { panCopy: 'panNumber', aadhaarCopy: 'aadhaarNumber' }

function getMissingRequiredDocs(customer, docConfig) {
  return (docConfig ?? []).filter(doc => {
    const conditionalField = DOC_CONDITIONAL_REQUIRED[doc.key]
    const conditionalRequired = conditionalField ? !!(customer[conditionalField] ?? '').toString().trim() : false
    const isGstDoc = /gst/i.test(doc.key) || /gst/i.test(doc.label ?? '')
    const isRequired = (doc.required || conditionalRequired) && !(customer.compositionScheme && isGstDoc)
    return isRequired && !customer.documents?.[doc.key]?.url
  })
}

const LICENCE_TYPES = new Set(['doctor-pharmacy', 'hospital'])

function isDrugLicenceExpired(customer) {
  if (!LICENCE_TYPES.has(customer.customerType) || !customer.drugLicenceValidTill) return false
  const today = new Date().toISOString().slice(0, 10)
  return customer.drugLicenceValidTill < today
}

function fmtDateOnly(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Time-of-day salutation for the customer overview hero banner.
function getTimeGreeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 21) return 'Good evening'
  return 'Hello'
}

function CustomerPickerModal({ onSelect, onClose }) {
  const { user } = useAuth()
  const { rules } = useDivisionConfig()
  const [search, setSearch] = useState('')
  const [allCustomers, setAllCustomers] = useState([])
  const [licenceError, setLicenceError] = useState(null)

  useEffect(() => {
    const params = { status: 'approved', ...(user?.divisionCode ? { division_code: user.divisionCode } : {}) }
    customersApi.list(params).then(setAllCustomers).catch(console.error)
  }, [user?.divisionCode])

  const filtered = allCustomers.filter(c => {
    const q = search.trim().toLowerCase()
    return !q || c.name.toLowerCase().includes(q) || (c.type ?? '').toLowerCase().includes(q) || (c.city ?? '').toLowerCase().includes(q)
  })

  const handleRowClick = (c) => {
    if (isDrugLicenceExpired(c)) {
      setLicenceError(`Cannot place order — ${c.name}'s drug licence expired on ${fmtDateOnly(c.drugLicenceValidTill)}. Ask the customer to renew it first.`)
      return
    }
    const missing = getMissingRequiredDocs(c, rules.documents.customer[c.customerType])
    if (missing.length > 0) {
      setLicenceError(`Cannot place order — the following required documents for ${c.name} have not been submitted: ${missing.map(d => d.label).join(', ')}.`)
      return
    }
    const outstandingLimit = rules.orderEntry?.outstandingLimitByType?.[c.customerType] || 0
    if (outstandingLimit > 0) {
      const totalOutstanding = (c.outstandingAmount || 0) + (c.pendingOrdersTotal || 0)
      if (totalOutstanding > outstandingLimit) {
        setLicenceError(
          `Cannot place order — ${c.name} has an outstanding balance of ₹${totalOutstanding.toFixed(2)}, which exceeds the allowed limit of ₹${outstandingLimit.toFixed(2)}. Please clear the outstanding before placing new orders.`
        )
        return
      }
    }
    onSelect(c)
  }

  return (
    <div className="cpicker-overlay" onClick={onClose}>
      <div className="cpicker" onClick={e => e.stopPropagation()}>
        <div className="cpicker__header">
          <h3 className="cpicker__title">Select Customer</h3>
          <button className="cpicker__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 2 L14 14 M14 2 L2 14" />
            </svg>
          </button>
        </div>
        {licenceError && (
          <div className="cpicker__licence-error" role="alert">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="10" cy="10" r="8" /><path d="M10 6 L10 10.5" /><circle cx="10" cy="13.5" r="0.8" fill="currentColor" stroke="none" />
            </svg>
            {licenceError}
          </div>
        )}
        <div className="cpicker__search-wrap">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="9" cy="9" r="6" /><path d="M13.4 13.4 L18 18" strokeLinecap="round" />
          </svg>
          <input type="search" className="cpicker__search" placeholder="Search by name, type or city…"
            value={search} onChange={e => { setSearch(e.target.value); setLicenceError(null) }} autoFocus />
        </div>
        <ul className="cpicker__list">
          {filtered.map(c => (
            <li key={c.id} className="cpicker__row" onClick={() => handleRowClick(c)}>
              <div className="cpicker__row-name">{c.name}</div>
              <div className="cpicker__row-meta">
                <span className="cpicker__tag">{c.type}</span>
                <span className="cpicker__city">{c.city}, {c.state}</span>
              </div>
            </li>
          ))}
          {filtered.length === 0 && <li className="cpicker__empty">No customers match "{search}"</li>}
        </ul>
      </div>
    </div>
  )
}

// ── Approval status cell — "Approved" / "Rejected" / "Pending since … · Pending with …" ──

function ApprovalStatusCell({ status, since, step, hierarchy, reason }) {
  const [showReason, setShowReason] = useState(false)

  if (status === 'approved') {
    return <span className="aq__status aq__status--approved">Approved</span>
  }
  if (status === 'rejected') {
    return (
      <>
        <button type="button" className="aq__status aq__status--rejected aq__status--clickable" onClick={() => setShowReason(true)}>
          Rejected
        </button>
        {showReason && (
          <InfoDialog
            title="Rejection reason"
            message={reason || 'No reason was provided.'}
            onClose={() => setShowReason(false)}
          />
        )}
      </>
    )
  }

  const groupLabel = getStepGroupLabel(step)
  const approverNames = step
    ? step.approverRoles
        .map(role => hierarchy?.[role])
        .filter(Boolean)
        .map(a => a.name)
    : []

  return (
    <div className="aq__pending-info">
      <span className="aq__status aq__status--pending" title={fmtDate(since)}>Pending since {fmtElapsed(since)}</span>
      {groupLabel && (
        <span className="aq__pending-with" title={approverNames.join(', ') || undefined}>
          Pending with {groupLabel}
        </span>
      )}
    </div>
  )
}

// ── Payment cell — method + payment_status, with a Pay Now action when pending ──

function PaymentCell({ order, payNowOptions, onPayNow }) {
  const isSuccess = order.paymentStatus === 'Success'
  const showPayNow = !isSuccess && payNowOptions.length > 0
  return (
    <div className="aq__payment-cell">
      <span>{PAYMENT_OPTION_LABELS[order.paymentMethod] ?? '—'}</span>
      {!showPayNow && (
        <span className={`aq__status ${isSuccess ? 'aq__status--approved' : 'aq__status--pending'}`}>
          {order.paymentStatus}
        </span>
      )}
      {showPayNow && (
        <button type="button" className="aq__btn aq__btn--pay" onClick={() => onPayNow(order)}>
          <PayIcon /> Pay Now
        </button>
      )}
    </div>
  )
}

// ── Outstanding cell — customer's outstanding balance, with a Pay Now action when due ──

// customer.outstandingSince is the timestamp the balance last went from <=0
// to positive (see backend/db/schema.sql customer_outstanding table) — null
// means settled or never outstanding.
function outstandingDaysFrom(outstandingSince) {
  if (!outstandingSince) return null
  return Math.max(0, Math.floor((Date.now() - new Date(outstandingSince).getTime()) / 86400000))
}
function formatOutstandingDays(days) {
  return days != null ? `${days} day${days === 1 ? '' : 's'}` : '—'
}

function OutstandingCell({ customer, payNowOptions, onPayNow }) {
  const ledgerAmount = customer.outstandingAmount ?? 0
  const amount = ledgerAmount + (customer.outstandingOrdersTotal ?? 0)
  const isSettled = amount <= 0
  // Pay Now only ever clears the SAP ledger portion — that's the figure
  // CCAvenue actually charges (buildCustomerOutstandingPaymentResponse) —
  // so it's gated on the ledger amount specifically, not the combined
  // total. Unpaid orders are settled individually via their own Pay Now.
  const showPayNow = ledgerAmount > 0 && payNowOptions.length > 0
  // Aging comes only from the approved-unpaid-orders portion, per the
  // outstanding-balance formula — the ledger has no aging of its own.
  const days = outstandingDaysFrom(customer.outstandingOrdersOldestApprovedAt)
  return (
    <div className="aq__payment-cell">
      <span>{formatCurrency(amount)}</span>
      {!isSettled && days != null && (
        <span className="dash-table__td-sub">{formatOutstandingDays(days)} outstanding</span>
      )}
      {!showPayNow && (
        <span className={`aq__status ${isSettled ? 'aq__status--approved' : 'aq__status--pending'}`}>
          {isSettled ? 'Settled' : 'Due'}
        </span>
      )}
      {showPayNow && (
        <button type="button" className="aq__btn aq__btn--pay" onClick={() => onPayNow(customer)}>
          <PayIcon /> Pay Now
        </button>
      )}
    </div>
  )
}

// ── Dashboard toolbar — view toggle + filters, shared by TM and approver dashboards ──

const APPROVAL_TABLE_FIELDS = {
  order: {
    byLabel:      'Order by',
    byValue:      o => o.placedBy?.name ?? '—',
    subjectLabel: 'Order for',
    subjectValue: o => o.orderingFor?.name ?? '—',
    dateValue:    o => o.placedAt,
    idValue:      o => o.orderNumber,
  },
  customer: {
    byLabel:      'Registered by',
    byValue:      c => c.registeredBy?.name ?? '—',
    subjectLabel: 'Customer type',
    subjectValue: c => c.customerType ?? '—',
    dateValue:    c => c.registeredAt,
    idValue:      c => c.customerCode,
  },
}

function DashToolbar({ view, onViewChange, showOverview = false, showFilters = true,
                        fields, byFilter, setByFilter, byOptions,
                        subjectFilter, setSubjectFilter, subjectOptions,
                        statusFilter, setStatusFilter, statusOptions,
                        monthFilter, setMonthFilter, monthOptions }) {
  return (
    <div className="dash-toolbar">
      <div className="dash-toggle" role="tablist" aria-label="Dashboard view">
        {showOverview && (
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overview'}
            className={`dash-toggle__btn${view === 'overview' ? ' dash-toggle__btn--active' : ''}`}
            onClick={() => onViewChange('overview')}
          >
            Overview
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={view === 'orders'}
          className={`dash-toggle__btn${view === 'orders' ? ' dash-toggle__btn--active' : ''}`}
          onClick={() => onViewChange('orders')}
        >
          Orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'customers'}
          className={`dash-toggle__btn${view === 'customers' ? ' dash-toggle__btn--active' : ''}`}
          onClick={() => onViewChange('customers')}
        >
          Customers
        </button>
      </div>
      {showFilters && <div className="dash-filter-bar">
        <label className="dash-filter">
          <span className="dash-filter__label">{fields.byLabel}</span>
          <select className="dash-filter__select" value={byFilter} onChange={e => setByFilter(e.target.value)}>
            <option value="">All</option>
            {byOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="dash-filter">
          <span className="dash-filter__label">{fields.subjectLabel}</span>
          <select className="dash-filter__select" value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}>
            <option value="">All</option>
            {subjectOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="dash-filter">
          <span className="dash-filter__label">Status</span>
          <select className="dash-filter__select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
        </label>
        <label className="dash-filter">
          <span className="dash-filter__label">Month</span>
          <select className="dash-filter__select" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
            <option value="">All months</option>
            {monthOptions.map(key => <option key={key} value={key}>{monthKeyLabel(key)}</option>)}
          </select>
        </label>
      </div>}
    </div>
  )
}

// ── Approval table — sortable, filterable table of items relevant to this approver's step ──

function ApprovalTable({ title, badgeCount, items, type, hierarchy, defaultStatus, statusOptions, emptyText, view, onViewChange, showOverview = false, payNowOptions, refreshOrder, refreshCustomer, actionButton, error, onRetry }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { rules } = useDivisionConfig()
  const fields = APPROVAL_TABLE_FIELDS[type]
  const isAdmin = user?.usertype === 'admin' || user?.usertype === 'super-admin'
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [searchQuery, setSearchQuery] = useState('')
  const [byFilter, setByFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(defaultStatus)
  const [monthFilter, setMonthFilter] = useState('')
  // Pending Pay Now subject — an order row or a customer row, never both for a
  // given render since `type` is fixed per ApprovalTable instance.
  const [paySubject, setPaySubject] = useState(null)

  const handleDownload = async (item) => {
    try {
      const blob = type === 'order'
        ? await ordersApi.downloadCsv(item.id)
        : await customersApi.downloadCsv(item.id)
      const name = type === 'order'
        ? `Order_${item.orderNumber}.csv`
        : `Customer_${item.customerCode}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[csv-download] failed:', err)
    }
  }

  const byOptions      = Array.from(new Set(items.map(fields.byValue).filter(v => v && v !== '—'))).sort()
  const subjectOptions = Array.from(new Set(items.map(fields.subjectValue).filter(v => v && v !== '—'))).sort()
  const monthOptions   = Array.from(new Set(items.map(item => monthKey(fields.dateValue(item))))).sort().reverse()

  const filtered = items.filter(item => {
    if (byFilter      !== '' && fields.byValue(item)      !== byFilter)    return false
    if (subjectFilter !== '' && fields.subjectValue(item) !== subjectFilter) return false
    if (statusFilter  !== 'all' && item.approvalStatus    !== statusFilter) return false
    if (monthFilter   !== '' && monthKey(fields.dateValue(item)) !== monthFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (type === 'order') {
        const matchId   = (item.orderNumber     ?? '').toLowerCase().includes(q)
        const matchName = (item.orderingFor?.name ?? '').toLowerCase().includes(q)
        const matchCid  = (item.orderingFor?.customerCode ?? '').toLowerCase().includes(q)
        if (!matchId && !matchName && !matchCid) return false
      } else {
        const matchId   = (item.customerCode ?? '').toLowerCase().includes(q)
        const matchName = (item.name         ?? '').toLowerCase().includes(q)
        if (!matchId && !matchName) return false
      }
    }
    return true
  })

  const sorted = sortRows(filtered, sort.key, sort.dir, type === 'order' ? orderSortValue : customerSortValue)

  return (
    <section className="aq">
      <DashToolbar
        view={view} onViewChange={onViewChange}
        showOverview={showOverview}
        fields={fields}
        byFilter={byFilter} setByFilter={setByFilter} byOptions={byOptions}
        subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter} subjectOptions={subjectOptions}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} statusOptions={statusOptions}
        monthFilter={monthFilter} setMonthFilter={setMonthFilter} monthOptions={monthOptions}
      />

      <div className="aq__title-row">
        <h2 className="aq__title">
          {title}
          <span className={`aq__count${badgeCount === 0 ? ' aq__count--empty' : ''}`}>{badgeCount} pending</span>
        </h2>
        <input
          type="search"
          className="field-users__search aq__search"
          placeholder="Search by ID, customer name…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {actionButton}
      </div>

      {error ? (
        <p className="aq__empty">
          Failed to load {type === 'order' ? 'orders' : 'customers'}: {error}{' '}
          {onRetry && <button type="button" className="aq__btn aq__btn--view" onClick={onRetry}>Retry</button>}
        </p>
      ) : sorted.length === 0 ? (
        <p className="aq__empty">{items.length === 0 ? emptyText : 'No items match these filters.'}</p>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <SortableTh label="ID" sortKey="id" active={sort.key === 'id'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                {type === 'order' ? (
                  <SortableTh label="Customer" sortKey="customer" active={sort.key === 'customer'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                ) : (
                  <>
                    <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                    <SortableTh label="Type" sortKey="type" active={sort.key === 'type'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  </>
                )}
                <SortableTh label={fields.byLabel} sortKey="by" active={sort.key === 'by'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Date" sortKey="date" active={sort.key === 'date'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                {type === 'order' && rules.orderEntry.showPrices && (
                  <SortableTh label="Amount" sortKey="amount" align="right" active={sort.key === 'amount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                )}
                {type === 'order' && rules.orderEntry.paymentOptions.length > 0 && (
                  <th className="dash-table__th">Payment</th>
                )}
                {type === 'customer' && (
                  <SortableTh label="Outstanding" sortKey="outstanding" active={sort.key === 'outstanding'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                )}
                <SortableTh label="Status" sortKey="status" active={sort.key === 'status'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <th className="dash-table__th dash-table__th--actions" />
                {isAdmin && <th className="dash-table__th dash-table__th--actions" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.id}>
                  <td className="dash-table__td-id">{fields.idValue(item)}</td>
                  {type === 'order' ? (
                    <td className="dash-table__td-name">
                      {item.orderingFor?.name ?? '—'}
                      {item.orderingFor?.customerCode && (
                        <span className="dash-table__td-sub">{item.orderingFor.customerCode}</span>
                      )}
                    </td>
                  ) : (
                    <>
                      <td className="dash-table__td-name">{item.name ?? '—'}</td>
                      <td><span className="aq__row-tag">{item.customerType}</span></td>
                    </>
                  )}
                  <td>{(item.placedBy ?? item.registeredBy)?.name ?? '—'}</td>
                  <td>{fmtDate(item.placedAt ?? item.registeredAt)}</td>
                  {type === 'order' && rules.orderEntry.showPrices && (
                    <td className="dash-table__td-num">{formatCurrency(item.totalPayable)}</td>
                  )}
                  {type === 'order' && rules.orderEntry.paymentOptions.length > 0 && (
                    <td><PaymentCell order={item} payNowOptions={payNowOptions} onPayNow={setPaySubject} /></td>
                  )}
                  {type === 'customer' && (
                    <td><OutstandingCell customer={item} payNowOptions={payNowOptions} onPayNow={setPaySubject} /></td>
                  )}
                  <td>
                    <ApprovalStatusCell
                      status={item.approvalStatus}
                      since={item.placedAt ?? item.registeredAt}
                      step={type === 'order'
                        ? getOrderStepForStatus(rules.orderWorkflow, item.approvalStatus)
                        : getCustomerStepForStatus(rules.customerWorkflow, item.approvalStatus)}
                      hierarchy={hierarchy}
                      reason={item.rejectionReason}
                    />
                  </td>
                  <td className="dash-table__td-actions">
                    <button className="aq__btn aq__btn--view" onClick={() => navigate(`/dashboard/${type}s`, { state: { id: item.id } })}>
                      View
                    </button>
                  </td>
                  {isAdmin && (
                    <td className="dash-table__td-actions">
                      <button className="aq__btn aq__btn--download" title="Download CSV" onClick={() => handleDownload(item)}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3 L12 15 M7 10 L12 15 L17 10" />
                          <path d="M4 19 L20 19" />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paySubject && (
        <PayNowModal
          order={paySubject}
          kind={type}
          title={type === 'customer' ? `Pay Now — ${paySubject.name}` : undefined}
          payNowOptions={payNowOptions}
          onClose={() => setPaySubject(null)}
          onLinkCreated={() => type === 'customer' ? refreshCustomer(paySubject.id) : refreshOrder(paySubject.id)}
        />
      )}
    </section>
  )
}

// ── sortable table header ────────────────────────────────────────────────────

function SortableTh({ label, sortKey, active, dir, onSort, align }) {
  const icon = <span className="dash-table__sort-icon">{active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  return (
    <th
      className={`dash-table__th${align === 'right' ? ' dash-table__th--num' : ''}${active ? ' dash-table__th--sorted' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {/* right-aligned (numeric) columns put the icon first so the label
          text — not the icon — ends up flush against the column's right
          edge, matching where the right-aligned data below it sits */}
      {align === 'right' && icon}
      {label}
      {align !== 'right' && icon}
    </th>
  )
}

// ── table sorting helpers ─────────────────────────────────────────────────────

const STATUS_SORT_ORDER = { 'pending-l1': 0, 'approved-l1': 1, 'approved': 2, 'rejected': 3 }
const STATUS_KEYS = Object.keys(STATUS_SORT_ORDER)

function sortRows(rows, key, dir, getValue) {
  return [...rows].sort((a, b) => {
    const av = getValue(a, key)
    const bv = getValue(b, key)
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av ?? '').localeCompare(String(bv ?? ''))
    return dir === 'asc' ? cmp : -cmp
  })
}

function toggleSort(setSort, key) {
  setSort(curr => curr.key === key
    ? { key, dir: curr.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' })
}

const orderSortValue = (o, key) => {
  switch (key) {
    case 'id':       return o.orderNumber
    case 'customer': return o.orderingFor?.name ?? ''
    case 'by':       return o.placedBy?.name ?? ''
    case 'date':     return new Date(o.placedAt).getTime()
    case 'amount':   return o.totalPayable ?? 0
    case 'status':   return STATUS_SORT_ORDER[o.approvalStatus] ?? 0
    default:         return ''
  }
}

const customerSortValue = (c, key) => {
  switch (key) {
    case 'id':     return c.customerCode
    case 'name':   return c.name ?? ''
    case 'type':   return c.customerType ?? ''
    case 'by':     return c.registeredBy?.name ?? ''
    case 'date':   return new Date(c.registeredAt).getTime()
    case 'outstanding': return (c.outstandingAmount ?? 0) + (c.outstandingOrdersTotal ?? 0)
    case 'status': return STATUS_SORT_ORDER[c.approvalStatus] ?? 0
    default:       return ''
  }
}

// ── TM overview panel ────────────────────────────────────────────────────────

function TmOverviewPanel({ orders, customers }) {
  const [month, setMonth] = useState('')
  const [productSort, setProductSort] = useState({ key: '', dir: 'asc' })
  const [customerSort, setCustomerSort] = useState({ key: '', dir: 'asc' })

  const monthOptions = Array.from(new Set([
    ...orders.map(o => monthKey(o.placedAt)),
    ...customers.map(c => monthKey(c.registeredAt)),
  ].filter(Boolean))).sort().reverse()

  const filteredOrders    = month ? orders.filter(o => monthKey(o.placedAt) === month)       : orders
  const filteredCustomers = month ? customers.filter(c => monthKey(c.registeredAt) === month) : customers

  const oTotal    = filteredOrders.length
  const oPending  = filteredOrders.filter(o => o.approvalStatus === 'pending-l1' || o.approvalStatus === 'approved-l1').length
  const oApproved = filteredOrders.filter(o => o.approvalStatus === 'approved').length
  const oRejected = filteredOrders.filter(o => o.approvalStatus === 'rejected').length

  const sumPayable = arr => arr.reduce((s, o) => s + (o.totalPayable ?? 0), 0)
  const oTotalValue    = sumPayable(filteredOrders)
  const oPendingValue  = sumPayable(filteredOrders.filter(o => o.approvalStatus === 'pending-l1' || o.approvalStatus === 'approved-l1'))
  const oApprovedValue = sumPayable(filteredOrders.filter(o => o.approvalStatus === 'approved'))
  const oRejectedValue = sumPayable(filteredOrders.filter(o => o.approvalStatus === 'rejected'))

  const cTotal    = filteredCustomers.length
  const cPending  = filteredCustomers.filter(c => c.approvalStatus === 'pending-l1' || c.approvalStatus === 'approved-l1').length
  const cApproved = filteredCustomers.filter(c => c.approvalStatus === 'approved').length
  const cRejected = filteredCustomers.filter(c => c.approvalStatus === 'rejected').length

  // Ledger balance + approved-but-unpaid orders, per the outstanding-balance formula.
  const sumOutstanding = arr => arr.reduce((s, c) => s + (c.outstandingAmount ?? 0) + (c.outstandingOrdersTotal ?? 0), 0)
  const cTotalOutstanding = sumOutstanding(filteredCustomers)

  // Top Products/Top Customers only count fully approved orders, not
  // anything still at pending-l1/approved-l1.
  const approvedOrders = filteredOrders.filter(o => o.approvalStatus === 'approved')

  const topProducts = useMemo(() => {
    const map = {}
    approvedOrders.forEach(o => {
      (o.items || []).forEach(item => {
        const key = `${item.productName}|${item.materialCode}`
        if (!map[key]) map[key] = { productName: item.productName, materialCode: item.materialCode, totalValue: 0, totalQty: 0 }
        map[key].totalValue += item.lineTotal ?? 0
        map[key].totalQty  += (item.orderedQty ?? 0) + (item.freeQty ?? 0)
      })
    })
    return Object.values(map).sort((a, b) => b.totalValue - a.totalValue).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders])

  const topCustomers = useMemo(() => {
    const map = {}
    approvedOrders.filter(o => o.orderingFor).forEach(o => {
      const key = `${o.orderingFor.name}|${o.orderingFor.type}`
      if (!map[key]) map[key] = { customerId: o.orderingFor.id, customerName: o.orderingFor.name, customerType: o.orderingFor.type, totalValue: 0, orderCount: 0 }
      map[key].totalValue += o.totalPayable ?? 0
      map[key].orderCount += 1
    })
    return Object.values(map)
      .map(row => {
        const cust = customers.find(c => c.id === row.customerId)
        return {
          ...row,
          outstandingAmount: (cust?.outstandingAmount ?? 0) + (cust?.outstandingOrdersTotal ?? 0),
          outstandingDays: outstandingDaysFrom(cust?.outstandingOrdersOldestApprovedAt),
        }
      })
      .sort((a, b) => b.totalValue - a.totalValue).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, customers])

  return (
    <>
      <div className="dash-section__header">
        <h2 className="dash-section__title">Overview</h2>
        <select
          className="field-users__search"
          value={month}
          onChange={e => setMonth(e.target.value)}
          aria-label="Filter by month"
        >
          <option value="">All time</option>
          {monthOptions.map(k => <option key={k} value={k}>{monthKeyLabel(k)}</option>)}
        </select>
      </div>

      <div className="admin-overview__stat-group">
        <p className="admin-overview__stat-label">My Orders</p>
        <div className="admin-overview__stat-grid">
          <StatCard label="Total"    value={oTotal}    subValue={formatCurrency(oTotalValue)} />
          <StatCard label="Pending"  value={oPending}  subValue={formatCurrency(oPendingValue)}  variant="pending" />
          <StatCard label="Approved" value={oApproved} subValue={formatCurrency(oApprovedValue)} variant="approved" />
          <StatCard label="Rejected" value={oRejected} subValue={formatCurrency(oRejectedValue)} variant="rejected" />
        </div>
      </div>

      <div className="admin-overview__stat-group">
        <p className="admin-overview__stat-label">My Customers</p>
        <div className="admin-overview__stat-grid">
          <StatCard label="Total / Outstanding" value={cTotal} subValue={formatCurrency(cTotalOutstanding)} />
          <StatCard label="Pending"  value={cPending}  variant="pending" />
          <StatCard label="Approved" value={cApproved} variant="approved" />
          <StatCard label="Rejected" value={cRejected} variant="rejected" />
        </div>
      </div>

      <div className="admin-overview__top-grid">
        <div>
          <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            Top 5 Products <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
          </h3>
          {topProducts.length === 0 ? (
            <p className="aq__empty">No order data yet.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-table__th">#</th>
                    <SortableTh label="Product" sortKey="productName" active={productSort.key === 'productName'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                    <SortableTh label="Code" sortKey="materialCode" active={productSort.key === 'materialCode'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                    <SortableTh label="Qty" sortKey="totalQty" active={productSort.key === 'totalQty'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                    <SortableTh label="Value" sortKey="totalValue" active={productSort.key === 'totalValue'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(topProducts, productSort.key, productSort.dir, (r, k) => r[k]).map((p, i) => (
                    <tr key={p.productName + i}>
                      <td className="dash-table__td-id">{i + 1}</td>
                      <td className="dash-table__td-name">{p.productName}</td>
                      <td className="dash-table__td-id">{p.materialCode || '—'}</td>
                      <td className="dash-table__td-num">{p.totalQty}</td>
                      <td className="dash-table__td-num">{formatCurrency(p.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            Top 5 Customers <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
          </h3>
          {topCustomers.length === 0 ? (
            <p className="aq__empty">No order data yet.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-table__th">#</th>
                    <SortableTh label="Customer" sortKey="customerName" active={customerSort.key === 'customerName'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Type" sortKey="customerType" active={customerSort.key === 'customerType'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Orders" sortKey="orderCount" active={customerSort.key === 'orderCount'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Value" sortKey="totalValue" active={customerSort.key === 'totalValue'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Outstanding" sortKey="outstandingAmount" active={customerSort.key === 'outstandingAmount'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Days" sortKey="outstandingDays" active={customerSort.key === 'outstandingDays'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(topCustomers, customerSort.key, customerSort.dir, (r, k) => r[k]).map((c, i) => (
                    <tr key={c.customerName + i}>
                      <td className="dash-table__td-id">{i + 1}</td>
                      <td className="dash-table__td-name">{c.customerName}</td>
                      <td>{USERTYPE_LABELS[c.customerType] ?? c.customerType}</td>
                      <td className="dash-table__td-num">{c.orderCount}</td>
                      <td className="dash-table__td-num">{formatCurrency(c.totalValue)}</td>
                      <td className="dash-table__td-num">{formatCurrency(c.outstandingAmount)}</td>
                      <td className="dash-table__td-num">{formatOutstandingDays(c.outstandingDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── TM dashboard ─────────────────────────────────────────────────────────────

function TmDashboard({ view, onViewChange }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { selectCustomer } = useOrdering()
  const { orders, ordersError, reloadOrders, refreshOrder } = useOrders()
  const { customers, customersError, reloadCustomers, refreshCustomer } = useCustomers()
  const { rules } = useDivisionConfig()
  const [showPicker, setShowPicker] = useState(false)
  const [hierarchy, setHierarchy] = useState(null)
  const [orderSort, setOrderSort] = useState({ key: 'date', dir: 'desc' })
  const [customerSort, setCustomerSort] = useState({ key: 'date', dir: 'desc' })
  const [orderByFilter, setOrderByFilter] = useState('')
  const [orderSubjectFilter, setOrderSubjectFilter] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderMonthFilter, setOrderMonthFilter] = useState('')
  const [customerByFilter, setCustomerByFilter] = useState('')
  const [customerSubjectFilter, setCustomerSubjectFilter] = useState('')
  const [customerStatusFilter, setCustomerStatusFilter] = useState('all')
  const [customerMonthFilter, setCustomerMonthFilter] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [payNowOrder, setPayNowOrder] = useState(null)
  const [payNowCustomer, setPayNowCustomer] = useState(null)

  const payNowOptions = ['online', 'payment-link'].filter(o => rules.orderEntry.paymentOptions.includes(o))

  useEffect(() => {
    usersApi.getHierarchy(user.id).then(setHierarchy).catch(() => setHierarchy(null))
  }, [user.id])

  const myOrders    = orders.filter(o => o.placedBy?.id === user.id)
  const myCustomers = customers.filter(c => c.registeredBy?.id === user.id)

  const orderFields    = APPROVAL_TABLE_FIELDS.order
  const customerFields = APPROVAL_TABLE_FIELDS.customer

  const orderByOptions      = Array.from(new Set(myOrders.map(orderFields.byValue).filter(v => v && v !== '—'))).sort()
  const orderSubjectOptions = Array.from(new Set(myOrders.map(orderFields.subjectValue).filter(v => v && v !== '—'))).sort()
  const orderMonthOptions   = Array.from(new Set(myOrders.map(o => monthKey(orderFields.dateValue(o))))).sort().reverse()
  const customerByOptions      = Array.from(new Set(myCustomers.map(customerFields.byValue).filter(v => v && v !== '—'))).sort()
  const customerSubjectOptions = Array.from(new Set(myCustomers.map(customerFields.subjectValue).filter(v => v && v !== '—'))).sort()
  const customerMonthOptions   = Array.from(new Set(myCustomers.map(c => monthKey(customerFields.dateValue(c))))).sort().reverse()

  const filteredOrders = myOrders.filter(o => {
    if (orderByFilter      !== '' && orderFields.byValue(o)      !== orderByFilter)    return false
    if (orderSubjectFilter !== '' && orderFields.subjectValue(o) !== orderSubjectFilter) return false
    if (orderStatusFilter  !== 'all' && o.approvalStatus         !== orderStatusFilter) return false
    if (orderMonthFilter   !== '' && monthKey(orderFields.dateValue(o)) !== orderMonthFilter) return false
    if (orderSearch) {
      const q = orderSearch.toLowerCase()
      if (!(o.orderNumber ?? '').toLowerCase().includes(q) &&
          !(o.orderingFor?.name ?? '').toLowerCase().includes(q) &&
          !(o.orderingFor?.customerCode ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })
  const filteredCustomers = myCustomers.filter(c => {
    if (customerByFilter      !== '' && customerFields.byValue(c)      !== customerByFilter)    return false
    if (customerSubjectFilter !== '' && customerFields.subjectValue(c) !== customerSubjectFilter) return false
    if (customerStatusFilter  !== 'all' && c.approvalStatus             !== customerStatusFilter) return false
    if (customerMonthFilter   !== '' && monthKey(customerFields.dateValue(c)) !== customerMonthFilter) return false
    if (customerSearch) {
      const q = customerSearch.toLowerCase()
      if (!(c.customerCode ?? '').toLowerCase().includes(q) &&
          !(c.name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const sortedOrders    = sortRows(filteredOrders, orderSort.key, orderSort.dir, orderSortValue)
  const sortedCustomers = sortRows(filteredCustomers, customerSort.key, customerSort.dir, customerSortValue)

  const handleSelect = (customer) => {
    selectCustomer(customer)
    setShowPicker(false)
    navigate('/products')
  }

  return (
    <>
      {view === 'overview' && (
      <section className="dash-section">
        <DashToolbar view={view} onViewChange={onViewChange} showOverview showFilters={false} />
        <TmOverviewPanel orders={myOrders} customers={myCustomers} />
      </section>
      )}

      {view === 'orders' && (
      <section className="dash-section">
        <DashToolbar
          view={view} onViewChange={onViewChange}
          showOverview
          fields={orderFields}
          byFilter={orderByFilter} setByFilter={setOrderByFilter} byOptions={orderByOptions}
          subjectFilter={orderSubjectFilter} setSubjectFilter={setOrderSubjectFilter} subjectOptions={orderSubjectOptions}
          statusFilter={orderStatusFilter} setStatusFilter={setOrderStatusFilter} statusOptions={STATUS_KEYS}
          monthFilter={orderMonthFilter} setMonthFilter={setOrderMonthFilter} monthOptions={orderMonthOptions}
        />

        <div className="dash-table-wrap">
          <div className="dash-table-title-row">
            <h3 className="dash-table-title">
              Your submitted orders
              <span className="aq__count">{myOrders.length} total</span>
            </h3>
            <input
              type="search"
              className="field-users__search aq__search"
              placeholder="Search by ID, customer name…"
              value={orderSearch}
              onChange={e => setOrderSearch(e.target.value)}
            />
            <button className="tm-actions__btn tm-actions__btn--primary" onClick={() => setShowPicker(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 L3 6 L3 20 Q3 22 5 22 L19 22 Q21 22 21 20 L21 6 L18 2 Z" />
                <path d="M3 6 L21 6" /><path d="M9 10 L15 10 M9 14 L13 14" />
              </svg>
              Place Order on Behalf of Customer →
            </button>
          </div>
          {ordersError ? (
            <p className="aq__empty">
              Failed to load orders: {ordersError}{' '}
              <button type="button" className="aq__btn aq__btn--view" onClick={reloadOrders}>Retry</button>
            </p>
          ) : myOrders.length === 0 ? (
            <p className="aq__empty">You haven't placed any orders yet.</p>
          ) : sortedOrders.length === 0 ? (
            <p className="aq__empty">No items match these filters.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <SortableTh label="Order ID" sortKey="id" active={orderSort.key === 'id'} dir={orderSort.dir} onSort={k => toggleSort(setOrderSort, k)} />
                    <SortableTh label="Customer" sortKey="customer" active={orderSort.key === 'customer'} dir={orderSort.dir} onSort={k => toggleSort(setOrderSort, k)} />
                    <SortableTh label="Date" sortKey="date" active={orderSort.key === 'date'} dir={orderSort.dir} onSort={k => toggleSort(setOrderSort, k)} />
                    {rules.orderEntry.showPrices && (
                      <SortableTh label="Amount" sortKey="amount" align="right" active={orderSort.key === 'amount'} dir={orderSort.dir} onSort={k => toggleSort(setOrderSort, k)} />
                    )}
                    {rules.orderEntry.paymentOptions.length > 0 && (
                      <th className="dash-table__th">Payment</th>
                    )}
                    <th className="dash-table__th">Outstanding Days</th>
                    <SortableTh label="Status" sortKey="status" active={orderSort.key === 'status'} dir={orderSort.dir} onSort={k => toggleSort(setOrderSort, k)} />
                    <th className="dash-table__th dash-table__th--actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map(o => (
                    <tr key={o.id}>
                      <td className="dash-table__td-id">{o.orderNumber}</td>
                      <td className="dash-table__td-name">
                        {o.orderingFor?.name ?? '—'}
                        {o.orderingFor?.customerCode && (
                          <span className="dash-table__td-sub">{o.orderingFor.customerCode}</span>
                        )}
                      </td>
                      <td>{fmtDate(o.placedAt)}</td>
                      {rules.orderEntry.showPrices && (
                        <td className="dash-table__td-num">{formatCurrency(o.totalPayable)}</td>
                      )}
                      {rules.orderEntry.paymentOptions.length > 0 && (
                        <td><PaymentCell order={o} payNowOptions={payNowOptions} onPayNow={setPayNowOrder} /></td>
                      )}
                      <td>{(() => {
                        // Per-order aging, per the outstanding-balance formula: only
                        // approved-and-unpaid orders count (orders still at
                        // pending-l1/approved-l1 aren't "outstanding" yet), and aging
                        // runs from the order's approval date — falling back to
                        // placedAt for the rare order with no logged approval event.
                        const isOutstanding = o.approvalStatus === 'approved' && o.paymentStatus !== 'Success'
                        const d = isOutstanding ? outstandingDaysFrom(o.approvedAt ?? o.placedAt) : null
                        return formatOutstandingDays(d)
                      })()}</td>
                      <td>
                        <ApprovalStatusCell
                          status={o.approvalStatus}
                          since={o.placedAt}
                          step={getOrderStepForStatus(rules.orderWorkflow, o.approvalStatus)}
                          hierarchy={hierarchy}
                          reason={o.rejectionReason}
                        />
                      </td>
                      <td className="dash-table__td-actions">
                        <button className="aq__btn aq__btn--view" onClick={() => navigate('/dashboard/orders', { state: { id: o.id } })}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      )}

      {view === 'customers' && (
      <section className="dash-section">
        <DashToolbar
          view={view} onViewChange={onViewChange}
          showOverview
          fields={customerFields}
          byFilter={customerByFilter} setByFilter={setCustomerByFilter} byOptions={customerByOptions}
          subjectFilter={customerSubjectFilter} setSubjectFilter={setCustomerSubjectFilter} subjectOptions={customerSubjectOptions}
          statusFilter={customerStatusFilter} setStatusFilter={setCustomerStatusFilter} statusOptions={STATUS_KEYS}
          monthFilter={customerMonthFilter} setMonthFilter={setCustomerMonthFilter} monthOptions={customerMonthOptions}
        />

        <div className="dash-table-wrap">
          <div className="dash-table-title-row">
            <h3 className="dash-table-title">
              Your registered customers
              <span className="aq__count">{myCustomers.length} total</span>
            </h3>
            <input
              type="search"
              className="field-users__search aq__search"
              placeholder="Search by ID, customer name…"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
            />
            <button className="tm-actions__btn tm-actions__btn--secondary" onClick={() => navigate('/register')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                <path d="M19 8 L19 14 M16 11 L22 11" />
              </svg>
              Add Customer →
            </button>
          </div>
          {customersError ? (
            <p className="aq__empty">
              Failed to load customers: {customersError}{' '}
              <button type="button" className="aq__btn aq__btn--view" onClick={reloadCustomers}>Retry</button>
            </p>
          ) : myCustomers.length === 0 ? (
            <p className="aq__empty">You haven't registered any customers yet.</p>
          ) : sortedCustomers.length === 0 ? (
            <p className="aq__empty">No items match these filters.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <SortableTh label="Customer ID" sortKey="id" active={customerSort.key === 'id'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Name" sortKey="name" active={customerSort.key === 'name'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Type" sortKey="type" active={customerSort.key === 'type'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Date" sortKey="date" active={customerSort.key === 'date'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Outstanding" sortKey="outstanding" active={customerSort.key === 'outstanding'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Status" sortKey="status" active={customerSort.key === 'status'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <th className="dash-table__th dash-table__th--actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.map(c => (
                    <tr key={c.id}>
                      <td className="dash-table__td-id">{c.customerCode}</td>
                      <td className="dash-table__td-name">{c.name}</td>
                      <td><span className="aq__row-tag">{c.customerType}</span></td>
                      <td>{fmtDate(c.registeredAt)}</td>
                      <td><OutstandingCell customer={c} payNowOptions={payNowOptions} onPayNow={setPayNowCustomer} /></td>
                      <td>
                        <ApprovalStatusCell
                          status={c.approvalStatus}
                          since={c.registeredAt}
                          step={getCustomerStepForStatus(rules.customerWorkflow, c.approvalStatus)}
                          hierarchy={hierarchy}
                          reason={c.rejectionReason}
                        />
                      </td>
                      <td className="dash-table__td-actions">
                        <button className="aq__btn aq__btn--view" onClick={() => navigate('/dashboard/customers', { state: { id: c.id } })}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      )}

      {showPicker && (
        <CustomerPickerModal onSelect={handleSelect} onClose={() => setShowPicker(false)} />
      )}

      {payNowOrder && (
        <PayNowModal
          order={payNowOrder}
          payNowOptions={payNowOptions}
          onClose={() => setPayNowOrder(null)}
          onLinkCreated={() => refreshOrder(payNowOrder.id)}
        />
      )}

      {payNowCustomer && (
        <PayNowModal
          order={payNowCustomer}
          kind="customer"
          title={`Pay Now — ${payNowCustomer.name}`}
          payNowOptions={payNowOptions}
          onClose={() => setPayNowCustomer(null)}
          onLinkCreated={() => refreshCustomer(payNowCustomer.id)}
        />
      )}
    </>
  )
}

// ── Approver overview panel ──────────────────────────────────────────────────

function ApproverOverviewPanel({ orders, customers, orderStep, customerStep, zonesDivisionCode }) {
  const { user } = useAuth()
  const [month, setMonth] = useState('')
  const [hierarchyRows, setHierarchyRows]       = useState([])
  const [hierarchyLoading, setHierarchyLoading] = useState(false)
  const [hierarchySort, setHierarchySort] = useState({ key: '', dir: 'asc' })
  const [productSort, setProductSort] = useState({ key: '', dir: 'asc' })
  const [customerSort, setCustomerSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    const role = user?.usertype
    if (!['rm', 'zsm', 'nsm', 'mm', 'dm'].includes(role)) return
    setHierarchyLoading(true)
    // Only nsm's empcode links into the vw_tm_hierarchy nsm_empcode column —
    // mm/dm also carry an empcode (their HR/SAP code) with no hierarchy
    // meaning, so this must key off role, not presence of empcode.
    const p = role === 'rm'  ? overviewApi.territories()
            : role === 'zsm' ? overviewApi.regions()
            : role === 'nsm' ? overviewApi.zones(undefined)
            : role === 'dm'  ? overviewApi.zones(zonesDivisionCode)
            : overviewApi.zones(user.divisionCode) // mm
    p.then(setHierarchyRows).catch(() => setHierarchyRows([])).finally(() => setHierarchyLoading(false))
  }, [user?.usertype, user?.divisionCode, zonesDivisionCode])

  const monthOptions = Array.from(new Set([
    ...orders.map(o => monthKey(o.placedAt)),
    ...customers.map(c => monthKey(c.registeredAt)),
  ].filter(Boolean))).sort().reverse()

  const filtOrders    = month ? orders.filter(o => monthKey(o.placedAt) === month)    : orders
  const filtCustomers = month ? customers.filter(c => monthKey(c.registeredAt) === month) : customers

  // Team-wide status picture, not "has this passed MY step" — anything not
  // yet at a terminal status (approved/rejected) counts as pending, even if
  // it's already moved past this viewer's own step onto someone else's.
  // Same convention TmOverviewPanel already uses.
  const isPending = s => s === 'pending-l1' || s === 'approved-l1'

  const oPending  = filtOrders.filter(o => isPending(o.approvalStatus)).length
  const oApproved = filtOrders.filter(o => o.approvalStatus === 'approved').length
  const oRejected = filtOrders.filter(o => o.approvalStatus === 'rejected').length
  const oTotal    = filtOrders.length

  const sumPay = arr => arr.reduce((s, o) => s + (o.totalPayable ?? 0), 0)
  const oTotalValue    = sumPay(filtOrders)
  const oPendingValue  = sumPay(filtOrders.filter(o => isPending(o.approvalStatus)))
  const oApprovedValue = sumPay(filtOrders.filter(o => o.approvalStatus === 'approved'))
  const oRejectedValue = sumPay(filtOrders.filter(o => o.approvalStatus === 'rejected'))

  const cPending  = filtCustomers.filter(c => isPending(c.approvalStatus)).length
  const cApproved = filtCustomers.filter(c => c.approvalStatus === 'approved').length
  const cRejected = filtCustomers.filter(c => c.approvalStatus === 'rejected').length
  const cTotal    = filtCustomers.length

  // Ledger balance + approved-but-unpaid orders, per the outstanding-balance formula.
  const sumOutstanding = arr => arr.reduce((s, c) => s + (c.outstandingAmount ?? 0) + (c.outstandingOrdersTotal ?? 0), 0)
  const cTotalOutstanding = sumOutstanding(filtCustomers)

  // Top Products/Top Customers only count fully approved orders, not
  // anything still at pending-l1/approved-l1.
  const approvedOrders = filtOrders.filter(o => o.approvalStatus === 'approved')

  const topProducts = useMemo(() => {
    const map = {}
    approvedOrders.forEach(o => {
      (o.items || []).forEach(item => {
        const key = `${item.productName}|${item.materialCode}`
        if (!map[key]) map[key] = { productName: item.productName, materialCode: item.materialCode, totalValue: 0, totalQty: 0 }
        map[key].totalValue += item.lineTotal ?? 0
        map[key].totalQty  += (item.orderedQty ?? 0) + (item.freeQty ?? 0)
      })
    })
    return Object.values(map).sort((a, b) => b.totalValue - a.totalValue).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtOrders])

  const topCustomers = useMemo(() => {
    const map = {}
    approvedOrders.filter(o => o.orderingFor).forEach(o => {
      const key = `${o.orderingFor.name}|${o.orderingFor.type}`
      if (!map[key]) map[key] = { customerId: o.orderingFor.id, customerName: o.orderingFor.name, customerType: o.orderingFor.type, totalValue: 0, orderCount: 0 }
      map[key].totalValue += o.totalPayable ?? 0
      map[key].orderCount += 1
    })
    return Object.values(map)
      .map(row => {
        const cust = customers.find(c => c.id === row.customerId)
        return {
          ...row,
          outstandingAmount: (cust?.outstandingAmount ?? 0) + (cust?.outstandingOrdersTotal ?? 0),
          outstandingDays: outstandingDaysFrom(cust?.outstandingOrdersOldestApprovedAt),
        }
      })
      .sort((a, b) => b.totalValue - a.totalValue).slice(0, 5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtOrders, customers])

  return (
    <>
      <div className="dash-section__header">
        <h2 className="dash-section__title">Overview</h2>
        <select
          className="field-users__search"
          value={month}
          onChange={e => setMonth(e.target.value)}
          aria-label="Filter by month"
        >
          <option value="">All time</option>
          {monthOptions.map(k => <option key={k} value={k}>{monthKeyLabel(k)}</option>)}
        </select>
      </div>

      <div className="admin-overview__stat-group">
        <p className="admin-overview__stat-label">Orders{orderStep ? ` — ${orderStep.label}` : ''}</p>
        <div className="admin-overview__stat-grid">
          <StatCard label="Total"    value={oTotal}    subValue={formatCurrency(oTotalValue)} />
          <StatCard label="Pending"  value={oPending}  subValue={formatCurrency(oPendingValue)}  variant="pending" />
          <StatCard label="Approved" value={oApproved} subValue={formatCurrency(oApprovedValue)} variant="approved" />
          <StatCard label="Rejected" value={oRejected} subValue={formatCurrency(oRejectedValue)} variant="rejected" />
        </div>
      </div>

      <div className="admin-overview__stat-group">
        <p className="admin-overview__stat-label">Customers{customerStep ? ` — ${customerStep.label}` : ''}</p>
        <div className="admin-overview__stat-grid">
          <StatCard label="Total / Outstanding" value={cTotal} subValue={formatCurrency(cTotalOutstanding)} />
          <StatCard label="Pending"  value={cPending}  variant="pending" />
          <StatCard label="Approved" value={cApproved} variant="approved" />
          <StatCard label="Rejected" value={cRejected} variant="rejected" />
        </div>
      </div>

      {['rm', 'zsm', 'nsm', 'mm', 'dm'].includes(user?.usertype) && (
        <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            {user?.usertype === 'rm' ? 'Territories' : user?.usertype === 'zsm' ? 'Regions' : 'Zones'}
            {' '}<span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
          </h3>
          {hierarchyLoading ? (
            <p className="aq__empty">Loading…</p>
          ) : hierarchyRows.length === 0 ? (
            <p className="aq__empty">No data available.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <SortableTh label={user?.usertype === 'rm' ? 'Territory Name' : user?.usertype === 'zsm' ? 'Region Name' : 'Zone Name'} sortKey="name" active={hierarchySort.key === 'name'} dir={hierarchySort.dir} onSort={k => toggleSort(setHierarchySort, k)} />
                    <SortableTh label={user?.usertype === 'rm' ? 'TM Name' : user?.usertype === 'zsm' ? 'RM Name' : 'ZSM Name'} sortKey="manager" active={hierarchySort.key === 'manager'} dir={hierarchySort.dir} onSort={k => toggleSort(setHierarchySort, k)} />
                    <SortableTh label="Customers" sortKey="customer_count" active={hierarchySort.key === 'customer_count'} dir={hierarchySort.dir} onSort={k => toggleSort(setHierarchySort, k)} align="right" />
                    <SortableTh label="Orders" sortKey="order_count" active={hierarchySort.key === 'order_count'} dir={hierarchySort.dir} onSort={k => toggleSort(setHierarchySort, k)} align="right" />
                    <SortableTh label="Order Value" sortKey="order_value" active={hierarchySort.key === 'order_value'} dir={hierarchySort.dir} onSort={k => toggleSort(setHierarchySort, k)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(hierarchyRows, hierarchySort.key, hierarchySort.dir, (row, key) => {
                    switch (key) {
                      case 'name':            return row.territory_name ?? row.region_name ?? row.zone_name ?? ''
                      case 'manager':         return row.tm_name ?? row.rm_name ?? row.zsm_name ?? ''
                      case 'customer_count':  return Number(row.customer_count) || 0
                      case 'order_count':     return Number(row.order_count) || 0
                      case 'order_value':     return Number(row.order_value) || 0
                      default:                return ''
                    }
                  }).map((row, i) => (
                    <tr key={i}>
                      <td className="dash-table__td-name">{row.territory_name ?? row.region_name ?? row.zone_name ?? '—'}</td>
                      <td className="dash-table__td-name">
                        {row.tm_name ?? row.rm_name ?? row.zsm_name ?? '—'}
                        {row.is_self && <span className="aq__row-tag" style={{ marginLeft: '0.5rem' }}>RM</span>}
                      </td>
                      <td className="dash-table__td-num">{row.customer_count}</td>
                      <td className="dash-table__td-num">{row.order_count}</td>
                      <td className="dash-table__td-num">{formatCurrency(Number(row.order_value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="admin-overview__top-grid">
        <div>
          <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            Top 5 Products <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
          </h3>
          {topProducts.length === 0 ? (
            <p className="aq__empty">No order data yet.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-table__th">#</th>
                    <SortableTh label="Product" sortKey="productName" active={productSort.key === 'productName'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                    <SortableTh label="Code" sortKey="materialCode" active={productSort.key === 'materialCode'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                    <SortableTh label="Qty" sortKey="totalQty" active={productSort.key === 'totalQty'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                    <SortableTh label="Value" sortKey="totalValue" active={productSort.key === 'totalValue'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(topProducts, productSort.key, productSort.dir, (r, k) => r[k]).map((p, i) => (
                    <tr key={p.productName + i}>
                      <td className="dash-table__td-id">{i + 1}</td>
                      <td className="dash-table__td-name">{p.productName}</td>
                      <td className="dash-table__td-id">{p.materialCode || '—'}</td>
                      <td className="dash-table__td-num">{p.totalQty}</td>
                      <td className="dash-table__td-num">{formatCurrency(p.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            Top 5 Customers <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
          </h3>
          {topCustomers.length === 0 ? (
            <p className="aq__empty">No order data yet.</p>
          ) : (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-table__th">#</th>
                    <SortableTh label="Customer" sortKey="customerName" active={customerSort.key === 'customerName'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Type" sortKey="customerType" active={customerSort.key === 'customerType'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                    <SortableTh label="Orders" sortKey="orderCount" active={customerSort.key === 'orderCount'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Value" sortKey="totalValue" active={customerSort.key === 'totalValue'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Outstanding" sortKey="outstandingAmount" active={customerSort.key === 'outstandingAmount'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                    <SortableTh label="Days" sortKey="outstandingDays" active={customerSort.key === 'outstandingDays'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(topCustomers, customerSort.key, customerSort.dir, (r, k) => r[k]).map((c, i) => (
                    <tr key={c.customerName + i}>
                      <td className="dash-table__td-id">{i + 1}</td>
                      <td className="dash-table__td-name">{c.customerName}</td>
                      <td>{USERTYPE_LABELS[c.customerType] ?? c.customerType}</td>
                      <td className="dash-table__td-num">{c.orderCount}</td>
                      <td className="dash-table__td-num">{formatCurrency(c.totalValue)}</td>
                      <td className="dash-table__td-num">{formatCurrency(c.outstandingAmount)}</td>
                      <td className="dash-table__td-num">{formatOutstandingDays(c.outstandingDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Approver dashboard — chain-based: each approver sees only their items ─────

// dm has cross-division access (unlike every other approver role) — must
// actively pick one division to view, same gate/switcher UX as super-admin's
// AdminDashboard. The rules-dependent body is split into ApproverDashboardBody
// so it can be wrapped in its own DivisionConfigProvider for a cross-division
// dm (same divisionCodeOverride pattern AdminOrdersCustomersPanel already uses)
// — otherwise a dm viewing another division's queue would incorrectly see
// their own division's approval-workflow rules.
function ApproverDashboard({ view, onViewChange }) {
  const { user } = useAuth()
  const [selectedDivision, setSelectedDivision] = useState('')
  const isDm = user.usertype === 'dm'

  if (isDm && !selectedDivision) {
    return (
      <div className="admin-dash admin-dash__gate">
        <h2 className="admin-dash__title">Select a division to continue</h2>
        <DivisionSelect value="" onChange={setSelectedDivision} allowAll={false} />
      </div>
    )
  }

  const body = <ApproverDashboardBody view={view} onViewChange={onViewChange} selectedDivision={isDm ? selectedDivision : null} />

  if (!isDm) return body

  return (
    <>
      <div className="admin-dash__bar">
        <DivisionSelect value={selectedDivision} onChange={setSelectedDivision} allowAll={false} className="admin-dash__division-select" />
      </div>
      <DivisionConfigProvider divisionCodeOverride={selectedDivision}>
        {body}
      </DivisionConfigProvider>
    </>
  )
}

function ApproverDashboardBody({ view, onViewChange, selectedDivision }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orders, ordersError, reloadOrders, refreshOrder } = useOrders()
  const { customers, customersError, reloadCustomers, refreshCustomer } = useCustomers()
  const { selectCustomer } = useOrdering()
  const { rules } = useDivisionConfig()
  const [hierarchy, setHierarchy] = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  // RM doubles as field staff: they can place orders / register customers like
  // a TM, in addition to approving step 1 — ZSM/NSM stay approval-only.
  const canSelfServe = user.usertype === 'rm'

  useEffect(() => {
    usersApi.getHierarchy(user.id).then(setHierarchy).catch(() => setHierarchy(null))
  }, [user.id])

  const handleSelect = (customer) => {
    selectCustomer(customer)
    setShowPicker(false)
    navigate('/products')
  }

  const orderStep    = getOrderStep(rules.orderWorkflow, user.usertype)
  const customerStep = getCustomerStep(rules.customerWorkflow, user.usertype)

  // dm's orders/customers already span every division (OrdersContext/
  // CustomersContext skip the division_code fetch filter for dm) — narrow to
  // the picked division here, client-side.
  const scopedOrders    = selectedDivision ? orders.filter(o => o.divisionCode === selectedDivision)    : orders
  const scopedCustomers = selectedDivision ? customers.filter(c => c.divisionCode === selectedDivision) : customers

  // Items that have reached or passed this approver's step: still pending with
  // them, already approved by them, or fully approved further down the chain.
  // A rejection can't be attributed to a specific step from the data available
  // client-side, so every rejected item is treated as having reached this step.
  const orderRank = orderStep ? STATUS_SORT_ORDER[orderStep.fromStatus] : null
  const relevantOrders = orderStep
    ? scopedOrders.filter(o => STATUS_SORT_ORDER[o.approvalStatus] >= orderRank)
    : []
  const pendingOrders = relevantOrders.filter(o => o.approvalStatus === orderStep.fromStatus)
  const orderStatusOptions = orderStep ? STATUS_KEYS.filter(s => STATUS_SORT_ORDER[s] >= orderRank) : []

  const customerRank = customerStep ? STATUS_SORT_ORDER[customerStep.fromStatus] : null
  // A role with no customerStep in this division's customer_workflow (e.g. rm
  // in a division that doesn't list rm as a customer approver) still has
  // customers in scope — fall back to showing all of them, status-bucketed
  // the simple way (same convention TmOverviewPanel uses), instead of hiding
  // the customer section entirely.
  const relevantCustomers = customerStep
    ? scopedCustomers.filter(c => STATUS_SORT_ORDER[c.approvalStatus] >= customerRank)
    : scopedCustomers
  const pendingCustomers = customerStep
    ? relevantCustomers.filter(c => c.approvalStatus === customerStep.fromStatus)
    : relevantCustomers.filter(c => c.approvalStatus === 'pending-l1' || c.approvalStatus === 'approved-l1')
  const customerStatusOptions = customerStep ? STATUS_KEYS.filter(s => STATUS_SORT_ORDER[s] >= customerRank) : STATUS_KEYS

  const orderQueueLabel    = `Orders — ${orderStep?.label    ?? USERTYPE_LABELS[user.usertype]}`
  const customerQueueLabel = `Customer Registrations — ${customerStep?.label ?? USERTYPE_LABELS[user.usertype]}`
  const payNowOptions = ['online', 'payment-link'].filter(o => rules.orderEntry.paymentOptions.includes(o))

  return (
    <>
      {view === 'overview' && (
        <section className="dash-section">
          <DashToolbar view={view} onViewChange={onViewChange} showOverview showFilters={false} />
          <ApproverOverviewPanel
            orders={scopedOrders} customers={scopedCustomers}
            orderStep={orderStep} customerStep={customerStep}
            zonesDivisionCode={selectedDivision}
          />
        </section>
      )}
      {view === 'orders' && (
        <ApprovalTable
          view={view} onViewChange={onViewChange}
          showOverview
          title={orderQueueLabel}
          badgeCount={pendingOrders.length}
          items={relevantOrders}
          type="order"
          hierarchy={hierarchy}
          defaultStatus={orderStep?.fromStatus ?? 'all'}
          statusOptions={orderStatusOptions}
          emptyText="No orders are pending your approval."
          payNowOptions={payNowOptions}
          refreshOrder={refreshOrder}
          error={ordersError}
          onRetry={reloadOrders}
          actionButton={canSelfServe ? (
            <button className="tm-actions__btn tm-actions__btn--primary" onClick={() => setShowPicker(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 L3 6 L3 20 Q3 22 5 22 L19 22 Q21 22 21 20 L21 6 L18 2 Z" />
                <path d="M3 6 L21 6" /><path d="M9 10 L15 10 M9 14 L13 14" />
              </svg>
              Place Order on Behalf of Customer →
            </button>
          ) : null}
        />
      )}
      {view === 'customers' && (
        <ApprovalTable
          view={view} onViewChange={onViewChange}
          showOverview
          title={customerQueueLabel}
          badgeCount={pendingCustomers.length}
          items={relevantCustomers}
          type="customer"
          hierarchy={hierarchy}
          defaultStatus={customerStep?.fromStatus ?? 'all'}
          statusOptions={customerStatusOptions}
          emptyText="No customer registrations are pending your approval."
          payNowOptions={payNowOptions}
          refreshCustomer={refreshCustomer}
          error={customersError}
          onRetry={reloadCustomers}
          actionButton={canSelfServe ? (
            <button className="tm-actions__btn tm-actions__btn--secondary" onClick={() => navigate('/register')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                <path d="M19 8 L19 14 M16 11 L22 11" />
              </svg>
              Add Customer →
            </button>
          ) : null}
        />
      )}
      {showPicker && (
        <CustomerPickerModal onSelect={handleSelect} onClose={() => setShowPicker(false)} />
      )}
    </>
  )
}

// ── Admin dashboard — hamburger menu (Product Master / Infinity Master Sync) ──

const ADMIN_MENU_ITEMS = [
  { key: 'overview',          label: 'Overview' },
  { key: 'products',          label: 'Product Master' },
  { key: 'orders-customers',  label: 'Orders & Customers' },
  { key: 'customer-upload',   label: 'Customer Upload' },
  { key: 'infinity-sync',     label: 'Infinity Master Sync' },
  { key: 'admin-user-details', label: 'Admin User Details' },
  { key: 'login-history',     label: 'Login History' },
  { key: 'locked-users',      label: 'Locked Users' },
  { key: 'cfa-records',       label: 'CFA Records' },
  { key: 'email-test',        label: 'Email Test' },
  { key: 'division-rules',    label: 'Division Rules' },
]

const CFA_MENU_ITEMS = [
  { key: 'orders',    label: 'Orders' },
  { key: 'customers', label: 'Customers' },
  { key: 'dispatch',  label: 'Dispatch Details' },
  { key: 'payment',   label: 'Payment Details' },
]

const EMPTY_PRODUCT_FORM = {
  name: '', brand: '', materialCode: '',
  price: '', minOrderQty: '1', initMinOrderQty: '1', maxOrderQty: '100', description: '',
  unit: '', unitDescription: '', image: null, imageBlobName: null, isActive: true,
}

const EMPTY_CFA_LOCATION_FORM = { cfaCode: '', cfaName: '', mobile: '', email: '' }
const EMPTY_CFA_STATE_MASTER_FORM = { stateCode: '', cfaCode: '' }
const CFA_LOCATIONS_PAGE_SIZE = 10
const CFA_STATE_MASTER_PAGE_SIZE = 15

function ProductFormDialog({ title, form, setForm, onSubmit, onCancel, saving, error, brandOptions, onAddBrand }) {
  const [addingBrand, setAddingBrand] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')

  const imagePreview = useMemo(() => {
    if (form.image instanceof File) return URL.createObjectURL(form.image)
    if (typeof form.image === 'string' && form.image) return form.image
    return null
  }, [form.image])

  useEffect(() => {
    if (!(form.image instanceof File)) return
    return () => URL.revokeObjectURL(imagePreview)
  }, [form.image, imagePreview])

  const confirmNewBrand = () => {
    const trimmed = newBrandName.trim()
    if (!trimmed) return
    onAddBrand(trimmed)
    setForm(f => ({ ...f, brand: trimmed }))
    setNewBrandName('')
    setAddingBrand(false)
  }

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{title}</h3>
        <form onSubmit={onSubmit}>
          <label className="product-form__field">
            <span>Name <span className="product-form__req">*</span></span>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="product-form__row">
            <label className="product-form__field">
              <span>Brand <span className="product-form__req">*</span></span>
              {addingBrand ? (
                <div className="product-form__brand-row">
                  <input
                    autoFocus
                    placeholder="New brand name"
                    value={newBrandName}
                    onChange={e => setNewBrandName(e.target.value)}
                  />
                  <button type="button" className="product-form__brand-btn" onClick={confirmNewBrand}>✓</button>
                  <button type="button" className="product-form__brand-btn" onClick={() => { setAddingBrand(false); setNewBrandName('') }}>✕</button>
                </div>
              ) : (
                <div className="product-form__brand-row">
                  <select value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                    {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <button type="button" className="product-form__brand-btn" title="Add new brand" onClick={() => setAddingBrand(true)}>+</button>
                </div>
              )}
            </label>
            <label className="product-form__field">
              <span>Material code <span className="product-form__req">*</span></span>
              <input required value={form.materialCode} onChange={e => setForm(f => ({ ...f, materialCode: e.target.value }))} />
            </label>
          </div>
          <label className="product-form__field">
            <span>Price (₹) <span className="product-form__req">*</span></span>
            <input required type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </label>
          <div className="product-form__row">
            <label className="product-form__field">
              <span>Min order qty <span className="product-form__req">*</span></span>
              <input required type="number" min="1" value={form.minOrderQty} onChange={e => setForm(f => ({ ...f, minOrderQty: e.target.value }))} />
            </label>
            <label className="product-form__field">
              <span>Max order qty <span className="product-form__req">*</span></span>
              <input required type="number" min="1" value={form.maxOrderQty} onChange={e => setForm(f => ({ ...f, maxOrderQty: e.target.value }))} />
            </label>
          </div>
          <label className="product-form__field">
            <span>Initial min order qty <span className="product-form__req">*</span></span>
            <input required type="number" min="1" value={form.initMinOrderQty} onChange={e => setForm(f => ({ ...f, initMinOrderQty: e.target.value }))} />
          </label>
          <label className="product-form__field">
            <span>Unit <span className="product-form__req">*</span></span>
            <input
              required
              placeholder="e.g. Strip of 10 Tablets, 1 Litre Bottle"
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            />
          </label>
          <label className="product-form__field">
            <span>Unit description</span>
            <textarea
              rows={2}
              placeholder="e.g. Each strip contains 10 tablets of 500mg each."
              value={form.unitDescription}
              onChange={e => setForm(f => ({ ...f, unitDescription: e.target.value }))}
            />
          </label>
          <label className="product-form__field">
            <span>Description</span>
            <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </label>
          <label className="product-form__field">
            <span>Product image</span>
            <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) setForm(f => ({ ...f, image: file })) }} />
            {imagePreview && (
              <div className="product-form__image-preview">
                <img src={imagePreview} alt="" />
                <button type="button" className="product-form__remove-btn" onClick={() => setForm(f => ({ ...f, image: null }))}>Remove</button>
              </div>
            )}
          </label>
          <label className="product-form__field">
            <span>Status <span className="product-form__req">*</span></span>
            <select value={form.isActive ? 'active' : 'inactive'} onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'active' }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          {error && <p className="product-form__error">{error}</p>}

          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProductMasterPanel({ divisionCode }) {
  const { user } = useAuth()
  const canEdit = ['scm-admin', 'super-admin'].includes(user.usertype)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | product
  const [form, setForm] = useState(EMPTY_PRODUCT_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [confirmingSave, setConfirmingSave] = useState(false)
  const [extraBrands, setExtraBrands] = useState([])
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadState, setUploadState] = useState({ status: 'idle', message: '' })
  const [skippedRows, setSkippedRows] = useState([])
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [search, setSearch] = useState('')

  const loadProducts = () => {
    setLoading(true)
    setLoadError(null)
    productsApi.list({ ...(divisionCode ? { division_code: divisionCode } : {}), include_inactive: true })
      .then(setProducts)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadProducts()
  }, [divisionCode])

  const handleBulkUpload = async () => {
    if (!uploadFile) return
    setUploadState({ status: 'loading', message: '' })
    setSkippedRows([])
    try {
      const result = await productsApi.bulkUpload(uploadFile, divisionCode)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped — see the log below.` : ''
      setUploadState({ status: 'success', message: `Created ${result.count} product${result.count === 1 ? '' : 's'}.${skippedNote}` })
      setSkippedRows(result.skippedRows ?? [])
      setUploadFile(null)
      loadProducts()
    } catch (err) {
      setUploadState({ status: 'error', message: err.message })
    }
  }

  const handleDownloadProductTemplate = async () => {
    try {
      const blob = await productsApi.downloadBulkUploadTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'products_upload_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message || 'Could not download the template.' })
    }
  }

  const handleDownloadProductSkipLog = () => {
    downloadCsv('product_upload_skipped.csv', [
      { key: 'row', label: 'Row' }, { key: 'material_code', label: 'Material Code' }, { key: 'name', label: 'Name' }, { key: 'reason', label: 'Reason' },
    ], skippedRows)
  }

  const brandOptions = useMemo(
    () => Array.from(new Set([...products.map(p => p.brand), ...extraBrands])).sort(),
    [products, extraBrands]
  )

  const q = search.trim().toLowerCase()
  const filteredProducts = q
    ? products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.materialCode ?? '').toLowerCase().includes(q)
      )
    : products

  const openNew = () => {
    setForm({ ...EMPTY_PRODUCT_FORM, brand: brandOptions[0] ?? '' })
    setSaveError(null)
    setEditing('new')
  }

  const openEdit = (product) => {
    setForm({
      name: product.name,
      brand: product.brand,
      materialCode: product.materialCode ?? '',
      price: String(product.price),
      minOrderQty: String(product.minOrderQty),
      initMinOrderQty: String(product.initMinOrderQty),
      maxOrderQty: String(product.maxOrderQty),
      description: product.description ?? '',
      unit: product.unit ?? '',
      unitDescription: product.unitDescription ?? '',
      image: product.image ?? null,
      imageBlobName: product.imageBlobName ?? null,
      isActive: product.isActive ?? true,
    })
    setSaveError(null)
    setEditing(product)
  }

  const handleFormSubmit = (e) => {
    e.preventDefault()
    setConfirmingSave(true)
  }

  const performSave = async () => {
    setConfirmingSave(false)
    setSaving(true)
    setSaveError(null)
    try {
      // Persist the durable blob key, not the (short-lived) SAS link shown in
      // the preview — unchanged edits fall back to the blob key captured when
      // the product was loaded for editing.
      let imageUrl = typeof form.image === 'string' ? form.imageBlobName : null
      if (form.image instanceof File) {
        const uploaded = await uploadsApi.upload(form.image, 'products')
        imageUrl = uploaded.blobName
      }
      const payload = {
        name: form.name.trim(),
        brand: form.brand,
        material_code: form.materialCode.trim() || null,
        price: Number(form.price),
        min_order_qty: Number(form.minOrderQty),
        init_min_order_qty: Number(form.initMinOrderQty),
        max_order_qty: Number(form.maxOrderQty),
        description: form.description.trim() || null,
        unit: form.unit.trim() || null,
        unit_description: form.unitDescription.trim() || null,
        image_url: imageUrl,
        is_active: form.isActive,
      }
      if (editing === 'new') {
        const created = await productsApi.create({ ...payload, division_code: divisionCode })
        setProducts(prev => [...prev, created])
      } else {
        const updated = await productsApi.update(editing.id, payload)
        setProducts(prev => prev.map(p => p.id === updated.id ? updated : p))
      }
      setEditing(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">
          Product Master
          {!loading && !loadError && (
            <span className="infinity-sync__count" style={{ marginLeft: '0.75rem' }}>
              {products.length} product{products.length === 1 ? '' : 's'}
            </span>
          )}
        </h2>
        <div className="field-users__header-actions">
          <input
            className="field-users__search"
            type="search"
            placeholder="Search by name, brand or material code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {canEdit && (
            <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={openNew}>
              + Add Product
            </button>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="infinity-sync__card" style={{ marginBottom: '1.5rem' }}>
          <p className="infinity-sync__card-desc">
            Upload an Excel file to bulk-create products in this division. Required columns: <code>name</code>, <code>brand</code>, <code>material_code</code>, <code>price</code>, <code>min_order_qty</code>, <code>init_min_order_qty</code>, <code>max_order_qty</code>, <code>unit</code>.
            A row whose <code>material_code</code> already exists here is skipped, not overwritten — products created this way have no image until you attach one via Edit.
          </p>
          <ExcelDropzone value={uploadFile} onChange={f => { setUploadFile(f); setUploadState({ status: 'idle', message: '' }); setSkippedRows([]) }} />
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={!uploadFile || uploadState.status === 'loading'}
            onClick={handleBulkUpload}
          >
            {uploadState.status === 'loading' ? 'Uploading…' : 'Upload'}
          </button>
          {uploadState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{uploadState.message}</p>}
          {uploadState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{uploadState.message}</p>}
          {skippedRows.length > 0 && (
            <button type="button" className="infinity-sync__history-link" onClick={handleDownloadProductSkipLog}>
              Download skip log ({skippedRows.length} row{skippedRows.length === 1 ? '' : 's'})
            </button>
          )}
          <button type="button" className="infinity-sync__history-link" onClick={handleDownloadProductTemplate}>
            Download sample template
          </button>
        </div>
      )}

      {loading ? (
        <p className="aq__empty">Loading products…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load products: {loadError}</p>
      ) : products.length === 0 ? (
        <p className="aq__empty">No products in your division yet.</p>
      ) : filteredProducts.length === 0 ? (
        <p className="aq__empty">No products match your search.</p>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <SortableTh label="Name"          sortKey="name"         active={sort.key === 'name'}         dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Brand"         sortKey="brand"        active={sort.key === 'brand'}        dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Material code" sortKey="materialCode" active={sort.key === 'materialCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Price"         sortKey="price"        active={sort.key === 'price'}        dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />
                <SortableTh label="Status"        sortKey="isActive"     active={sort.key === 'isActive'}     dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <th className="dash-table__th dash-table__th--actions" />
              </tr>
            </thead>
            <tbody>
              {sortRows(filteredProducts, sort.key, sort.dir, (r, k) => r[k]).map(p => (
                <tr key={p.id}>
                  <td className="dash-table__td-name">{p.name}</td>
                  <td>{p.brand}</td>
                  <td>{p.materialCode}</td>
                  <td className="dash-table__td-num">{formatCurrency(p.price)}</td>
                  <td>
                    <span className={`aq__status ${p.isActive ? 'aq__status--approved' : 'aq__status--rejected'}`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="dash-table__td-actions">
                    {canEdit && <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(p)}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductFormDialog
          title={editing === 'new' ? 'Add Product' : `Edit ${editing.name}`}
          form={form}
          setForm={setForm}
          onSubmit={handleFormSubmit}
          onCancel={() => setEditing(null)}
          saving={saving}
          error={saveError}
          brandOptions={brandOptions}
          onAddBrand={(name) => setExtraBrands(prev => Array.from(new Set([...prev, name])))}
        />
      )}
      {confirmingSave && (
        <ConfirmDialog
          message={editing === 'new' ? `Create product "${form.name}"?` : `Save changes to "${form.name}"?`}
          confirmLabel={editing === 'new' ? 'Create' : 'Save'}
          confirmVariant="approve"
          onConfirm={performSave}
          onCancel={() => setConfirmingSave(false)}
        />
      )}
    </section>
  )
}

function InfinitySyncPanel({ divisionCode }) {
  const { user } = useAuth()
  const [doctorState, setDoctorState] = useState({ status: 'idle', message: '', skippedRows: [] })
  const [chemistState, setChemistState] = useState({ status: 'idle', message: '', skippedRows: [] })
  const [fieldStructureState, setFieldStructureState] = useState({ status: 'idle', message: '', skippedRows: [] })
  const [showHistory, setShowHistory] = useState(false)
  const [showCustomerOutstanding, setShowCustomerOutstanding] = useState(false)
  const [showDoctors, setShowDoctors] = useState(false)
  const [showChemists, setShowChemists] = useState(false)
  const [showFieldStructureView, setShowFieldStructureView] = useState(false)
  const [counts, setCounts] = useState(null)

  const loadCounts = () => {
    mastersApi.getCounts(divisionCode).then(setCounts).catch(() => {})
  }

  useEffect(() => {
    loadCounts()
  }, [divisionCode])

  const runSync = async (setState, syncFn, label) => {
    setState({ status: 'loading', message: '', skippedRows: [] })
    try {
      const runBy = user ? { id: user.id, name: user.name } : undefined
      const result = await syncFn(divisionCode, runBy)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped — download the log below for details.` : ''
      setState({ status: 'success', message: `Synced ${result.count} ${label} record${result.count === 1 ? '' : 's'}.${skippedNote}`, skippedRows: result.skippedRows ?? [] })
      loadCounts()
    } catch (err) {
      setState({ status: 'error', message: err.message, skippedRows: [] })
    }
  }

  // Field Structure Sync feeds vw_infinity_users (via field_structure_infinity), so
  // Create / Update Users is chained right after it instead of needing a separate click.
  // Skip reasons from both legs are combined into one log, tagged by syncType, since
  // they're reported from a single button click.
  const handleFieldStructureSync = async () => {
    setFieldStructureState({ status: 'loading', message: '', skippedRows: [] })
    try {
      const runBy = user ? { id: user.id, name: user.name } : undefined
      const result = await mastersApi.syncFieldStructure(divisionCode, runBy)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped.` : ''
      let message = `Synced ${result.count} field structure record${result.count === 1 ? '' : 's'}.${skippedNote}`
      let combinedSkipped = (result.skippedRows ?? []).map(r => ({ syncType: 'field-structure', ...r }))
      try {
        const usersResult = await mastersApi.syncUsers(divisionCode, runBy)
        const usersSkippedNote = usersResult.skipped ? ` ${usersResult.skipped} skipped.` : ''
        const usersDeactivatedNote = usersResult.deactivated ? ` ${usersResult.deactivated} deactivated.` : ''
        message += ` Also synced ${usersResult.count} user record${usersResult.count === 1 ? '' : 's'}.${usersSkippedNote}${usersDeactivatedNote}`
        combinedSkipped = combinedSkipped.concat((usersResult.skippedRows ?? []).map(r => ({ syncType: 'user', ...r })))
      } catch (usersErr) {
        message += ` (Could not sync users: ${usersErr.message})`
      }
      if (combinedSkipped.length) message += ' Download the log below for details.'
      setFieldStructureState({ status: 'success', message, skippedRows: combinedSkipped })
      loadCounts()
    } catch (err) {
      setFieldStructureState({ status: 'error', message: err.message, skippedRows: [] })
    }
  }

  if (showHistory) {
    return <SyncHistoryPanel divisionCode={divisionCode} onBack={() => setShowHistory(false)} />
  }

  if (showCustomerOutstanding) {
    return <CustomerOutstandingPanel divisionCode={divisionCode} onBack={() => { setShowCustomerOutstanding(false); loadCounts() }} />
  }

  if (showDoctors) {
    return (
      <MasterDirectoryPanel
        title="Doctor Master"
        typeLabel="Speciality"
        divisionCode={divisionCode}
        fetchPage={mastersApi.browseDoctors}
        onBack={() => setShowDoctors(false)}
      />
    )
  }

  if (showChemists) {
    return (
      <MasterDirectoryPanel
        title="Chemist Master"
        typeLabel="Classification"
        divisionCode={divisionCode}
        fetchPage={mastersApi.browseChemists}
        onBack={() => setShowChemists(false)}
      />
    )
  }

  if (showFieldStructureView) {
    return (
      <MasterDirectoryPanel
        title="Field Structure"
        typeLabel="Role"
        divisionCode={divisionCode}
        fetchPage={mastersApi.browseFieldStructure}
        onBack={() => setShowFieldStructureView(false)}
      />
    )
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Infinity Master Sync</h2>
        <button type="button" className="infinity-sync__history-link" onClick={() => setShowHistory(true)}>
          View Sync History →
        </button>
      </div>
      <p className="aq__empty" style={{ marginBottom: '1.5rem' }}>
        Pull the latest Doctor and Chemist directories from Infinity for your division.
      </p>
      <div className="infinity-sync__cards">
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">Doctor Master Sync</h3>
            {counts && <span className="infinity-sync__count">{counts.doctors} record{counts.doctors === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Updates the doctor directory used during customer registration and order placement.</p>
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={doctorState.status === 'loading'}
            onClick={() => runSync(setDoctorState, mastersApi.syncDoctors, 'doctor')}
          >
            {doctorState.status === 'loading' ? 'Syncing…' : 'Doctor Master Sync'}
          </button>
          {doctorState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{doctorState.message}</p>}
          {doctorState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{doctorState.message}</p>}
          {doctorState.skippedRows.length > 0 && (
            <button
              type="button"
              className="infinity-sync__history-link"
              onClick={() => downloadCsv('doctor_sync_skipped.csv', [
                { key: 'doctorId', label: 'Doctor ID' }, { key: 'name', label: 'Name' }, { key: 'reason', label: 'Reason' },
              ], doctorState.skippedRows)}
            >
              Download skip log ({doctorState.skippedRows.length} row{doctorState.skippedRows.length === 1 ? '' : 's'})
            </button>
          )}
          <button type="button" className="infinity-sync__history-link" onClick={() => setShowDoctors(true)}>
            View Records →
          </button>
        </div>
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">Chemist Master Sync</h3>
            {counts && <span className="infinity-sync__count">{counts.chemists} record{counts.chemists === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Updates the chemist directory used during customer registration and order placement.</p>
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={chemistState.status === 'loading'}
            onClick={() => runSync(setChemistState, mastersApi.syncChemists, 'chemist')}
          >
            {chemistState.status === 'loading' ? 'Syncing…' : 'Chemist Master Sync'}
          </button>
          {chemistState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{chemistState.message}</p>}
          {chemistState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{chemistState.message}</p>}
          {chemistState.skippedRows.length > 0 && (
            <button
              type="button"
              className="infinity-sync__history-link"
              onClick={() => downloadCsv('chemist_sync_skipped.csv', [
                { key: 'chemistId', label: 'Chemist ID' }, { key: 'name', label: 'Name' }, { key: 'reason', label: 'Reason' },
              ], chemistState.skippedRows)}
            >
              Download skip log ({chemistState.skippedRows.length} row{chemistState.skippedRows.length === 1 ? '' : 's'})
            </button>
          )}
          <button type="button" className="infinity-sync__history-link" onClick={() => setShowChemists(true)}>
            View Records →
          </button>
        </div>
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">Field Structure Sync</h3>
            {counts && <span className="infinity-sync__count">{counts.fieldStructure} record{counts.fieldStructure === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Updates the field force hierarchy (managers, territories, locations) for your division, and refreshes TM/RM/ZSM/NSM login accounts from it.</p>
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={fieldStructureState.status === 'loading'}
            onClick={handleFieldStructureSync}
          >
            {fieldStructureState.status === 'loading' ? 'Syncing…' : 'Field Structure Sync'}
          </button>
          {fieldStructureState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{fieldStructureState.message}</p>}
          {fieldStructureState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{fieldStructureState.message}</p>}
          {fieldStructureState.skippedRows.length > 0 && (
            <button
              type="button"
              className="infinity-sync__history-link"
              onClick={() => downloadCsv('field_structure_sync_skipped.csv', [
                { key: 'syncType', label: 'Sync' }, { key: 'empCode', label: 'Emp Code' }, { key: 'name', label: 'Name' }, { key: 'reason', label: 'Reason' },
              ], fieldStructureState.skippedRows)}
            >
              Download skip log ({fieldStructureState.skippedRows.length} row{fieldStructureState.skippedRows.length === 1 ? '' : 's'})
            </button>
          )}
          <button type="button" className="infinity-sync__history-link" onClick={() => setShowFieldStructureView(true)}>
            View Records →
          </button>
        </div>
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">Customer Outstanding</h3>
            {counts && <span className="infinity-sync__count">{counts.customerOutstanding} record{counts.customerOutstanding === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Upload and view customer outstanding balances (synced from SAP) for your division.</p>
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            onClick={() => setShowCustomerOutstanding(true)}
          >
            Maintain Customer Outstanding
          </button>
        </div>
      </div>
    </section>
  )
}

// ── Master directory browse (Doctor / Chemist / Field Structure) — server-side
// paginated, unlike the other panels in this file, since these datasets run into the
// tens of thousands of rows per division and can't be fetched client-side in full.

const MASTER_DIRECTORY_PAGE_SIZE = 20
const MASTER_DIRECTORY_SEARCH_DEBOUNCE_MS = 300

function MasterDirectoryPanel({ title, typeLabel, divisionCode, fetchPage, onBack }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), MASTER_DIRECTORY_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, sort])

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetchPage({ divisionCode, q: debouncedSearch, page, pageSize: MASTER_DIRECTORY_PAGE_SIZE, sortBy: sort.key, sortDir: sort.dir })
      .then(result => { setRows(result.rows); setTotal(result.total) })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [divisionCode, debouncedSearch, page, sort])

  const totalPages = Math.max(1, Math.ceil(total / MASTER_DIRECTORY_PAGE_SIZE))

  return (
    <section className="dash-section">
      {onBack && (
        <button type="button" className="field-users__back" onClick={onBack}>
          ← Infinity Master Sync
        </button>
      )}

      <div className="dash-section__header">
        <h2 className="dash-section__title">{title}</h2>
        <div className="field-users__header-actions">
          <input
            className="field-users__search"
            type="search"
            placeholder="Search by name, code, location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="aq__empty">Loading…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load: {loadError}</p>
      ) : rows.length === 0 ? (
        <p className="aq__empty">{total === 0 ? 'No records found for your division yet.' : 'No records match your search.'}</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <SortableTh label="Code" sortKey="code" active={sort.key === 'code'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label={typeLabel} sortKey="type" active={sort.key === 'type'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Location" sortKey="location" active={sort.key === 'location'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Mobile" sortKey="mobile" active={sort.key === 'mobile'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Email" sortKey="email" active={sort.key === 'email'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.code}>
                    <td className="dash-table__td-id">{r.code}</td>
                    <td className="dash-table__td-name">{r.name}</td>
                    <td>{r.type ? <span className="aq__row-tag">{r.type}</span> : '—'}</td>
                    <td>{r.location || '—'}</td>
                    <td>{r.mobile || '—'}</td>
                    <td>{r.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className="field-users__pagination-info">
                Page {page} of {totalPages} · {total} record{total === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Sync History (audit trail of Infinity Master Sync job runs) ─────────────

const SYNC_TYPE_LABELS = {
  doctors: 'Doctor Master Sync',
  chemists: 'Chemist Master Sync',
  'field-structure': 'Field Structure Sync',
  users: 'Create / Update Users',
  'customer-outstanding': 'Customer Outstanding Upload',
}
const SYNC_HISTORY_PAGE_SIZE = 10

function SyncHistoryPanel({ divisionCode, onBack }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [syncTypeFilter, setSyncTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    mastersApi.getSyncHistory({ division_code: divisionCode, sync_type: syncTypeFilter })
      .then(setHistory)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [divisionCode, syncTypeFilter])

  useEffect(() => {
    setPage(1)
  }, [syncTypeFilter])

  const sorted = sortRows(history, sort.key, sort.dir, (h, k) => {
    if (k === 'runAt') return new Date(h.runAt).getTime() || 0
    if (k === 'recordCount' || k === 'skippedCount' || k === 'deactivatedCount') return Number(h[k]) || 0
    if (k === 'syncType') return SYNC_TYPE_LABELS[h.syncType] ?? h.syncType ?? ''
    return h[k] ?? ''
  })
  const totalPages = Math.max(1, Math.ceil(history.length / SYNC_HISTORY_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * SYNC_HISTORY_PAGE_SIZE, currentPage * SYNC_HISTORY_PAGE_SIZE)

  return (
    <section className="dash-section">
      {onBack && (
        <button type="button" className="field-users__back" onClick={onBack}>
          ← Infinity Master Sync
        </button>
      )}
      <div className="dash-section__header">
        <h2 className="dash-section__title">Sync History</h2>
        <div className="field-users__header-actions">
          <select
            className="field-users__search"
            value={syncTypeFilter}
            onChange={e => setSyncTypeFilter(e.target.value)}
          >
            <option value="">All sync types</option>
            {Object.entries(SYNC_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="aq__empty">Loading sync history…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load sync history: {loadError}</p>
      ) : history.length === 0 ? (
        <p className="aq__empty">No sync jobs have been run yet.</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <SortableTh label="Sync Type" sortKey="syncType" active={sort.key === 'syncType'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Status" sortKey="status" active={sort.key === 'status'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Records" sortKey="recordCount" active={sort.key === 'recordCount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />
                  <SortableTh label="Skipped" sortKey="skippedCount" active={sort.key === 'skippedCount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />
                  <SortableTh label="Deactivated" sortKey="deactivatedCount" active={sort.key === 'deactivatedCount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />
                  <SortableTh label="Run By" sortKey="runByName" active={sort.key === 'runByName'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Run At" sortKey="runAt" active={sort.key === 'runAt'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                </tr>
              </thead>
              <tbody>
                {paginated.map(h => (
                  <tr key={h.id}>
                    <td className="dash-table__td-name">{SYNC_TYPE_LABELS[h.syncType] ?? h.syncType}</td>
                    <td>
                      {h.status === 'success'
                        ? <span className="aq__status aq__status--approved">Success</span>
                        : <span className="aq__status aq__status--rejected" title={h.errorMessage || ''}>Error</span>}
                    </td>
                    <td className="dash-table__td-num">{h.recordCount ?? '—'}</td>
                    <td className="dash-table__td-num">{h.skippedCount ?? '—'}</td>
                    <td className="dash-table__td-num">{h.deactivatedCount ?? '—'}</td>
                    <td>{h.runByName || '—'}</td>
                    <td title={fmtDate(h.runAt)}>{fmtElapsed(h.runAt)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className="field-users__pagination-info">
                Page {currentPage} of {totalPages} · {history.length} run{history.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Login History (audit trail of every login attempt) ─────────────────────

const LOGIN_METHOD_LABELS = { otp: 'OTP', password: 'Password' }
const LOGIN_HISTORY_PAGE_SIZE = 10

function LoginHistoryPanel({ divisionCode }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    mastersApi.getLoginHistory({ division_code: divisionCode, status: statusFilter, login_method: methodFilter })
      .then(setHistory)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [divisionCode, statusFilter, methodFilter])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, methodFilter, monthFilter])

  const monthOptions = Array.from(new Set(history.map(h => monthKey(h.loggedInAt)))).sort().reverse()
  const filtered = monthFilter === '' ? history : history.filter(h => monthKey(h.loggedInAt) === monthFilter)
  const sorted = sortRows(filtered, sort.key, sort.dir, (h, k) => {
    if (k === 'loggedInAt') return new Date(h.loggedInAt).getTime() || 0
    if (k === 'usertype') return USERTYPE_LABELS[h.usertype] ?? h.usertype ?? ''
    if (k === 'loginMethod') return LOGIN_METHOD_LABELS[h.loginMethod] ?? h.loginMethod ?? ''
    return h[k] ?? ''
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOGIN_HISTORY_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * LOGIN_HISTORY_PAGE_SIZE, currentPage * LOGIN_HISTORY_PAGE_SIZE)

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Login History</h2>
        <div className="field-users__header-actions">
          <select className="field-users__search" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
          <select className="field-users__search" value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
            <option value="">All methods</option>
            <option value="otp">OTP</option>
            <option value="password">Password</option>
          </select>
          <select className="field-users__search" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
            <option value="">All months</option>
            {monthOptions.map(key => <option key={key} value={key}>{monthKeyLabel(key)}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="aq__empty">Loading login history…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load login history: {loadError}</p>
      ) : history.length === 0 ? (
        <p className="aq__empty">No login attempts recorded yet.</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">No items match these filters.</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Mobile" sortKey="mobileno" active={sort.key === 'mobileno'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="User Type" sortKey="usertype" active={sort.key === 'usertype'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Method" sortKey="loginMethod" active={sort.key === 'loginMethod'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Status" sortKey="status" active={sort.key === 'status'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Logged In At" sortKey="loggedInAt" active={sort.key === 'loggedInAt'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                </tr>
              </thead>
              <tbody>
                {paginated.map(h => (
                  <tr key={h.id}>
                    <td className="dash-table__td-name">{h.name || '—'}</td>
                    <td>{h.mobileno}</td>
                    <td>{USERTYPE_LABELS[h.usertype] ?? h.usertype ?? '—'}</td>
                    <td>{LOGIN_METHOD_LABELS[h.loginMethod] ?? h.loginMethod}</td>
                    <td>
                      {h.status === 'success'
                        ? <span className="aq__status aq__status--approved">Success</span>
                        : <span className="aq__status aq__status--rejected" title={h.failureReason || ''}>Failed</span>}
                    </td>
                    <td title={fmtDate(h.loggedInAt)}>{fmtElapsed(h.loggedInAt)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className="field-users__pagination-info">
                Page {currentPage} of {totalPages} · {filtered.length} attempt{filtered.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Customer Upload (admin bulk-creates customers via Excel) ────────────────

// Drag-and-drop .xlsx/.xls picker, styled to match the dashboard's rounded-card
// motifs — mirrors the registration flow's FileDropzone interaction (drag state,
// click-to-browse via a hidden input, remove button once a file is chosen) without
// pulling in its PDF/image-specific accept type and old-page CSS namespace.
function ExcelDropzone({ value, onChange }) {
  const inputId = useId()
  const inputRef = useRef(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const handleFiles = (fileList) => {
    const file = fileList?.[0]
    if (file) onChange(file)
  }

  const handleRemove = (event) => {
    event.stopPropagation()
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <label
      htmlFor={inputId}
      className={`upload-dropzone${isDragActive ? ' upload-dropzone--drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setIsDragActive(true) }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={e => { e.preventDefault(); setIsDragActive(false); handleFiles(e.dataTransfer.files) }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={e => handleFiles(e.target.files)}
      />
      {value ? (
        <div className="upload-dropzone__file">
          <span className="upload-dropzone__filename">{value.name}</span>
          <span className="upload-dropzone__size">{formatBytes(value.size)}</span>
          <button type="button" className="upload-dropzone__remove" onClick={handleRemove} aria-label="Remove file">×</button>
        </div>
      ) : (
        <div className="upload-dropzone__prompt">
          <span className="upload-dropzone__cta">Drag &amp; drop, or click to browse</span>
          <span className="upload-dropzone__types">Accepted: .xlsx, .xls · Max 10 MB</span>
        </div>
      )}
    </label>
  )
}

function CustomerUploadPanel() {
  const { user } = useAuth()
  const canEdit = ['scm-admin', 'super-admin'].includes(user.usertype)
  const [file, setFile] = useState(null)
  const [uploadState, setUploadState] = useState({ status: 'idle', message: '' })
  const [skippedRows, setSkippedRows] = useState([])

  const selectFile = (nextFile) => {
    setFile(nextFile)
    setUploadState({ status: 'idle', message: '' })
    setSkippedRows([])
  }

  const handleUpload = async () => {
    if (!file) return
    setUploadState({ status: 'loading', message: '' })
    setSkippedRows([])
    try {
      const result = await customersApi.bulkUpload(file)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped — see the log below.` : ''
      setUploadState({ status: 'success', message: `Created ${result.count} customer${result.count === 1 ? '' : 's'}.${skippedNote}` })
      setSkippedRows(result.skippedRows ?? [])
      setFile(null)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message })
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const blob = await customersApi.downloadBulkUploadTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'customers_upload_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message || 'Could not download the template.' })
    }
  }

  const handleDownloadSkipLog = () => {
    downloadCsv('customer_upload_skipped.csv', [
      { key: 'row', label: 'Row' }, { key: 'mobile', label: 'Mobile' }, { key: 'name', label: 'Name' }, { key: 'reason', label: 'Reason' },
    ], skippedRows)
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Customer Upload</h2>
      </div>

      {canEdit && (
        <div className="infinity-sync__card">
          <p className="infinity-sync__card-desc">
            Upload an Excel file to bulk-create customers. Required columns: <code>customer_type</code>, <code>name</code>, <code>mobile</code>, <code>division_code</code>.
            Rows are created at "Awaiting Final Approval" — rows with a missing/invalid field, an invalid <code>customer_type</code>, or a missing/invalid/duplicate mobile number are skipped, not uploaded.
          </p>
          <ExcelDropzone value={file} onChange={selectFile} />
          <button
            type="button"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={!file || uploadState.status === 'loading'}
            onClick={handleUpload}
          >
            {uploadState.status === 'loading' ? 'Uploading…' : 'Upload'}
          </button>
          {uploadState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{uploadState.message}</p>}
          {uploadState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{uploadState.message}</p>}
          {skippedRows.length > 0 && (
            <button type="button" className="infinity-sync__history-link" onClick={handleDownloadSkipLog}>
              Download skip log ({skippedRows.length} row{skippedRows.length === 1 ? '' : 's'})
            </button>
          )}
          <button type="button" className="infinity-sync__history-link" onClick={handleDownloadTemplate}>
            Download sample template
          </button>
        </div>
      )}
    </section>
  )
}

// ── Customer Outstanding (read-only view of Excel-uploaded SAP balances) ────

const CUSTOMER_OUTSTANDING_PAGE_SIZE = 10

function CustomerOutstandingPanel({ divisionCode, onBack }) {
  const [balances, setBalances] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [outstandingFile, setOutstandingFile] = useState(null)
  const [outstandingUploadState, setOutstandingUploadState] = useState({ status: 'idle', message: '' })
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  const loadBalances = () => {
    setLoading(true)
    setLoadError(null)
    customerOutstandingApi.list({ division_code: divisionCode })
      .then(setBalances)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadBalances()
  }, [divisionCode])

  useEffect(() => {
    setPage(1)
  }, [search])

  const handleUploadOutstanding = async () => {
    if (!outstandingFile) return
    setOutstandingUploadState({ status: 'loading', message: '' })
    try {
      const result = await customerOutstandingApi.upload(outstandingFile, divisionCode)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped (missing or invalid data).` : ''
      setOutstandingUploadState({ status: 'success', message: `Imported ${result.count} record${result.count === 1 ? '' : 's'}.${skippedNote}` })
      setOutstandingFile(null)
      loadBalances()
    } catch (err) {
      setOutstandingUploadState({ status: 'error', message: err.message })
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const blob = await customerOutstandingApi.downloadTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'customer_outstanding_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setOutstandingUploadState({ status: 'error', message: err.message || 'Could not download the template.' })
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? balances.filter(b =>
        (b.customerCode ?? '').toLowerCase().includes(q) ||
        (b.customerName ?? '').toLowerCase().includes(q) ||
        (b.sapCustomerCode ?? '').toLowerCase().includes(q)
      )
    : balances

  const sorted = sortRows(filtered, sort.key, sort.dir, (b, k) => k === 'outstandingAmount' ? Number(b.outstandingAmount) || 0 : b[k] ?? '')
  const totalPages = Math.max(1, Math.ceil(filtered.length / CUSTOMER_OUTSTANDING_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * CUSTOMER_OUTSTANDING_PAGE_SIZE, currentPage * CUSTOMER_OUTSTANDING_PAGE_SIZE)

  return (
    <section className="dash-section">
      {onBack && (
        <button type="button" className="field-users__back" onClick={onBack}>
          ← Infinity Master Sync
        </button>
      )}
      <div className="dash-section__header">
        <h2 className="dash-section__title">Customer Outstanding</h2>
      </div>

      <div className="infinity-sync__card" style={{ marginBottom: '1.5rem' }}>
        <p className="infinity-sync__card-desc">
          Upload an Excel file with columns <code>customerid</code>, <code>sap_customer_code</code>, <code>outstanding_amount</code> — rows are matched by SAP code and update existing balances for your division.
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => { setOutstandingFile(e.target.files?.[0] ?? null); setOutstandingUploadState({ status: 'idle', message: '' }) }}
        />
        <button
          type="button"
          className="tm-actions__btn tm-actions__btn--primary"
          disabled={!outstandingFile || outstandingUploadState.status === 'loading'}
          onClick={handleUploadOutstanding}
        >
          {outstandingUploadState.status === 'loading' ? 'Uploading…' : 'Upload'}
        </button>
        {outstandingUploadState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{outstandingUploadState.message}</p>}
        {outstandingUploadState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{outstandingUploadState.message}</p>}
        <button type="button" className="infinity-sync__history-link" onClick={handleDownloadTemplate}>
          Download sample template
        </button>
      </div>

      <div className="dash-section__header">
        <div className="field-users__header-actions">
          <input
            className="field-users__search"
            type="search"
            placeholder="Search by customer code, name, or SAP code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="aq__empty">Loading customer outstanding balances…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load customer outstanding balances: {loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">
          {balances.length === 0 ? 'No customer outstanding balances uploaded yet.' : 'No records match your search.'}
        </p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <SortableTh label="Customer Code" sortKey="customerCode" active={sort.key === 'customerCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Customer Name" sortKey="customerName" active={sort.key === 'customerName'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="SAP Customer Code" sortKey="sapCustomerCode" active={sort.key === 'sapCustomerCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Outstanding Amount" sortKey="outstandingAmount" active={sort.key === 'outstandingAmount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />
                </tr>
              </thead>
              <tbody>
                {paginated.map(b => (
                  <tr key={b.customerId}>
                    <td className="dash-table__td-id">{b.customerCode}</td>
                    <td className="dash-table__td-name">{b.customerName ?? '—'}</td>
                    <td>{b.sapCustomerCode ?? '—'}</td>
                    <td className="dash-table__td-num">{formatCurrency(b.outstandingAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className="field-users__pagination-info">
                Page {currentPage} of {totalPages} · {filtered.length} record{filtered.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Admin User Details (login accounts for admin / cfa / mm / dm) ───────────

const ADMIN_USER_ROLES = [
  { value: 'admin',   label: 'Admin' },
  { value: 'bu-head', label: 'BU Head' },
  { value: 'cfa',     label: 'CFA' },
  { value: 'mm',      label: 'Marketing Manager (MM)' },
  { value: 'dm',      label: 'Distribution Manager (DM)' },
]
const EMPTY_ADMIN_USER_FORM = {
  usertype: 'admin', name: '', mobileno: '', email: '', empCode: '',
  password: '', divisionCode: '', isActive: true, cfaCodes: [], cfaCode: '',
}
const ADMIN_USERS_PAGE_SIZE = 10
const CFA_SCOPED_ROLES = ['dm', 'mm']

// CFA location picker for cfa accounts — a single location, unlike CfaMultiSelect's
// dm/mm many-to-many assignment below. Not scoped to a division (cfa_locations are
// global) since cfa accounts pick their working division after login, not here.
function CfaLocationSelect({ value, onChange }) {
  const [cfaLocations, setCfaLocations] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    cfaApi.list()
      .then(rows => { if (!cancelled) setCfaLocations(rows) })
      .catch(() => { if (!cancelled) setCfaLocations([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <label className="product-form__field">
      <span>CFA Location</span>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={loading}>
        {loading && <option value="">Loading…</option>}
        {!loading && !value && <option value="" disabled>Select a CFA location…</option>}
        {!loading && cfaLocations.map(c => (
          <option key={c.cfaCode} value={c.cfaCode}>{c.cfaName} ({c.cfaCode})</option>
        ))}
      </select>
    </label>
  )
}

// CFA picker for dm/mm — one flat, deduplicated list of every CFA mapped in
// cfa_state_master (division-independent — a dm/mm's assignable CFAs are no
// longer scoped to any one division).
function CfaMultiSelect({ selected, onChange }) {
  const [allMappings, setAllMappings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    cfaStateMasterApi.list()
      .then(rows => { if (!cancelled) setAllMappings(rows) })
      .catch(() => { if (!cancelled) setAllMappings([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const cfaOptions = useMemo(() => {
    const seen = new Map()
    for (const row of allMappings) {
      if (!seen.has(row.cfaCode)) seen.set(row.cfaCode, row.cfaName)
    }
    return [...seen.entries()].map(([cfaCode, cfaName]) => ({ cfaCode, cfaName })).sort((a, b) => a.cfaName.localeCompare(b.cfaName))
  }, [allMappings])

  const toggle = (cfaCode) => {
    onChange(selected.includes(cfaCode) ? selected.filter(c => c !== cfaCode) : [...selected, cfaCode])
  }

  return (
    <label className="product-form__field">
      <span>Assigned CFAs</span>
      <div className="cfa-multiselect">
        {loading ? (
          <span className="cfa-multiselect__hint">Loading CFAs…</span>
        ) : cfaOptions.length === 0 ? (
          <span className="cfa-multiselect__hint">No CFAs mapped yet — contact admin to configure cfa_state_master.</span>
        ) : (
          cfaOptions.map(({ cfaCode, cfaName }) => (
            <label key={cfaCode} className="cfa-multiselect__option">
              <input type="checkbox" checked={selected.includes(cfaCode)} onChange={() => toggle(cfaCode)} />
              <span>{cfaName} ({cfaCode})</span>
            </label>
          ))
        )}
      </div>
    </label>
  )
}

function AdminUserFormDialog({ title, form, setForm, onSubmit, onCancel, saving, error, isEdit }) {
  const { user } = useAuth()
  const isSuperAdmin = user?.usertype === 'super-admin'
  // CFA-role creation is disabled from this screen — 'cfa' is only kept as a
  // selectable option while editing a user who is already that role, so an
  // existing CFA account still displays/saves correctly instead of showing
  // a blank Role field.
  const roleOptions = ADMIN_USER_ROLES.filter(r => r.value !== 'cfa' || form.usertype === 'cfa')
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{title}</h3>
        <form onSubmit={onSubmit}>
          <div className="product-form__row">
            <label className="product-form__field">
              <span>Role</span>
              <select value={form.usertype} onChange={e => {
                const usertype = e.target.value
                setForm(f => ({ ...f, usertype, ...(usertype === 'cfa' ? { empCode: '' } : {}) }))
              }}>
                {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            {form.usertype !== 'cfa' && (
              <label className="product-form__field">
                <span>Emp Code</span>
                <input required value={form.empCode} onChange={e => setForm(f => ({ ...f, empCode: e.target.value }))} />
              </label>
            )}
          </div>
          <label className="product-form__field">
            <span>Division</span>
            <DivisionSelect
              value={form.divisionCode}
              onChange={code => setForm(f => ({ ...f, divisionCode: code }))}
              allowAll={false}
              disabled={!isSuperAdmin}
            />
            {!isSuperAdmin && (
              <span className="cfa-multiselect__hint">Locked to your own division</span>
            )}
          </label>
          {form.usertype === 'cfa' && (
            <CfaLocationSelect
              value={form.cfaCode}
              onChange={code => setForm(f => ({ ...f, cfaCode: code }))}
            />
          )}
          {CFA_SCOPED_ROLES.includes(form.usertype) && (
            <CfaMultiSelect
              selected={form.cfaCodes}
              onChange={codes => setForm(f => ({ ...f, cfaCodes: codes }))}
            />
          )}
          <label className="product-form__field">
            <span>Name</span>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="product-form__row">
            <label className="product-form__field">
              <span>Mobile No</span>
              <input required inputMode="numeric" maxLength={10} value={form.mobileno} onChange={e => setForm(f => ({ ...f, mobileno: e.target.value }))} />
            </label>
            <label className="product-form__field">
              <span>Email</span>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
          </div>
          <div className="product-form__field">
            <span>{isEdit ? 'New Password' : 'Password'}</span>
            <input
              type="password"
              required={!isEdit}
              placeholder={isEdit ? 'Leave blank to keep current password' : ''}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            />
            {form.password && (
              <ul className="admin-pwd-rules">
                {getPasswordRules(form.password).map(r => (
                  <li key={r.label} className={`admin-pwd-rule${r.ok ? ' admin-pwd-rule--ok' : ''}`}>
                    <span aria-hidden="true">{r.ok ? '✓' : '○'}</span> {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="product-form__field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }}
            />
            <span>Active</span>
          </label>

          {error && <p className="product-form__error">{error}</p>}

          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Admin Overview / Home panel ───────────────────────────────────────────────

function StatCard({ label, value, subValue, variant }) {
  return (
    <div className={`admin-stat-card${variant ? ` admin-stat-card--${variant}` : ''}`}>
      <div className="admin-stat-card__row">
        <span className="admin-stat-card__value">{value ?? 0}</span>
        {subValue != null && <>
          <span className="admin-stat-card__sep">/</span>
          <span className="admin-stat-card__sub">{subValue}</span>
        </>}
      </div>
      <div className="admin-stat-card__label">{label}</div>
    </div>
  )
}

function MonthMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const allSelected = selected.length === 0
  const label = allSelected
    ? 'All time'
    : selected.length === 1
      ? monthKeyLabel(selected[0])
      : `${selected.length} months`

  function toggleAll() { onChange([]) }
  function toggle(key) {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key])
  }

  return (
    <div className="month-picker" ref={ref}>
      <button type="button" className="month-picker__trigger" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="month-picker__panel">
          <label className="month-picker__option month-picker__option--all">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            All time
          </label>
          {options.map(o => (
            <label key={o.key} className="month-picker__option">
              <input type="checkbox" checked={selected.includes(o.key)} onChange={() => toggle(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function AdminOverviewPanel({ divisionCode }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selectedMonths, setSelectedMonths] = useState([])  // [] = all time

  const monthOptions = useMemo(() => {
    const opts = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({ key, label: monthKeyLabel(key) })
    }
    return opts
  }, [])

  const [zones, setZones]             = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [zoneSort, setZoneSort] = useState({ key: '', dir: 'asc' })
  const [productSort, setProductSort] = useState({ key: '', dir: 'asc' })
  const [customerSort, setCustomerSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    if (!divisionCode) return
    setLoading(true)
    setError(null)
    overviewApi.get(divisionCode, selectedMonths.length ? selectedMonths : undefined)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [divisionCode, selectedMonths])

  useEffect(() => {
    if (!divisionCode) return
    setZonesLoading(true)
    overviewApi.zones(divisionCode)
      .then(setZones)
      .catch(() => setZones([]))
      .finally(() => setZonesLoading(false))
  }, [divisionCode])

  const o = data?.orders    ?? { total: 0, pendingL1: 0, approvedL1: 0, approved: 0, rejected: 0,
                                  totalValue: 0, pendingL1Value: 0, approvedL1Value: 0, approvedValue: 0, rejectedValue: 0 }
  const c = data?.customers ?? { total: 0, pendingL1: 0, approvedL1: 0, approved: 0, rejected: 0 }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Overview</h2>
        <MonthMultiSelect options={monthOptions} selected={selectedMonths} onChange={setSelectedMonths} />
      </div>

      {loading && <p className="aq__empty">Loading overview…</p>}
      {error   && <p className="aq__empty">Failed to load: {error}</p>}

      {!loading && !error && data && (
        <>
          {/* ── Orders stat row ── */}
          <div className="admin-overview__stat-group">
            <p className="admin-overview__stat-label">Orders</p>
            <div className="admin-overview__stat-grid">
              <StatCard label="Total"    value={o.total}                    subValue={formatCurrency(o.totalValue)} />
              <StatCard label="Pending"  value={o.pendingL1 + o.approvedL1} subValue={formatCurrency(o.pendingL1Value + o.approvedL1Value)} variant="pending" />
              <StatCard label="Approved" value={o.approved}                  subValue={formatCurrency(o.approvedValue)}  variant="approved" />
              <StatCard label="Rejected" value={o.rejected}                  subValue={formatCurrency(o.rejectedValue)}  variant="rejected" />
            </div>
          </div>

          {/* ── Customers stat row ── */}
          <div className="admin-overview__stat-group">
            <p className="admin-overview__stat-label">Customers</p>
            <div className="admin-overview__stat-grid">
              <StatCard label="Total"    value={c.total} />
              <StatCard label="Pending"  value={c.pendingL1 + c.approvedL1} variant="pending" />
              <StatCard label="Approved" value={c.approved}                  variant="approved" />
              <StatCard label="Rejected" value={c.rejected}                  variant="rejected" />
            </div>
          </div>

          {/* ── Zones table ── */}
          <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Zones <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
            </h3>
            {zonesLoading ? (
              <p className="aq__empty">Loading…</p>
            ) : zones.length === 0 ? (
              <p className="aq__empty">No data available.</p>
            ) : (
              <div className="dash-table-scroll">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <SortableTh label="Zone Name" sortKey="zone_name" active={zoneSort.key === 'zone_name'} dir={zoneSort.dir} onSort={k => toggleSort(setZoneSort, k)} />
                      <SortableTh label="ZSM Name" sortKey="zsm_name" active={zoneSort.key === 'zsm_name'} dir={zoneSort.dir} onSort={k => toggleSort(setZoneSort, k)} />
                      <SortableTh label="Customers" sortKey="customer_count" active={zoneSort.key === 'customer_count'} dir={zoneSort.dir} onSort={k => toggleSort(setZoneSort, k)} align="right" />
                      <SortableTh label="Orders" sortKey="order_count" active={zoneSort.key === 'order_count'} dir={zoneSort.dir} onSort={k => toggleSort(setZoneSort, k)} align="right" />
                      <SortableTh label="Order Value" sortKey="order_value" active={zoneSort.key === 'order_value'} dir={zoneSort.dir} onSort={k => toggleSort(setZoneSort, k)} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(zones, zoneSort.key, zoneSort.dir, (row, key) => {
                      if (key === 'zone_name' || key === 'zsm_name') return row[key] ?? ''
                      return Number(row[key]) || 0
                    }).map((row, i) => (
                      <tr key={i}>
                        <td className="dash-table__td-name">{row.zone_name ?? '—'}</td>
                        <td className="dash-table__td-name">{row.zsm_name ?? '—'}</td>
                        <td className="dash-table__td-num">{row.customer_count}</td>
                        <td className="dash-table__td-num">{row.order_count}</td>
                        <td className="dash-table__td-num">{formatCurrency(Number(row.order_value))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Top-5 tables ── */}
          <div className="admin-overview__top-grid">
            {/* Top 5 Products */}
            <div>
              <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                Top 5 Products <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
              </h3>
              {data.topProducts.length === 0 ? (
                <p className="aq__empty">No order data yet.</p>
              ) : (
                <div className="dash-table-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th className="dash-table__th">#</th>
                        <SortableTh label="Product" sortKey="productName" active={productSort.key === 'productName'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                        <SortableTh label="Code" sortKey="materialCode" active={productSort.key === 'materialCode'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} />
                        <SortableTh label="Qty" sortKey="totalQty" active={productSort.key === 'totalQty'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                        <SortableTh label="Value" sortKey="totalValue" active={productSort.key === 'totalValue'} dir={productSort.dir} onSort={k => toggleSort(setProductSort, k)} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(data.topProducts, productSort.key, productSort.dir, (r, k) => k === 'totalValue' || k === 'totalQty' ? Number(r[k]) || 0 : r[k]).map((p, i) => (
                        <tr key={p.productName + i}>
                          <td className="dash-table__td-id">{i + 1}</td>
                          <td className="dash-table__td-name">{p.productName}</td>
                          <td className="dash-table__td-id">{p.materialCode || '—'}</td>
                          <td className="dash-table__td-num">{p.totalQty}</td>
                          <td className="dash-table__td-num">{formatCurrency(Number(p.totalValue))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top 5 Customers */}
            <div>
              <h3 className="dash-section__title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                Top 5 Customers <span className="aq__count" style={{ fontSize: '0.65rem' }}>by order value</span>
              </h3>
              {data.topCustomers.length === 0 ? (
                <p className="aq__empty">No order data yet.</p>
              ) : (
                <div className="dash-table-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th className="dash-table__th">#</th>
                        <SortableTh label="Customer" sortKey="customerName" active={customerSort.key === 'customerName'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                        <SortableTh label="Type" sortKey="customerType" active={customerSort.key === 'customerType'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} />
                        <SortableTh label="Orders" sortKey="orderCount" active={customerSort.key === 'orderCount'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                        <SortableTh label="Value" sortKey="totalValue" active={customerSort.key === 'totalValue'} dir={customerSort.dir} onSort={k => toggleSort(setCustomerSort, k)} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(data.topCustomers, customerSort.key, customerSort.dir, (r, k) => k === 'totalValue' || k === 'orderCount' ? Number(r[k]) || 0 : r[k]).map((c, i) => (
                        <tr key={c.customerName + i}>
                          <td className="dash-table__td-id">{i + 1}</td>
                          <td className="dash-table__td-name">{c.customerName}</td>
                          <td>{USERTYPE_LABELS[c.customerType] ?? c.customerType}</td>
                          <td className="dash-table__td-num">{c.orderCount}</td>
                          <td className="dash-table__td-num">{formatCurrency(Number(c.totalValue))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ── Locked Users panel ────────────────────────────────────────────────────────

function LockedUsersPanel({ divisionCode }) {
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [unlocking, setUnlocking] = useState(null) // userId being unlocked
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  const fetchLocked = () => {
    setLoading(true)
    setLoadError(null)
    lockedUsersApi.list(divisionCode)
      .then(setUsers)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(fetchLocked, [divisionCode])

  const handleUnlock = async (userId) => {
    setUnlocking(userId)
    try {
      await lockedUsersApi.unlock(userId)
      fetchLocked()
    } catch (err) {
      alert(`Failed to unlock: ${err.message}`)
    } finally {
      setUnlocking(null)
    }
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Locked Users</h2>
        <button type="button" className="btn-outline-sm" onClick={fetchLocked} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="aq__empty">Loading…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load: {loadError}</p>
      ) : users.length === 0 ? (
        <p className="aq__empty">No locked accounts.</p>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Mobile" sortKey="mobileno" active={sort.key === 'mobileno'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Role" sortKey="usertype" active={sort.key === 'usertype'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Division" sortKey="division_code" active={sort.key === 'division_code'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Locked At" sortKey="locked_at" active={sort.key === 'locked_at'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Failed Attempts" sortKey="failed_attempts" active={sort.key === 'failed_attempts'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <th className="dash-table__th">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortRows(users, sort.key, sort.dir, (u, k) => {
                if (k === 'locked_at') return new Date(u.locked_at).getTime() || 0
                if (k === 'failed_attempts') return Number(u.failed_attempts) || 0
                return u[k] ?? ''
              }).map(u => (
                <tr key={u.id}>
                  <td className="dash-table__td-name">{u.name}</td>
                  <td>{u.mobileno}</td>
                  <td>{USERTYPE_LABELS[u.usertype] ?? u.usertype}</td>
                  <td>{u.division_code || '—'}</td>
                  <td>{fmtDate(u.locked_at)}</td>
                  <td style={{ textAlign: 'center' }}>{u.failed_attempts}</td>
                  <td>
                    <button
                      type="button"
                      className="confirm-dialog__btn confirm-dialog__btn--approve"
                      style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                      onClick={() => handleUnlock(u.id)}
                      disabled={unlocking === u.id}
                    >
                      {unlocking === u.id ? 'Unlocking…' : 'Unlock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AdminUserDetailsPanel({ divisionCode, onBack }) {
  const [adminUsers, setAdminUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null) // null | 'new' | admin user
  const [form, setForm] = useState(EMPTY_ADMIN_USER_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [deleting, setDeleting] = useState(null) // admin user pending delete confirmation
  const [deleteError, setDeleteError] = useState(null)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    adminUserDetailsApi.list(divisionCode ? { division_code: divisionCode } : {})
      .then(setAdminUsers)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [divisionCode])

  useEffect(() => {
    setPage(1)
  }, [search])

  const openNew = () => {
    setForm({ ...EMPTY_ADMIN_USER_FORM, divisionCode: divisionCode ?? '' })
    setSaveError(null)
    setEditing('new')
  }

  const openEdit = (u) => {
    setForm({
      usertype:           u.usertype,
      name:               u.name,
      mobileno:           u.mobileno,
      email:              u.email ?? '',
      empCode:            u.empCode ?? '',
      password:           '',
      divisionCode:       u.divisionCode ?? '',
      isActive:           u.isActive,
      cfaCodes:           u.cfaCodes ?? [],
      cfaCode:            u.cfaCode ?? '',
    })
    setSaveError(null)
    setEditing(u)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const mobileno = form.mobileno.trim()
    const email = form.email.trim()
    if (!PATTERNS.mobile.test(mobileno)) {
      setSaveError('Enter a valid 10-digit Indian mobile number')
      return
    }
    if (!PATTERNS.email.test(email)) {
      setSaveError('Enter a valid email address')
      return
    }
    setSaving(true)
    setSaveError(null)
    const payload = {
      usertype:             form.usertype,
      name:                 form.name.trim(),
      mobileno,
      email,
      emp_code:             form.empCode.trim(),
      division_code:        form.divisionCode || null,
      is_active:            form.isActive,
      cfa_codes:            CFA_SCOPED_ROLES.includes(form.usertype) ? form.cfaCodes : [],
      cfa_code:             form.usertype === 'cfa' ? (form.cfaCode || null) : null,
    }
    if (form.password) payload.password = form.password
    try {
      if (editing === 'new') {
        const created = await adminUserDetailsApi.create(payload)
        setAdminUsers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      } else {
        const updated = await adminUserDetailsApi.update(editing.id, payload)
        setAdminUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
      }
      setEditing(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await adminUserDetailsApi.remove(deleting.id)
      setAdminUsers(prev => prev.filter(u => u.id !== deleting.id))
      setDeleting(null)
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(null)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? adminUsers.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.usertype.toLowerCase().includes(q) ||
        u.mobileno.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
      )
    : adminUsers

  const sorted = sortRows(filtered, sort.key, sort.dir, (u, k) => {
    if (k === 'cfaCodes') return (u.cfaCodes?.length ? u.cfaCodes.join(', ') : '')
    if (k === 'isActive') return u.isActive ? 1 : 0
    return u[k] ?? ''
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / ADMIN_USERS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * ADMIN_USERS_PAGE_SIZE, currentPage * ADMIN_USERS_PAGE_SIZE)

  return (
    <section className="dash-section">
      {onBack && (
        <button type="button" className="field-users__back" onClick={onBack}>
          ← Infinity Master Sync
        </button>
      )}
      <div className="dash-section__header">
        <h2 className="dash-section__title">Admin User Details</h2>
        <div className="field-users__header-actions">
          <input
            className="field-users__search"
            type="search"
            placeholder="Search by name, role, mobile, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={openNew}>
            + Add User
          </button>
        </div>
      </div>

      {deleteError && <p className="product-form__error">{deleteError}</p>}

      {loading ? (
        <p className="aq__empty">Loading admin user details…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load admin user details: {loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">
          {adminUsers.length === 0 ? 'No admin users found yet.' : 'No users match your search.'}
        </p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Emp Code" sortKey="empCode" active={sort.key === 'empCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Role" sortKey="usertype" active={sort.key === 'usertype'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Mobile" sortKey="mobileno" active={sort.key === 'mobileno'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Email" sortKey="email" active={sort.key === 'email'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Division" sortKey="divisionCode" active={sort.key === 'divisionCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="CFAs" sortKey="cfaCodes" active={sort.key === 'cfaCodes'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Status" sortKey="isActive" active={sort.key === 'isActive'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
                </tr>
              </thead>
              <tbody>
                {paginated.map(u => (
                  <tr key={u.id}>
                    <td className="dash-table__td-name">{u.name}</td>
                    <td>{u.empCode}</td>
                    <td><span className="aq__row-tag">{ADMIN_USER_ROLES.find(r => r.value === u.usertype)?.label ?? u.usertype}</span></td>
                    <td>{u.mobileno}</td>
                    <td>{u.email || '—'}</td>
                    <td>{u.divisionCode || 'All divisions'}</td>
                    <td>{CFA_SCOPED_ROLES.includes(u.usertype) ? (u.cfaCodes?.length ? u.cfaCodes.join(', ') : 'None assigned') : '—'}</td>
                    <td>
                      <span className={`aq__status ${u.isActive ? 'aq__status--approved' : 'aq__status--rejected'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="dash-table__td-actions field-users__actions-col">
                      <div className="aq__row-actions">
                        <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(u)}>Edit</button>
                        <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(u)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ← Prev
              </button>
              <span className="field-users__pagination-info">
                Page {currentPage} of {totalPages} · {filtered.length} user{filtered.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="aq__btn aq__btn--view"
                disabled={currentPage === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {editing && (
        <AdminUserFormDialog
          title={editing === 'new' ? 'Add Admin User' : `Edit: ${editing.name}`}
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
          saving={saving}
          error={saveError}
          isEdit={editing !== 'new'}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Remove ${deleting.name} and revoke their login access?`}
          confirmLabel="Delete"
          confirmVariant="reject"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

// ── Division rules (admin-managed approval workflow / order-entry / document config) ──

const CUSTOMER_TYPE_LABELS = {
  patient: 'Patient',
  doctor: 'Doctor',
  'doctor-pharmacy': 'Doctor / Pharmacy',
  hospital: 'Hospital',
}

const ALL_CUSTOMER_TYPES = ['patient', 'doctor', 'doctor-pharmacy', 'hospital']

const EMPTY_DIVISION_RULE_FORM = {
  divisionCode: '',
  orderSteps: [
    { label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'] },
    { label: 'Marketing Approval', approverRoles: ['mm'] },
  ],
  customerSteps: [
    { label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'] },
    { label: 'Distribution Approval', approverRoles: ['dm'] },
  ],
  showPrices: true,
  minOrderValue: '0',
  minOrderValueByType: { patient: '0', doctor: '0', 'doctor-pharmacy': '0', hospital: '0' },
  outstandingLimitByType: { patient: '0', doctor: '0', 'doctor-pharmacy': '0', hospital: '0' },
  paymentOptions: [],
  allowedCustomerTypes: [...ALL_CUSTOMER_TYPES],
  allowedLoginCustomerTypes: [...ALL_CUSTOMER_TYPES],
  // Mirrors backend DEFAULT_RULES.documents (backend/src/config/divisionRules.js) —
  // locked: true so a brand-new division starts with a complete, typo-proof
  // document list (see DocumentListEditor); labels/required stay editable, and
  // rows can still be added (fresh, typable key) or removed.
  customerDocs: {
    patient: [],
    doctor: [
      { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true, locked: true },
      { key: 'panCopy', label: 'PAN Copy', required: false, locked: true },
      { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false, locked: true },
    ],
    'doctor-pharmacy': [
      { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true, locked: true },
      { key: 'gstCertificate', label: 'GST Certificate', required: true, locked: true },
      { key: 'panCopy', label: 'PAN Copy', required: false, locked: true },
      { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false, locked: true },
    ],
    hospital: [
      { key: 'signedRegistrationForm', label: 'Customer Signed Registration Form', required: true, locked: true },
      { key: 'gstCertificate', label: 'GST Certificate', required: true, locked: true },
      { key: 'hospitalRegistrationCertificate', label: 'Hospital Registration Certificate', required: true, locked: true },
      { key: 'drugLicenceCertificate', label: 'Drug Licence Certificate', required: true, locked: true },
      { key: 'panCopy', label: 'PAN Copy', required: false, locked: true },
      { key: 'aadhaarCopy', label: 'Aadhaar Copy', required: false, locked: true },
    ],
  },
  orderDocs: [
    { key: 'signedOrderCopy', label: 'Signed Order Copy', required: true, locked: true },
  ],
}

// Strip fromStatus/toStatus (derived, not editable) down to the {label, approverRoles} shape the step editor works with.
function toEditableSteps(workflow) {
  return workflow.steps.map(s => ({ label: s.label, approverRoles: s.approverRoles }))
}

// Marks every document row from an already-saved rule as `locked` — the key
// input becomes read-only for these (see DocumentListEditor) since the key is
// already established; a row added fresh via "+ Add document" has no `locked`
// flag and stays typable. Stripped back off before submit (see handleSubmit).
function lockDocs(docs) {
  return docs.map(d => ({ ...d, locked: true }))
}

// Maps a rules object (orderWorkflow/customerWorkflow/orderEntry/documents/
// allowedCustomerTypes — the shape divisionRulesApi.get/list/create/update
// return) into the editable form field shape used by DivisionRuleFormDialog.
// Deliberately excludes divisionCode — callers own that field.
function rulesToFormFields(rules) {
  const byType = rules.orderEntry.minOrderValueByType ?? {}
  const outByType = rules.orderEntry.outstandingLimitByType ?? {}
  return {
    orderSteps: toEditableSteps(rules.orderWorkflow),
    customerSteps: toEditableSteps(rules.customerWorkflow),
    showPrices: rules.orderEntry.showPrices,
    minOrderValue: String(rules.orderEntry.minOrderValue ?? 0),
    minOrderValueByType: {
      patient:          String(byType.patient ?? 0),
      doctor:           String(byType.doctor ?? 0),
      'doctor-pharmacy': String(byType['doctor-pharmacy'] ?? 0),
      hospital:         String(byType.hospital ?? 0),
    },
    outstandingLimitByType: {
      patient:          String(outByType.patient ?? 0),
      doctor:           String(outByType.doctor ?? 0),
      'doctor-pharmacy': String(outByType['doctor-pharmacy'] ?? 0),
      hospital:         String(outByType.hospital ?? 0),
    },
    paymentOptions: rules.orderEntry.paymentOptions,
    allowedCustomerTypes: rules.allowedCustomerTypes ?? [...ALL_CUSTOMER_TYPES],
    allowedLoginCustomerTypes: rules.allowedLoginCustomerTypes ?? [...ALL_CUSTOMER_TYPES],
    customerDocs: Object.fromEntries(
      Object.entries(rules.documents.customer).map(([type, docs]) => [type, lockDocs(docs)])
    ),
    orderDocs: lockDocs(rules.documents.order),
  }
}

// Re-derive fromStatus/toStatus from step position/count so the workflow editor can only ever
// produce the known status values (pending-l1, approved-l1, approved) — never free-typed.
function buildWorkflow(steps) {
  const statusPairs = steps.length === 1
    ? [{ from: 'pending-l1', to: 'approved' }]
    : [{ from: 'pending-l1', to: 'approved-l1' }, { from: 'approved-l1', to: 'approved' }]
  return {
    initialStatus: 'pending-l1',
    steps: steps.map((s, i) => ({
      step: i + 1,
      label: s.label.trim(),
      approverRoles: s.approverRoles,
      fromStatus: statusPairs[i].from,
      toStatus: statusPairs[i].to,
    })),
  }
}

function WorkflowStepEditor({ title, steps, onChange }) {
  const setStepCount = (count) => {
    if (count === steps.length) return
    onChange(count === 1 ? [steps[0]] : [steps[0], steps[1] ?? { label: '', approverRoles: [] }])
  }
  const updateStep = (idx, patch) => onChange(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  const toggleRole = (idx, role) => {
    const roles = steps[idx].approverRoles
    updateStep(idx, { approverRoles: roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role] })
  }

  return (
    <div className="div-rules__workflow">
      <h4 className="div-rules__section-title">{title}</h4>
      <div className="div-rules__step-count">
        <label>
          <input type="radio" checked={steps.length === 1} onChange={() => setStepCount(1)} />
          Single-step
        </label>
        <label>
          <input type="radio" checked={steps.length === 2} onChange={() => setStepCount(2)} />
          Two-step
        </label>
      </div>
      {steps.map((step, idx) => (
        <div className="div-rules__step" key={idx}>
          <label className="product-form__field">
            <span>Step {idx + 1} label</span>
            <input required value={step.label} onChange={e => updateStep(idx, { label: e.target.value })} />
          </label>
          <div className="div-rules__role-checks">
            {ALL_APPROVER_ROLES.map(role => (
              <label key={role} className="div-rules__role-check">
                <input type="checkbox" checked={step.approverRoles.includes(role)} onChange={() => toggleRole(idx, role)} />
                {role.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DocumentListEditor({ title, docs, onChange }) {
  const updateDoc = (idx, patch) => onChange(docs.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  const removeDoc = (idx) => onChange(docs.filter((_, i) => i !== idx))
  const addDoc = () => onChange([...docs, { key: '', label: '', required: false }])

  return (
    <div className="div-rules__doclist">
      <div className="div-rules__doclist-header">
        <span>{title}</span>
        <button type="button" className="product-form__brand-btn" title="Add document" onClick={addDoc}>+</button>
      </div>
      {docs.length === 0 ? (
        <p className="div-rules__doclist-empty">No documents required.</p>
      ) : (
        docs.map((doc, idx) => (
          <div className="div-rules__doc-row" key={idx}>
            <input
              placeholder="Key (e.g. panCopy)"
              value={doc.key}
              readOnly={Boolean(doc.locked)}
              className={doc.locked ? 'div-rules__doc-key--locked' : undefined}
              title={doc.locked ? 'Key is locked once set — remove and re-add this document to change it' : undefined}
              onChange={e => updateDoc(idx, { key: e.target.value })}
            />
            <input placeholder="Label (e.g. PAN Copy)" value={doc.label} onChange={e => updateDoc(idx, { label: e.target.value })} />
            <label className="div-rules__doc-required">
              <input type="checkbox" checked={doc.required} onChange={e => updateDoc(idx, { required: e.target.checked })} />
              Required
            </label>
            <button type="button" className="product-form__brand-btn" title="Remove document" onClick={() => removeDoc(idx)}>✕</button>
          </div>
        ))
      )}
    </div>
  )
}

function DivisionRuleFormDialog({ title, form, setForm, onSubmit, onCancel, saving, error, isEdit }) {
  const togglePaymentOption = (option) => {
    setForm(f => ({
      ...f,
      paymentOptions: f.paymentOptions.includes(option)
        ? f.paymentOptions.filter(o => o !== option)
        : [...f.paymentOptions, option],
    }))
  }

  const toggleAllowedType = (type) => {
    setForm(f => ({
      ...f,
      allowedCustomerTypes: f.allowedCustomerTypes.includes(type)
        ? f.allowedCustomerTypes.filter(t => t !== type)
        : [...f.allowedCustomerTypes, type],
    }))
  }

  const toggleAllowedLoginType = (type) => {
    setForm(f => ({
      ...f,
      allowedLoginCustomerTypes: f.allowedLoginCustomerTypes.includes(type)
        ? f.allowedLoginCustomerTypes.filter(t => t !== type)
        : [...f.allowedLoginCustomerTypes, type],
    }))
  }

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form div-rules__form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{title}</h3>
        <form onSubmit={onSubmit}>
          <label className="product-form__field">
            <span>Division Code <span className="product-form__req">*</span></span>
            <input required disabled={isEdit} value={form.divisionCode} onChange={e => setForm(f => ({ ...f, divisionCode: e.target.value }))} />
          </label>

          <WorkflowStepEditor title="Order Workflow" steps={form.orderSteps} onChange={steps => setForm(f => ({ ...f, orderSteps: steps }))} />
          <WorkflowStepEditor title="Customer Workflow" steps={form.customerSteps} onChange={steps => setForm(f => ({ ...f, customerSteps: steps }))} />

          <h4 className="div-rules__section-title">Allowed Customer Types</h4>
          <p className="div-rules__hint">Uncheck types to prevent registration in this division. At least one must remain checked.</p>
          <div className="div-rules__role-checks">
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([type, label]) => (
              <label key={type} className="div-rules__role-check">
                <input type="checkbox" checked={form.allowedCustomerTypes.includes(type)} onChange={() => toggleAllowedType(type)} />
                {label}
              </label>
            ))}
          </div>

          <h4 className="div-rules__section-title">Allow Customer Login</h4>
          <p className="div-rules__hint">Uncheck a type to block that customer type from logging in to this division — registration is unaffected.</p>
          <div className="div-rules__role-checks">
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([type, label]) => (
              <label key={type} className="div-rules__role-check">
                <input type="checkbox" checked={form.allowedLoginCustomerTypes.includes(type)} onChange={() => toggleAllowedLoginType(type)} />
                {label}
              </label>
            ))}
          </div>

          <h4 className="div-rules__section-title">Order Entry</h4>
          <label className="div-rules__role-check">
            <input type="checkbox" checked={form.showPrices} onChange={e => setForm(f => ({ ...f, showPrices: e.target.checked }))} />
            Show prices
          </label>
          <label className="product-form__field">
            <span>Default minimum order value (₹) — applies when no per-type value is set</span>
            <input type="number" min="0" step="1" value={form.minOrderValue} onChange={e => setForm(f => ({ ...f, minOrderValue: e.target.value }))} />
          </label>

          <p className="div-rules__hint" style={{ marginTop: '0.75rem' }}>Minimum order value by customer type (₹) — 0 = use default above</p>
          {Object.entries(CUSTOMER_TYPE_LABELS).map(([type, label]) => (
            <label key={type} className="product-form__field product-form__field--inline">
              <span>{label}</span>
              <input
                type="number" min="0" step="1"
                value={form.minOrderValueByType[type]}
                onChange={e => setForm(f => ({ ...f, minOrderValueByType: { ...f.minOrderValueByType, [type]: e.target.value } }))}
              />
            </label>
          ))}

          <p className="div-rules__hint" style={{ marginTop: '0.75rem' }}>Outstanding limit by customer type (₹) — 0 = no limit</p>
          {Object.entries(CUSTOMER_TYPE_LABELS).map(([type, label]) => (
            <label key={type} className="product-form__field product-form__field--inline">
              <span>{label}</span>
              <input
                type="number" min="0" step="1"
                value={form.outstandingLimitByType[type]}
                onChange={e => setForm(f => ({ ...f, outstandingLimitByType: { ...f.outstandingLimitByType, [type]: e.target.value } }))}
              />
            </label>
          ))}

          <div className="div-rules__role-checks" style={{ marginTop: '0.75rem' }}>
            {Object.entries(PAYMENT_OPTION_LABELS).map(([key, label]) => (
              <label key={key} className="div-rules__role-check">
                <input type="checkbox" checked={form.paymentOptions.includes(key)} onChange={() => togglePaymentOption(key)} />
                {label}
              </label>
            ))}
          </div>

          <h4 className="div-rules__section-title">Document Requirements</h4>
          {Object.entries(CUSTOMER_TYPE_LABELS).map(([type, label]) => (
            <DocumentListEditor
              key={type}
              title={`${label} registration documents`}
              docs={form.customerDocs[type]}
              onChange={docs => setForm(f => ({ ...f, customerDocs: { ...f.customerDocs, [type]: docs } }))}
            />
          ))}
          <DocumentListEditor
            title="Order documents"
            docs={form.orderDocs}
            onChange={docs => setForm(f => ({ ...f, orderDocs: docs }))}
          />

          {error && <p className="product-form__error">{error}</p>}

          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DivisionRulesPanel({ divisionCode }) {
  // Scoped mode (divisionCode set, either role): just that one division's rule —
  // a single record, or "using defaults" if none exists yet. Unscoped (admin's
  // "All Divisions"): today's full unfiltered table across every division.
  const [rules, setRules] = useState([])
  const [singleRule, setSingleRule] = useState(null) // scoped mode only: null | rule | 'none'
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | rule
  const [form, setForm] = useState(EMPTY_DIVISION_RULE_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  const loadRules = () => {
    setLoading(true)
    setLoadError(null)
    if (divisionCode) {
      divisionRulesApi.get(divisionCode)
        .then(setSingleRule)
        .catch(err => {
          if (err.message === 'Division rules not found') setSingleRule('none')
          else setLoadError(err.message)
        })
        .finally(() => setLoading(false))
    } else {
      divisionRulesApi.list()
        .then(setRules)
        .catch(err => setLoadError(err.message))
        .finally(() => setLoading(false))
    }
  }

  useEffect(() => {
    loadRules()
  }, [divisionCode])

  const openNew = () => {
    setForm({ ...EMPTY_DIVISION_RULE_FORM, divisionCode: divisionCode ?? '' })
    setSaveError(null)
    setEditing('new')
  }

  const openEdit = (rule) => {
    setForm({ divisionCode: rule.divisionCode, ...rulesToFormFields(rule) })
    setSaveError(null)
    setEditing(rule)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const allSteps = [...form.orderSteps, ...form.customerSteps]
    if (allSteps.some(s => !s.label.trim() || s.approverRoles.length === 0)) {
      setSaveError('Each workflow step needs a label and at least one approver role')
      return
    }
    setSaving(true)
    setSaveError(null)
    if (form.allowedCustomerTypes.length === 0) {
      setSaveError('At least one customer type must be allowed')
      setSaving(false)
      return
    }
    const payload = {
      order_workflow: buildWorkflow(form.orderSteps),
      customer_workflow: buildWorkflow(form.customerSteps),
      order_entry: {
        showPrices: form.showPrices,
        minOrderValue: Number(form.minOrderValue) || 0,
        minOrderValueByType: {
          patient:          Number(form.minOrderValueByType.patient) || 0,
          doctor:           Number(form.minOrderValueByType.doctor) || 0,
          'doctor-pharmacy': Number(form.minOrderValueByType['doctor-pharmacy']) || 0,
          hospital:         Number(form.minOrderValueByType.hospital) || 0,
        },
        outstandingLimitByType: {
          patient:          Number(form.outstandingLimitByType.patient) || 0,
          doctor:           Number(form.outstandingLimitByType.doctor) || 0,
          'doctor-pharmacy': Number(form.outstandingLimitByType['doctor-pharmacy']) || 0,
          hospital:         Number(form.outstandingLimitByType.hospital) || 0,
        },
        paymentOptions: form.paymentOptions,
      },
      // `locked` is UI-only (see rulesToFormFields/DocumentListEditor) — strip
      // it before persisting so it never lands in the documents JSONB column.
      documents: {
        customer: Object.fromEntries(
          Object.entries(form.customerDocs).map(([type, docs]) => [type, docs.map(({ key, label, required }) => ({ key, label, required }))])
        ),
        order: form.orderDocs.map(({ key, label, required }) => ({ key, label, required })),
      },
      allowed_customer_types: form.allowedCustomerTypes,
      allowed_login_customer_types: form.allowedLoginCustomerTypes,
    }
    try {
      let saved
      if (editing === 'new') {
        saved = await divisionRulesApi.create({ division_code: form.divisionCode.trim(), ...payload })
        if (!divisionCode) setRules(prev => [...prev, saved].sort((a, b) => a.divisionCode.localeCompare(b.divisionCode)))
      } else {
        saved = await divisionRulesApi.update(editing.divisionCode, payload)
        if (!divisionCode) setRules(prev => prev.map(r => (r.divisionCode === saved.divisionCode ? saved : r)))
      }
      if (divisionCode) setSingleRule(saved)
      setEditing(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await divisionRulesApi.remove(deleting.divisionCode)
      if (divisionCode) setSingleRule('none')
      else setRules(prev => prev.filter(r => r.divisionCode !== deleting.divisionCode))
      setDeleting(null)
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(null)
    }
  }

  const showHeaderAdd = divisionCode ? singleRule === 'none' : true

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">{divisionCode ? `Division Rules — ${divisionCode}` : 'Division Rules'}</h2>
        {showHeaderAdd && (
          <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={openNew}>
            + Add Division Rules
          </button>
        )}
      </div>

      {deleteError && <p className="product-form__error">{deleteError}</p>}

      {loading ? (
        <p className="aq__empty">Loading division rules…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load division rules: {loadError}</p>
      ) : divisionCode ? (
        singleRule === 'none' ? (
          <p className="aq__empty">No custom rules configured for {divisionCode} yet — it uses the default workflow.</p>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <th className="dash-table__th">Division Code</th>
                  <th className="dash-table__th">Order Steps</th>
                  <th className="dash-table__th">Customer Steps</th>
                  <th className="dash-table__th">Show Prices</th>
                  <th className="dash-table__th">Payment Options</th>
                  <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dash-table__td-id">{singleRule.divisionCode}</td>
                  <td>{singleRule.orderWorkflow.steps.length}</td>
                  <td>{singleRule.customerWorkflow.steps.length}</td>
                  <td>{singleRule.orderEntry.showPrices ? 'Yes' : 'No'}</td>
                  <td>
                    {singleRule.orderEntry.paymentOptions.length
                      ? singleRule.orderEntry.paymentOptions.map(o => PAYMENT_OPTION_LABELS[o] ?? o).join(', ')
                      : '—'}
                  </td>
                  <td className="dash-table__td-actions field-users__actions-col">
                    <div className="aq__row-actions">
                      <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(singleRule)}>Edit</button>
                      <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(singleRule)}>Delete</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      ) : rules.length === 0 ? (
        <p className="aq__empty">No divisions have custom rules configured yet — they use the default workflow.</p>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-table field-users__table">
            <thead>
              <tr>
                <SortableTh label="Division Code" sortKey="divisionCode" active={sort.key === 'divisionCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Order Steps" sortKey="orderSteps" active={sort.key === 'orderSteps'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Customer Steps" sortKey="customerSteps" active={sort.key === 'customerSteps'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Show Prices" sortKey="showPrices" active={sort.key === 'showPrices'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <SortableTh label="Payment Options" sortKey="paymentOptions" active={sort.key === 'paymentOptions'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
              </tr>
            </thead>
            <tbody>
              {sortRows(rules, sort.key, sort.dir, (rule, k) => {
                if (k === 'orderSteps') return rule.orderWorkflow.steps.length
                if (k === 'customerSteps') return rule.customerWorkflow.steps.length
                if (k === 'showPrices') return rule.orderEntry.showPrices ? 1 : 0
                if (k === 'paymentOptions') return rule.orderEntry.paymentOptions.map(o => PAYMENT_OPTION_LABELS[o] ?? o).join(', ')
                return rule[k] ?? ''
              }).map(rule => (
                <tr key={rule.divisionCode}>
                  <td className="dash-table__td-id">{rule.divisionCode}</td>
                  <td>{rule.orderWorkflow.steps.length}</td>
                  <td>{rule.customerWorkflow.steps.length}</td>
                  <td>{rule.orderEntry.showPrices ? 'Yes' : 'No'}</td>
                  <td>
                    {rule.orderEntry.paymentOptions.length
                      ? rule.orderEntry.paymentOptions.map(o => PAYMENT_OPTION_LABELS[o] ?? o).join(', ')
                      : '—'}
                  </td>
                  <td className="dash-table__td-actions field-users__actions-col">
                    <div className="aq__row-actions">
                      <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(rule)}>Edit</button>
                      <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(rule)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DivisionRuleFormDialog
          title={editing === 'new' ? `Add Division Rules${divisionCode ? ` for ${divisionCode}` : ''}` : `Edit ${editing.divisionCode}`}
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
          saving={saving}
          error={saveError}
          isEdit={editing !== 'new' || Boolean(divisionCode)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Remove the custom rules for ${deleting.divisionCode}? It will fall back to the default workflow.`}
          confirmLabel="Delete"
          confirmVariant="reject"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

// ── Admin Orders & Customers — read-only oversight, scoped to one division ───

// view/onViewChange are optional — when omitted the panel manages its own
// internal toggle (AdminDashboard's usage); when supplied, an external
// control (e.g. the CFA hamburger menu below) drives which table shows instead.
function AdminOrdersCustomersPanel({ divisionCode, view: viewProp, onViewChange: onViewChangeProp }) {
  const [internalView, setInternalView] = useState('orders')
  const view = viewProp ?? internalView
  const onViewChange = onViewChangeProp ?? setInternalView
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])

  useEffect(() => {
    ordersApi.list({ division_code: divisionCode }).then(setOrders).catch(() => setOrders([]))
    customersApi.list({ division_code: divisionCode }).then(setCustomers).catch(() => setCustomers([]))
  }, [divisionCode])

  const pendingOrders    = orders.filter(o => !['approved', 'rejected'].includes(o.approvalStatus))
  const pendingCustomers = customers.filter(c => !['approved', 'rejected'].includes(c.approvalStatus))

  return (
    <DivisionConfigProvider divisionCodeOverride={divisionCode}>
      {view === 'orders' && (
        <ApprovalTable
          view={view} onViewChange={onViewChange}
          title="Orders" badgeCount={pendingOrders.length} items={orders} type="order"
          defaultStatus="all" statusOptions={STATUS_KEYS} payNowOptions={[]}
          emptyText="No orders found for this division."
        />
      )}
      {view === 'customers' && (
        <ApprovalTable
          view={view} onViewChange={onViewChange}
          title="Customer Registrations" badgeCount={pendingCustomers.length} items={customers} type="customer" payNowOptions={[]}
          defaultStatus="all" statusOptions={STATUS_KEYS}
          emptyText="No customer registrations found for this division."
        />
      )}
    </DivisionConfigProvider>
  )
}

function AdminDashboard() {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  // SCM Admin is restricted to Product Master, Customer Upload, and CFA Records —
  // the only 3 areas it (and super-admin) can write to; admin/bu-head keep the
  // full menu but are view-only on those 3 (see the per-panel canEdit checks).
  const isScmAdmin = user.usertype === 'scm-admin'
  const SCM_ADMIN_MENU_KEYS = ['products', 'customer-upload', 'cfa-records']
  const [adminView, setAdminView] = useState(isScmAdmin ? 'products' : 'overview')
  const isSuperAdmin = user.usertype === 'super-admin'
  // Division Rules is super-admin only — admin no longer sees or can reach it.
  const menuItems = isScmAdmin
    ? ADMIN_MENU_ITEMS.filter(i => SCM_ADMIN_MENU_KEYS.includes(i.key))
    : isSuperAdmin ? ADMIN_MENU_ITEMS : ADMIN_MENU_ITEMS.filter(i => i.key !== 'division-rules')

  // admin is division-specific (one fixed division per account, enforced at
  // login — see auth.js) — no picker, just its own division, same as before
  // super-admin existed. super-admin (and now scm-admin, same reasoning — see
  // auth.js) has no division on its account at all and must actively choose
  // one every time this dashboard mounts (i.e. every login), via the gate
  // below — never an "All Divisions" option.
  const [selectedDivision, setSelectedDivision] = useState('')

  if ((isSuperAdmin || isScmAdmin) && !selectedDivision) {
    return (
      <div className="admin-dash admin-dash__gate">
        <h2 className="admin-dash__title">Select a division to continue</h2>
        <DivisionSelect value="" onChange={setSelectedDivision} allowAll={false} />
      </div>
    )
  }

  const divisionCode = (isSuperAdmin || isScmAdmin) ? selectedDivision : user.divisionCode

  return (
    <div className="admin-dash">
      <div className="admin-dash__bar">
        <div className="admin-dash__menu-wrap">
          <button
            type="button"
            className="admin-dash__hamburger"
            aria-label="Admin menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6 H21 M3 12 H21 M3 18 H21" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="admin-dash__backdrop" onClick={() => setMenuOpen(false)} />
              <div className="admin-dash__menu" role="menu">
                {menuItems.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className={`admin-dash__menu-item${adminView === item.key ? ' admin-dash__menu-item--active' : ''}`}
                    onClick={() => { setAdminView(item.key); setMenuOpen(false) }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <h2 className="admin-dash__title">{menuItems.find(i => i.key === adminView)?.label}</h2>
        {(isSuperAdmin || isScmAdmin) && (
          <DivisionSelect
            value={selectedDivision}
            onChange={setSelectedDivision}
            allowAll={false}
            className="admin-dash__division-select"
          />
        )}
      </div>

      {adminView === 'overview' && <AdminOverviewPanel divisionCode={divisionCode} />}
      {adminView === 'products' && <ProductMasterPanel divisionCode={divisionCode} />}
      {adminView === 'orders-customers' && <AdminOrdersCustomersPanel divisionCode={divisionCode} />}
      {adminView === 'customer-upload' && <CustomerUploadPanel />}
      {adminView === 'infinity-sync' && <InfinitySyncPanel divisionCode={divisionCode} />}
      {adminView === 'admin-user-details' && <AdminUserDetailsPanel divisionCode={divisionCode} />}
      {adminView === 'login-history' && <LoginHistoryPanel divisionCode={divisionCode} />}
      {adminView === 'locked-users' && <LockedUsersPanel divisionCode={divisionCode} />}
      {adminView === 'cfa-records' && <CfaRecordsPanel divisionCode={divisionCode} isSuperAdmin={isSuperAdmin || isScmAdmin} />}
      {adminView === 'email-test' && <EmailTestPanel />}
      {adminView === 'division-rules' && isSuperAdmin && <DivisionRulesPanel divisionCode={divisionCode} />}
    </div>
  )
}

// ── Email Test (admin: send a test email and inspect the outcome) ─────────────

const EMAIL_TEST_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function EmailTestPanel() {
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [log, setLog] = useState([]) // [{id, to, sentAt, success, error, previewUrl}]
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  const handleSend = async (e) => {
    e.preventDefault()
    const addr = to.trim()
    if (!EMAIL_TEST_PATTERN.test(addr)) return
    setSending(true)
    const sentAt = new Date()
    try {
      const result = await emailTestApi.send(addr)
      setLog(prev => [{
        id:         sentAt.getTime(),
        to:         result.to,
        sentAt:     result.sentAt ?? sentAt.toISOString(),
        success:    result.success,
        error:      result.error ?? null,
        previewUrl: result.previewUrl ?? null,
      }, ...prev])
    } catch (err) {
      setLog(prev => [{
        id:      sentAt.getTime(),
        to:      addr,
        sentAt:  sentAt.toISOString(),
        success: false,
        error:   err.message,
        previewUrl: null,
      }, ...prev])
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Email Test</h2>
      </div>

      <div className="infinity-sync__card" style={{ marginBottom: '2rem', maxWidth: 520 }}>
        <p className="infinity-sync__card-desc">
          Send a test email to verify your SMTP configuration is working. The server will send a plain HTML message and report the outcome below.
        </p>
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <input
            type="email"
            className="field-users__search"
            style={{ flex: '1 1 260px', minWidth: 0 }}
            placeholder="Enter email address…"
            value={to}
            onChange={e => setTo(e.target.value)}
            disabled={sending}
            required
          />
          <button
            type="submit"
            className="tm-actions__btn tm-actions__btn--primary"
            disabled={sending || !to.trim()}
          >
            {sending ? 'Sending…' : 'Send Test Email'}
          </button>
        </form>
      </div>

      {log.length > 0 && (
        <>
          <div className="dash-section__header" style={{ marginBottom: '0.75rem' }}>
            <h3 style={{ font: '600 0.78rem/1 var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-faint)', margin: 0 }}>
              Send Log ({log.length})
            </h3>
            <button type="button" className="btn-outline-sm" onClick={() => setLog([])}>Clear</button>
          </div>
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <SortableTh label="Time" sortKey="sentAt" active={sort.key === 'sentAt'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Recipient" sortKey="to" active={sort.key === 'to'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Status" sortKey="success" active={sort.key === 'success'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th">Detail</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(log, sort.key, sort.dir, (entry, k) => {
                  if (k === 'sentAt') return new Date(entry.sentAt).getTime() || 0
                  if (k === 'success') return entry.success ? 1 : 0
                  return entry[k] ?? ''
                }).map(entry => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {new Date(entry.sentAt).toLocaleTimeString('en-IN')}
                    </td>
                    <td>{entry.to}</td>
                    <td>
                      {entry.success
                        ? <span className="aq__status aq__status--approved">Sent</span>
                        : <span className="aq__status aq__status--rejected">Failed</span>}
                    </td>
                    <td>
                      {entry.success
                        ? entry.previewUrl
                          ? <a href={entry.previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--steel)', textDecoration: 'underline' }}>Preview (dev)</a>
                          : <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>Delivered to SMTP</span>
                        : <span style={{ color: 'var(--signal-deep)', fontSize: '0.85rem' }}>{entry.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {log.length === 0 && (
        <p className="aq__empty">No test emails sent yet. Enter an address above and click Send.</p>
      )}
    </section>
  )
}

// ── CFA Records (admin: manage cfa_locations + cfa_state_master) ─────────────

function CfaRecordsPanel({ divisionCode, isSuperAdmin }) {
  const [view, setView] = useState(null) // null | 'locations' | 'state-master'
  const [cfaCount, setCfaCount] = useState(null)
  const [smCount, setSmCount] = useState(null)

  useEffect(() => {
    cfaApi.list().then(r => setCfaCount(r.length)).catch(() => {})
    cfaStateMasterApi.list(isSuperAdmin ? undefined : divisionCode)
      .then(r => setSmCount(r.length)).catch(() => {})
  }, [divisionCode, isSuperAdmin])

  if (view === 'locations')    return <CfaLocationsPanel onBack={() => setView(null)} />
  if (view === 'state-master') return <CfaStateMasterPanel onBack={() => setView(null)} />

  return (
    <section className="dash-section">
      <h2 className="dash-section__title">CFA Records</h2>
      <div className="infinity-sync__cards">
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">CFA Locations</h3>
            {cfaCount !== null && <span className="infinity-sync__count">{cfaCount} record{cfaCount === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Manage CFA depot records — code, name, and mobile/email contact details.</p>
          <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={() => setView('locations')}>
            Manage →
          </button>
        </div>
        <div className="infinity-sync__card">
          <div className="infinity-sync__card-head">
            <h3 className="infinity-sync__card-title">CFA State Master</h3>
            {smCount !== null && <span className="infinity-sync__count">{smCount} mapping{smCount === 1 ? '' : 's'}</span>}
          </div>
          <p className="infinity-sync__card-desc">Map each state to a CFA depot per division — drives automatic CFA assignment during customer registration.</p>
          <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={() => setView('state-master')}>
            Manage →
          </button>
        </div>
      </div>
    </section>
  )
}

function CfaLocationsPanel({ onBack }) {
  const { user } = useAuth()
  const canEdit = ['scm-admin', 'super-admin'].includes(user.usertype)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CFA_LOCATION_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [managingUsers, setManagingUsers] = useState(null) // cfa_locations item whose users are being managed
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [userCounts, setUserCounts] = useState({}) // cfaCode -> count of cfa-usertype users
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    cfaApi.list()
      .then(setItems)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const loadUserCounts = () => {
    adminUserDetailsApi.list({ usertype: 'cfa' })
      .then(rows => {
        const counts = {}
        for (const row of rows) counts[row.cfaCode] = (counts[row.cfaCode] ?? 0) + 1
        setUserCounts(counts)
      })
      .catch(() => {})
  }
  useEffect(loadUserCounts, [])

  useEffect(() => { setPage(1) }, [search])

  const openNew = () => { setForm(EMPTY_CFA_LOCATION_FORM); setSaveError(null); setEditing('new') }
  const openEdit = (item) => {
    setForm({ cfaCode: item.cfaCode, cfaName: item.cfaName, mobile: item.mobile ?? '', email: item.email ?? '' })
    setSaveError(null)
    setEditing(item)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setSaveError(null)
    const payload = {
      cfa_code: form.cfaCode.trim().toUpperCase(),
      cfa_name: form.cfaName.trim(),
      mobile:   form.mobile.trim() || null,
      email:    form.email.trim() || null,
    }
    try {
      if (editing === 'new') {
        const created = await cfaApi.create(payload)
        setItems(prev => [...prev, created].sort((a, b) => a.cfaName.localeCompare(b.cfaName)))
      } else {
        const updated = await cfaApi.update(editing.cfaCode, { cfa_name: payload.cfa_name, mobile: payload.mobile, email: payload.email })
        setItems(prev => prev.map(i => i.cfaCode === updated.cfaCode ? updated : i))
      }
      setEditing(null)
    } catch (err) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    try {
      await cfaApi.remove(deleting.cfaCode)
      setItems(prev => prev.filter(i => i.cfaCode !== deleting.cfaCode))
      setDeleting(null)
    } catch (err) { setDeleteError(err.message); setDeleting(null) }
  }

  if (managingUsers) {
    return <CfaUsersPanel cfaCode={managingUsers.cfaCode} cfaName={managingUsers.cfaName} onBack={() => { setManagingUsers(null); loadUserCounts() }} />
  }

  const q = search.trim().toLowerCase()
  const filtered = q ? items.filter(i => i.cfaCode.toLowerCase().includes(q) || i.cfaName.toLowerCase().includes(q)) : items
  const sorted = sortRows(filtered, sort.key, sort.dir, (i, k) => i[k] ?? '')
  const totalPages = Math.max(1, Math.ceil(filtered.length / CFA_LOCATIONS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * CFA_LOCATIONS_PAGE_SIZE, currentPage * CFA_LOCATIONS_PAGE_SIZE)

  return (
    <section className="dash-section">
      <button type="button" className="field-users__back" onClick={onBack}>← CFA Records</button>
      <div className="dash-section__header">
        <h2 className="dash-section__title">CFA Locations</h2>
        <div className="field-users__header-actions">
          <input className="field-users__search" type="search" placeholder="Search by code or name…" value={search} onChange={e => setSearch(e.target.value)} />
          {canEdit && <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={openNew}>+ Add CFA</button>}
        </div>
      </div>

      {deleteError && <p className="product-form__error">{deleteError}</p>}

      {loading ? (
        <p className="aq__empty">Loading…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load CFA locations: {loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">{items.length === 0 ? 'No CFA locations found.' : 'No records match your search.'}</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <SortableTh label="CFA Code" sortKey="cfaCode" active={sort.key === 'cfaCode'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="CFA Name" sortKey="cfaName" active={sort.key === 'cfaName'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Email" sortKey="email" active={sort.key === 'email'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
                </tr>
              </thead>
              <tbody>
                {paginated.map(item => (
                  <tr key={item.cfaCode}>
                    <td className="dash-table__td-id">{item.cfaCode}</td>
                    <td className="dash-table__td-name">{item.cfaName}</td>
                    <td>{item.email || '—'}</td>
                    <td className="dash-table__td-actions field-users__actions-col">
                      <div className="aq__row-actions">
                        <button type="button" className="aq__btn aq__btn--view" onClick={() => setManagingUsers(item)}>Users ({userCounts[item.cfaCode] ?? 0})</button>
                        {canEdit && <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(item)}>Edit</button>}
                        {canEdit && <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(item)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span className="field-users__pagination-info">Page {currentPage} of {totalPages} · {filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {editing && (
        <CfaLocationFormDialog
          form={form} setForm={setForm}
          onSubmit={handleSubmit} onCancel={() => setEditing(null)}
          saving={saving} error={saveError} isEdit={editing !== 'new'}
        />
      )}
      {deleting && (
        <ConfirmDialog
          message={`Delete "${deleting.cfaName}" (${deleting.cfaCode})? This cannot be undone.`}
          confirmLabel="Delete" confirmVariant="reject"
          onConfirm={handleDelete} onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

function CfaLocationFormDialog({ form, setForm, onSubmit, onCancel, saving, error, isEdit }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{isEdit ? 'Edit CFA Location' : 'Add CFA Location'}</h3>
        <form onSubmit={onSubmit}>
          <label className="product-form__field">
            <span>CFA Code <span className="product-form__req">*</span></span>
            <input
              required
              value={form.cfaCode}
              disabled={isEdit}
              style={isEdit ? { background: 'var(--paper-deep)', cursor: 'not-allowed' } : undefined}
              placeholder="e.g. CFA-MUM-01"
              onChange={e => setForm(f => ({ ...f, cfaCode: e.target.value.toUpperCase() }))}
            />
          </label>
          <label className="product-form__field">
            <span>CFA Name <span className="product-form__req">*</span></span>
            <input required value={form.cfaName} placeholder="e.g. CFA Mumbai" onChange={e => setForm(f => ({ ...f, cfaName: e.target.value }))} />
          </label>
          <label className="product-form__field">
            <span>Email</span>
            <input type="email" value={form.email} placeholder="e.g. cfa@company.in" onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </label>
          {error && <p className="product-form__error">{error}</p>}
          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CFA Users (login accounts scoped to one CFA location) ───────────────────
// A CFA depot needs several people able to log in under it, not just one —
// users.cfa_code has no uniqueness constraint, so multiple cfa-usertype
// accounts sharing the same cfa_code is already schema-legal. Reuses the
// admin-user-details backend (usertype='cfa') exactly as Admin User Details
// does, just pre-scoped to one cfa_code and trimmed to mandatory fields only
// (no Role/Division/Emp Code — none of those apply to a cfa account).

const EMPTY_CFA_USER_FORM = { name: '', mobileno: '', email: '', password: '', isActive: true }
const CFA_USERS_PAGE_SIZE = 10

function CfaUsersPanel({ cfaCode, cfaName, onBack }) {
  const { user } = useAuth()
  const canEdit = ['scm-admin', 'super-admin'].includes(user.usertype)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null) // null | 'new' | cfa user
  const [form, setForm] = useState(EMPTY_CFA_USER_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [sort, setSort] = useState({ key: '', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    adminUserDetailsApi.list({ usertype: 'cfa', cfa_code: cfaCode })
      .then(setItems)
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [cfaCode])

  useEffect(() => { setPage(1) }, [search])

  const openNew = () => { setForm(EMPTY_CFA_USER_FORM); setSaveError(null); setEditing('new') }
  const openEdit = (u) => {
    setForm({ name: u.name, mobileno: u.mobileno, email: u.email ?? '', password: '', isActive: u.isActive })
    setSaveError(null)
    setEditing(u)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const mobileno = form.mobileno.trim()
    const email = form.email.trim()
    if (!PATTERNS.mobile.test(mobileno)) {
      setSaveError('Enter a valid 10-digit Indian mobile number')
      return
    }
    if (!PATTERNS.email.test(email)) {
      setSaveError('Enter a valid email address')
      return
    }
    setSaving(true)
    setSaveError(null)
    const payload = {
      usertype:    'cfa',
      cfa_code:    cfaCode,
      name:        form.name.trim(),
      mobileno,
      email,
      is_active:   form.isActive,
    }
    if (form.password) payload.password = form.password
    try {
      if (editing === 'new') {
        const created = await adminUserDetailsApi.create(payload)
        setItems(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      } else {
        const updated = await adminUserDetailsApi.update(editing.id, payload)
        setItems(prev => prev.map(u => u.id === updated.id ? updated : u))
      }
      setEditing(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await adminUserDetailsApi.remove(deleting.id)
      setItems(prev => prev.filter(u => u.id !== deleting.id))
      setDeleting(null)
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(null)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = q ? items.filter(u => u.name.toLowerCase().includes(q) || u.mobileno.includes(q) || (u.email ?? '').toLowerCase().includes(q)) : items
  const sorted = sortRows(filtered, sort.key, sort.dir, (u, k) => k === 'isActive' ? (u.isActive ? 1 : 0) : u[k] ?? '')
  const totalPages = Math.max(1, Math.ceil(filtered.length / CFA_USERS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = sorted.slice((currentPage - 1) * CFA_USERS_PAGE_SIZE, currentPage * CFA_USERS_PAGE_SIZE)

  return (
    <section className="dash-section">
      <button type="button" className="field-users__back" onClick={onBack}>← {cfaName}</button>
      <div className="dash-section__header">
        <h2 className="dash-section__title">Users — {cfaName} ({cfaCode})</h2>
        <div className="field-users__header-actions">
          <input className="field-users__search" type="search" placeholder="Search by name, mobile or email…" value={search} onChange={e => setSearch(e.target.value)} />
          {canEdit && <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={openNew}>+ Add User</button>}
        </div>
      </div>

      {deleteError && <p className="product-form__error">{deleteError}</p>}

      {loading ? (
        <p className="aq__empty">Loading…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load users: {loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">{items.length === 0 ? 'No users yet for this CFA location.' : 'No records match your search.'}</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <SortableTh label="Name" sortKey="name" active={sort.key === 'name'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Mobile" sortKey="mobileno" active={sort.key === 'mobileno'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Email" sortKey="email" active={sort.key === 'email'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Status" sortKey="isActive" active={sort.key === 'isActive'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
                </tr>
              </thead>
              <tbody>
                {paginated.map(u => (
                  <tr key={u.id}>
                    <td className="dash-table__td-name">{u.name}</td>
                    <td>{u.mobileno}</td>
                    <td>{u.email || '—'}</td>
                    <td>
                      <span className={`aq__status ${u.isActive ? 'aq__status--approved' : 'aq__status--rejected'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="dash-table__td-actions field-users__actions-col">
                      <div className="aq__row-actions">
                        {canEdit && <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(u)}>Edit</button>}
                        {canEdit && <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(u)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span className="field-users__pagination-info">Page {currentPage} of {totalPages} · {filtered.length} user{filtered.length === 1 ? '' : 's'}</span>
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {editing && (
        <CfaUserFormDialog
          cfaCode={cfaCode} cfaName={cfaName}
          form={form} setForm={setForm}
          onSubmit={handleSubmit} onCancel={() => setEditing(null)}
          saving={saving} error={saveError} isEdit={editing !== 'new'}
        />
      )}
      {deleting && (
        <ConfirmDialog
          message={`Remove ${deleting.name} and revoke their login access?`}
          confirmLabel="Delete" confirmVariant="reject"
          onConfirm={handleDelete} onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

function CfaUserFormDialog({ cfaCode, cfaName, form, setForm, onSubmit, onCancel, saving, error, isEdit }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{isEdit ? `Edit User — ${cfaName}` : `Add User — ${cfaName}`}</h3>
        <form onSubmit={onSubmit}>
          <label className="product-form__field">
            <span>CFA Location</span>
            <input value={`${cfaName} (${cfaCode})`} disabled style={{ background: 'var(--paper-deep)', cursor: 'not-allowed' }} />
          </label>
          <label className="product-form__field">
            <span>Name</span>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="product-form__row">
            <label className="product-form__field">
              <span>Mobile No</span>
              <input required inputMode="numeric" maxLength={10} value={form.mobileno} onChange={e => setForm(f => ({ ...f, mobileno: e.target.value }))} />
            </label>
            <label className="product-form__field">
              <span>Email</span>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
          </div>
          <div className="product-form__field">
            <span>{isEdit ? 'New Password' : 'Password'}</span>
            <input
              type="password"
              required={!isEdit}
              placeholder={isEdit ? 'Leave blank to keep current password' : ''}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            />
            {form.password && (
              <ul className="admin-pwd-rules">
                {getPasswordRules(form.password).map(r => (
                  <li key={r.label} className={`admin-pwd-rule${r.ok ? ' admin-pwd-rule--ok' : ''}`}>
                    <span aria-hidden="true">{r.ok ? '✓' : '○'}</span> {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="product-form__field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }}
            />
            <span>Active</span>
          </label>

          {error && <p className="product-form__error">{error}</p>}

          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CfaStateMasterPanel({ onBack }) {
  const { user } = useAuth()
  const canEdit = ['scm-admin', 'super-admin'].includes(user.usertype)
  const [items, setItems] = useState([])
  const [states, setStates] = useState([])
  const [cfas, setCfas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CFA_STATE_MASTER_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [sort, setSort] = useState({ key: 'stateName', dir: 'asc' })

  useEffect(() => {
    setLoading(true); setLoadError(null)
    Promise.all([
      cfaStateMasterApi.list(),
      stateMasterApi.list(),
      cfaApi.list(),
    ])
      .then(([mappings, statelist, cfalist]) => { setItems(mappings); setStates(statelist); setCfas(cfalist) })
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { setPage(1) }, [search])

  const openEdit = (row) => {
    setForm({ stateCode: row.stateCode, cfaCode: row.cfaCode })
    setSaveError(null); setEditing(row)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true); setSaveError(null)
    try {
      if (editing.id === null) {
        const raw = await cfaStateMasterApi.create({ state_code: form.stateCode, cfa_code: form.cfaCode })
        const cfaName = cfas.find(c => c.cfaCode === form.cfaCode)?.cfaName ?? form.cfaCode
        setItems(prev => [...prev, { id: raw.id, stateCode: raw.state_code, stateName: editing.stateName, cfaCode: raw.cfa_code, cfaName }])
      } else {
        await cfaStateMasterApi.update(editing.id, { cfa_code: form.cfaCode })
        const cfaName = cfas.find(c => c.cfaCode === form.cfaCode)?.cfaName ?? form.cfaCode
        setItems(prev => prev.map(i => i.id === editing.id ? { ...i, cfaCode: form.cfaCode, cfaName } : i))
      }
      setEditing(null)
    } catch (err) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    try {
      await cfaStateMasterApi.remove(deleting.id)
      setItems(prev => prev.filter(i => i.id !== deleting.id))
      setDeleting(null)
    } catch (err) { setDeleteError(err.message); setDeleting(null) }
  }

  // All states shown; existing mappings joined in by stateCode
  const allRows = states.flatMap(s => {
    const mappings = items.filter(m => m.stateCode === s.stateCode)
    if (mappings.length > 0) return mappings.map(m => ({ ...m, stateName: s.stateName }))
    return [{ id: null, stateCode: s.stateCode, stateName: s.stateName, cfaCode: '', cfaName: '' }]
  })
  const sorted = sortRows(allRows, sort.key, sort.dir, (r, k) => r[k] ?? '')
  const q = search.trim().toLowerCase()
  const filtered = q
    ? sorted.filter(r => (r.stateName ?? '').toLowerCase().includes(q) || (r.cfaName ?? '').toLowerCase().includes(q))
    : sorted
  const totalPages = Math.max(1, Math.ceil(filtered.length / CFA_STATE_MASTER_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * CFA_STATE_MASTER_PAGE_SIZE, currentPage * CFA_STATE_MASTER_PAGE_SIZE)

  return (
    <section className="dash-section">
      <button type="button" className="field-users__back" onClick={onBack}>← CFA Records</button>
      <div className="dash-section__header">
        <h2 className="dash-section__title">CFA State Master</h2>
        <div className="field-users__header-actions">
          <input className="field-users__search" type="search" placeholder="Search by state or CFA…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {deleteError && <p className="product-form__error">{deleteError}</p>}

      {loading ? (
        <p className="aq__empty">Loading…</p>
      ) : loadError ? (
        <p className="aq__empty">Failed to load mappings: {loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="aq__empty">No records match your search.</p>
      ) : (
        <>
          <div className="dash-table-scroll">
            <table className="dash-table field-users__table">
              <thead>
                <tr>
                  <SortableTh label="State Name" sortKey="stateName"    active={sort.key === 'stateName'}    dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="State Code" sortKey="stateCode"    active={sort.key === 'stateCode'}    dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="CFA Name"   sortKey="cfaName"      active={sort.key === 'cfaName'}      dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="CFA Code"   sortKey="cfaCode"      active={sort.key === 'cfaCode'}      dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th dash-table__th--actions field-users__actions-col" />
                </tr>
              </thead>
              <tbody>
                {paginated.map(row => (
                  <tr key={row.id ?? row.stateCode}>
                    <td className="dash-table__td-name">{row.stateName}</td>
                    <td className="dash-table__td-id">{row.stateCode}</td>
                    <td>{row.cfaName || '—'}</td>
                    <td className="dash-table__td-id">{row.cfaCode || '—'}</td>
                    <td className="dash-table__td-actions field-users__actions-col">
                      <div className="aq__row-actions">
                        {canEdit && <button type="button" className="aq__btn aq__btn--view" onClick={() => openEdit(row)}>Edit</button>}
                        {canEdit && row.id && <button type="button" className="aq__btn aq__btn--reject" onClick={() => setDeleting(row)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="field-users__pagination">
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>�� Prev</button>
              <span className="field-users__pagination-info">Page {currentPage} of {totalPages} · {filtered.length} state{filtered.length === 1 ? '' : 's'}</span>
              <button type="button" className="aq__btn aq__btn--view" disabled={currentPage === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {editing && (
        <CfaStateMasterFormDialog
          form={form} setForm={setForm} cfas={cfas}
          stateName={editing.stateName}
          onSubmit={handleSubmit} onCancel={() => setEditing(null)}
          saving={saving} error={saveError}
          isEdit={editing.id !== null}
        />
      )}
      {deleting && (
        <ConfirmDialog
          message={`Remove the mapping for "${deleting.stateName}"? Orders from this state will no longer auto-assign a CFA.`}
          confirmLabel="Delete" confirmVariant="reject"
          onConfirm={handleDelete} onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}

function CfaStateMasterFormDialog({ form, setForm, cfas, stateName, onSubmit, onCancel, saving, error, isEdit }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="product-form" onClick={e => e.stopPropagation()}>
        <h3 className="product-form__title">{isEdit ? 'Edit CFA Mapping' : 'Assign CFA'}</h3>
        <form onSubmit={onSubmit}>
          <label className="product-form__field">
            <span>State</span>
            <input
              value={`${stateName} (${form.stateCode})`}
              disabled
              style={{ background: 'var(--paper-deep)', cursor: 'not-allowed' }}
              readOnly
            />
          </label>
          <label className="product-form__field">
            <span>CFA <span className="product-form__req">*</span></span>
            <select required value={form.cfaCode} onChange={e => setForm(f => ({ ...f, cfaCode: e.target.value }))}>
              <option value="">— Select CFA —</option>
              {cfas.map(c => (
                <option key={c.cfaCode} value={c.cfaCode}>{c.cfaName} ({c.cfaCode})</option>
              ))}
            </select>
          </label>
          {error && <p className="product-form__error">{error}</p>}
          <div className="confirm-dialog__actions">
            <button type="submit" className="confirm-dialog__btn confirm-dialog__btn--approve" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="confirm-dialog__btn confirm-dialog__btn--cancel" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CFA ────���─────────────────────────────────��────────────────────────────────
// CFA accounts are division-less (like super-admin) but scoped to their own
// single cfa_code (set via Admin User Details) — the backend's GET /orders and
// GET /customers already filter by req.user.cfaCode regardless of which
// division is picked here, so AdminOrdersCustomersPanel can be reused as-is.

function CfaDashboard() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [cfaView, setCfaView] = useState('orders')
  const [selectedDivision, setSelectedDivision] = useState('')

  if (!selectedDivision) {
    return (
      <div className="admin-dash admin-dash__gate">
        <h2 className="admin-dash__title">Select a division to continue</h2>
        <DivisionSelect value="" onChange={setSelectedDivision} allowAll={false} />
      </div>
    )
  }

  return (
    <div className="admin-dash">
      <div className="admin-dash__bar">
        <div className="admin-dash__menu-wrap">
          <button
            type="button"
            className="admin-dash__hamburger"
            aria-label="CFA menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6 H21 M3 12 H21 M3 18 H21" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="admin-dash__backdrop" onClick={() => setMenuOpen(false)} />
              <div className="admin-dash__menu" role="menu">
                {CFA_MENU_ITEMS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className={`admin-dash__menu-item${cfaView === item.key ? ' admin-dash__menu-item--active' : ''}`}
                    onClick={() => { setCfaView(item.key); setMenuOpen(false) }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <h2 className="admin-dash__title">{CFA_MENU_ITEMS.find(i => i.key === cfaView)?.label}</h2>
        <DivisionSelect
          value={selectedDivision}
          onChange={setSelectedDivision}
          allowAll={false}
          className="admin-dash__division-select"
        />
      </div>

      {(cfaView === 'orders' || cfaView === 'customers') && (
        <AdminOrdersCustomersPanel divisionCode={selectedDivision} view={cfaView} onViewChange={setCfaView} />
      )}
      {cfaView === 'dispatch' && <CfaDispatchUploadPanel />}
      {cfaView === 'payment' && <CfaPaymentUploadPanel />}
    </div>
  )
}

// Bulk LR Number/LR Date upload for CFA — mirrors CustomerUploadPanel's
// dropzone/upload/template/skip-log pattern exactly.
function CfaDispatchUploadPanel() {
  const [file, setFile] = useState(null)
  const [uploadState, setUploadState] = useState({ status: 'idle', message: '' })
  const [skippedRows, setSkippedRows] = useState([])

  const selectFile = (nextFile) => {
    setFile(nextFile)
    setUploadState({ status: 'idle', message: '' })
    setSkippedRows([])
  }

  const handleUpload = async () => {
    if (!file) return
    setUploadState({ status: 'loading', message: '' })
    setSkippedRows([])
    try {
      const result = await ordersApi.bulkUploadDispatch(file)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped — see the log below.` : ''
      setUploadState({ status: 'success', message: `Updated ${result.count} order${result.count === 1 ? '' : 's'}.${skippedNote}` })
      setSkippedRows(result.skippedRows ?? [])
      setFile(null)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message })
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const blob = await ordersApi.downloadDispatchUploadTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cfa_dispatch_upload_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message || 'Could not download the template.' })
    }
  }

  const handleDownloadSkipLog = () => {
    downloadCsv('dispatch_upload_skipped.csv', [
      { key: 'row', label: 'Row' }, { key: 'orderNumber', label: 'Order Number' }, { key: 'reason', label: 'Reason' },
    ], skippedRows)
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Dispatch Upload (LR Number / LR Date)</h2>
      </div>

      <div className="infinity-sync__card">
        <p className="infinity-sync__card-desc">
          Upload an Excel file to bulk-update LR details. Required column: <code>order_number</code>.
          Optional: <code>sap_order_number</code>, <code>lr_number</code>, <code>lr_date</code>, <code>remarks</code>.
          Only orders matching your CFA assignment, with status Approved, are updated — others are skipped.
        </p>
        <ExcelDropzone value={file} onChange={selectFile} />
        <button
          type="button"
          className="tm-actions__btn tm-actions__btn--primary"
          disabled={!file || uploadState.status === 'loading'}
          onClick={handleUpload}
        >
          {uploadState.status === 'loading' ? 'Uploading…' : 'Upload'}
        </button>
        {uploadState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{uploadState.message}</p>}
        {uploadState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{uploadState.message}</p>}
        {skippedRows.length > 0 && (
          <button type="button" className="infinity-sync__history-link" onClick={handleDownloadSkipLog}>
            Download skip log ({skippedRows.length} row{skippedRows.length === 1 ? '' : 's'})
          </button>
        )}
        <button type="button" className="infinity-sync__history-link" onClick={handleDownloadTemplate}>
          Download sample template
        </button>
      </div>
    </section>
  )
}

// Bulk payment-confirmation upload for CFA — mirrors CfaDispatchUploadPanel exactly.
function CfaPaymentUploadPanel() {
  const [file, setFile] = useState(null)
  const [uploadState, setUploadState] = useState({ status: 'idle', message: '' })
  const [skippedRows, setSkippedRows] = useState([])

  const selectFile = (nextFile) => {
    setFile(nextFile)
    setUploadState({ status: 'idle', message: '' })
    setSkippedRows([])
  }

  const handleUpload = async () => {
    if (!file) return
    setUploadState({ status: 'loading', message: '' })
    setSkippedRows([])
    try {
      const result = await ordersApi.bulkUploadPayment(file)
      const skippedNote = result.skipped ? ` ${result.skipped} skipped — see the log below.` : ''
      setUploadState({ status: 'success', message: `Updated ${result.count} order${result.count === 1 ? '' : 's'}.${skippedNote}` })
      setSkippedRows(result.skippedRows ?? [])
      setFile(null)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message })
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const blob = await ordersApi.downloadPaymentUploadTemplate()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cfa_payment_upload_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setUploadState({ status: 'error', message: err.message || 'Could not download the template.' })
    }
  }

  const handleDownloadSkipLog = () => {
    downloadCsv('payment_upload_skipped.csv', [
      { key: 'row', label: 'Row' }, { key: 'orderNumber', label: 'Order Number' }, { key: 'reason', label: 'Reason' },
    ], skippedRows)
  }

  return (
    <section className="dash-section">
      <div className="dash-section__header">
        <h2 className="dash-section__title">Payment Upload (Mark Payment Received)</h2>
      </div>

      <div className="infinity-sync__card">
        <p className="infinity-sync__card-desc">
          Upload an Excel file to bulk-confirm payments received. Required columns: <code>order_number</code>,{' '}
          <code>payment_received_date</code>, <code>payment_value</code>.
          Only orders matching your CFA assignment, with status Approved, and a non-online payment method, are updated — others are skipped.
        </p>
        <ExcelDropzone value={file} onChange={selectFile} />
        <button
          type="button"
          className="tm-actions__btn tm-actions__btn--primary"
          disabled={!file || uploadState.status === 'loading'}
          onClick={handleUpload}
        >
          {uploadState.status === 'loading' ? 'Uploading…' : 'Upload'}
        </button>
        {uploadState.status === 'success' && <p className="infinity-sync__result infinity-sync__result--ok">{uploadState.message}</p>}
        {uploadState.status === 'error' && <p className="infinity-sync__result infinity-sync__result--error">{uploadState.message}</p>}
        {skippedRows.length > 0 && (
          <button type="button" className="infinity-sync__history-link" onClick={handleDownloadSkipLog}>
            Download skip log ({skippedRows.length} row{skippedRows.length === 1 ? '' : 's'})
          </button>
        )}
        <button type="button" className="infinity-sync__history-link" onClick={handleDownloadTemplate}>
          Download sample template
        </button>
      </div>
    </section>
  )
}

// ── Customer overview dashboard — read-only order history, outstanding, and
// profile for a logged-in end customer (doctor/doctor-pharmacy/hospital/patient).
// Orders/customers are already scoped server-side (getScope in scope.js) to
// this customer's own records, so no client-side ownership filtering is needed.

function CustomerOverviewDashboard() {
  const navigate = useNavigate()
  const { selectCustomer } = useOrdering()
  const { orders, ordersError, reloadOrders, refreshOrder } = useOrders()
  const { customers, customersError, reloadCustomers, refreshCustomer } = useCustomers()
  const { rules } = useDivisionConfig()
  const [month, setMonth] = useState('')
  const [payNowOrder, setPayNowOrder] = useState(null)
  const [payNowOutstanding, setPayNowOutstanding] = useState(false)
  const [placeOrderError, setPlaceOrderError] = useState(null)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  const myCustomer = customers[0] ?? null
  const payNowMethods = ['online'].filter(o => rules.orderEntry.paymentOptions.includes(o))

  const monthOptions = Array.from(new Set(orders.map(o => monthKey(o.placedAt)))).sort().reverse()
  const filteredOrders = month ? orders.filter(o => monthKey(o.placedAt) === month) : orders
  const sortedOrders = sortRows(filteredOrders, sort.key, sort.dir, orderSortValue)

  const approvedOrders = filteredOrders.filter(o => o.approvalStatus === 'approved')
  const totalOrdersValue = approvedOrders.reduce((s, o) => s + (o.totalPayable ?? 0), 0)

  const outstandingAmount = myCustomer?.outstandingAmount ?? 0
  const isSettled = outstandingAmount <= 0

  const greeting = getTimeGreeting()
  // Doctors get greeted by full name with the "Dr." honorific; everyone else
  // gets a friendlier first-name-only greeting.
  const greetName = myCustomer?.customerType === 'doctor'
    ? formatCustomerDisplayName(myCustomer)
    : myCustomer?.name?.trim().split(/\s+/)[0] ?? ''
  const pendingCount = orders.filter(o => ['pending-l1', 'approved-l1'].includes(o.approvalStatus)).length
  const heroSubtext = pendingCount > 0
    ? `You have ${pendingCount} order${pendingCount === 1 ? '' : 's'} awaiting approval.`
    : !isSettled
      ? `You have an outstanding balance of ${formatCurrency(outstandingAmount)}.`
      : "You're all caught up — nothing pending right now."

  const handlePlaceOrder = () => {
    if (!myCustomer) return
    if (myCustomer.approvalStatus !== 'approved') {
      setPlaceOrderError('Your registration is still pending approval. You can place orders once it is approved.')
      return
    }
    if (isDrugLicenceExpired(myCustomer)) {
      setPlaceOrderError(`Cannot place order — your drug licence expired on ${fmtDateOnly(myCustomer.drugLicenceValidTill)}. Please renew it before ordering.`)
      return
    }
    const missing = getMissingRequiredDocs(myCustomer, rules.documents.customer[myCustomer.customerType])
    if (missing.length > 0) {
      setPlaceOrderError(`Cannot place order — the following required documents have not been submitted: ${missing.map(d => d.label).join(', ')}.`)
      return
    }
    const outstandingLimit = rules.orderEntry?.outstandingLimitByType?.[myCustomer.customerType] || 0
    if (outstandingLimit > 0) {
      const totalOutstanding = (myCustomer.outstandingAmount || 0) + (myCustomer.pendingOrdersTotal || 0)
      if (totalOutstanding > outstandingLimit) {
        setPlaceOrderError(`Cannot place order — your outstanding balance of ${formatCurrency(totalOutstanding)} exceeds the allowed limit of ${formatCurrency(outstandingLimit)}. Please clear the outstanding before placing new orders.`)
        return
      }
    }
    setPlaceOrderError(null)
    selectCustomer(myCustomer)
    navigate('/products')
  }

  if (!myCustomer) {
    return (
      <div className="dashboard__default">
        {customersError ? (
          <p className="aq__empty">
            Failed to load your customer record: {customersError}{' '}
            <button type="button" className="aq__btn aq__btn--view" onClick={reloadCustomers}>Retry</button>
          </p>
        ) : (
          <p className="aq__empty">We couldn't find your customer record. Please contact your distributor.</p>
        )}
      </div>
    )
  }

  return (
    <section className="dash-section">
      <div className="dashboard__hero">
        <div className="dashboard__hero-blob dashboard__hero-blob--a" aria-hidden="true" />
        <div className="dashboard__hero-blob dashboard__hero-blob--b" aria-hidden="true" />
        <p className="dashboard__hero-eyebrow">{greeting}{greetName ? `, ${greetName}` : ''} 👋</p>
        <h1 className="dashboard__hero-title">Welcome back</h1>
        <p className="dashboard__hero-sub">{heroSubtext}</p>
      </div>

      <div className="dash-section__header">
        <h2 className="dash-section__title">Order Overview</h2>
        <select
          className="field-users__search"
          value={month}
          onChange={e => setMonth(e.target.value)}
          aria-label="Filter by month"
        >
          <option value="">All time</option>
          {monthOptions.map(k => <option key={k} value={k}>{monthKeyLabel(k)}</option>)}
        </select>
      </div>

      {placeOrderError && (
        <div className="cpicker__licence-error" role="alert" style={{ marginBottom: '1rem' }}>
          {placeOrderError}
        </div>
      )}

      <div className="admin-overview__stat-group">
        <div className="admin-overview__stat-grid">
          <StatCard label="Total Orders" value={approvedOrders.length} subValue={formatCurrency(totalOrdersValue)} variant="approved" />
          <StatCard label="Outstanding" value={formatCurrency(outstandingAmount)} subValue={isSettled ? 'Settled' : 'Due'} variant={isSettled ? 'approved' : 'pending'} />
        </div>
        {!isSettled && payNowMethods.length > 0 && (
          <button type="button" className="aq__btn aq__btn--pay" style={{ marginTop: '0.75rem' }} onClick={() => setPayNowOutstanding(true)}>
            <PayIcon /> Pay Outstanding Now
          </button>
        )}
      </div>

      <div className="dash-table-wrap">
        <div className="dash-table-title-row">
          <h3 className="dash-table-title">
            Your orders
            <span className="aq__count">{filteredOrders.length} total</span>
          </h3>
          <button type="button" className="tm-actions__btn tm-actions__btn--secondary" onClick={() => navigate('/dashboard/profile')}>
            View Profile
          </button>
          <button type="button" className="tm-actions__btn tm-actions__btn--primary" onClick={handlePlaceOrder}>
            Place Order →
          </button>
        </div>

        {ordersError ? (
          <p className="aq__empty">
            Failed to load orders: {ordersError}{' '}
            <button type="button" className="aq__btn aq__btn--view" onClick={reloadOrders}>Retry</button>
          </p>
        ) : sortedOrders.length === 0 ? (
          <p className="aq__empty">You haven't placed any orders yet.</p>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <SortableTh label="Order ID" sortKey="id" active={sort.key === 'id'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Customer" sortKey="customer" active={sort.key === 'customer'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <SortableTh label="Date" sortKey="date" active={sort.key === 'date'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  {rules.orderEntry.showPrices && <SortableTh label="Amount" sortKey="amount" active={sort.key === 'amount'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} align="right" />}
                  {rules.orderEntry.paymentOptions.length > 0 && <th className="dash-table__th">Payment</th>}
                  <SortableTh label="Status" sortKey="status" active={sort.key === 'status'} dir={sort.dir} onSort={k => toggleSort(setSort, k)} />
                  <th className="dash-table__th dash-table__th--actions" />
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map(o => (
                  <tr key={o.id}>
                    <td className="dash-table__td-id">{o.orderNumber}</td>
                    <td className="dash-table__td-name">
                      {o.orderingFor?.name ?? '—'}
                      {o.orderingFor?.customerCode && (
                        <span className="dash-table__td-sub">{o.orderingFor.customerCode}</span>
                      )}
                    </td>
                    <td>{fmtDate(o.placedAt)}</td>
                    {rules.orderEntry.showPrices && (
                      <td className="dash-table__td-num">{formatCurrency(o.totalPayable)}</td>
                    )}
                    {rules.orderEntry.paymentOptions.length > 0 && (
                      <td><PaymentCell order={o} payNowOptions={payNowMethods} onPayNow={setPayNowOrder} /></td>
                    )}
                    <td>
                      <ApprovalStatusCell
                        status={o.approvalStatus}
                        since={o.placedAt}
                        step={getOrderStepForStatus(rules.orderWorkflow, o.approvalStatus)}
                        hierarchy={null}
                        reason={o.rejectionReason}
                      />
                    </td>
                    <td className="dash-table__td-actions">
                      <button className="aq__btn aq__btn--view" onClick={() => navigate('/dashboard/orders', { state: { id: o.id } })}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payNowOrder && (
        <PayNowModal
          order={payNowOrder}
          payNowOptions={payNowMethods}
          onClose={() => setPayNowOrder(null)}
          onLinkCreated={() => refreshOrder(payNowOrder.id)}
        />
      )}

      {payNowOutstanding && (
        <PayNowModal
          order={myCustomer}
          kind="customer"
          title={`Pay Now — Outstanding balance`}
          payNowOptions={payNowMethods}
          onClose={() => setPayNowOutstanding(false)}
          onLinkCreated={() => refreshCustomer(myCustomer.id)}
        />
      )}
    </section>
  )
}

// ── Default ───────────────────────────────────────────────────────────────────

function DefaultDashboard() {
  const navigate = useNavigate()
  return (
    <div className="dashboard__default">
      <button className="dashboard__card-btn dashboard__card-btn--filled" onClick={() => navigate('/products')}>
        Browse Products →
      </button>
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [view, setView] = useState('overview')

  // Deep link from approval-request emails: ?review=order|customer&id=...
  useEffect(() => {
    const review = searchParams.get('review')
    const id = searchParams.get('id')
    if ((review === 'order' || review === 'customer') && id) {
      navigate(`/dashboard/${review}s`, { state: { id }, replace: true })
    }
  }, [searchParams, navigate])

  const isApprover = ALL_APPROVER_ROLES.includes(user?.usertype)
  const isAdmin = user?.usertype === 'admin' || user?.usertype === 'super-admin' || user?.usertype === 'bu-head' || user?.usertype === 'scm-admin'
  const isCustomerLogin = ALL_CUSTOMER_TYPES.includes(user?.usertype)
  const Body = user?.usertype === 'tm' ? TmDashboard
             : isAdmin                 ? AdminDashboard
             : isApprover               ? ApproverDashboard
             : user?.usertype === 'cfa' ? CfaDashboard
             : isCustomerLogin          ? CustomerOverviewDashboard
             :                           DefaultDashboard

  return (
    <div className="dashboard">
      <main className="dashboard__body">
        <Body view={view} onViewChange={setView} />
      </main>
    </div>
  )
}

export default Dashboard
