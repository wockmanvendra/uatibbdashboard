import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrders } from '../context/OrdersContext.jsx'
import { useOrdering } from '../context/OrderingContext.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useCustomers } from '../context/CustomersContext.jsx'
import { DivisionConfigProvider, useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { STATUS_LABELS, getOrderStep } from '../data/workflow.js'
import { PAYMENT_OPTION_LABELS } from '../data/paymentOptions.js'
import { formatCurrency } from '../utils/currency.js'
import { USERTYPE_LABELS } from '../utils/format.js'
import { ordersApi, productsApi, uploadsApi, bankMasterApi } from '../lib/api.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import AuditLogDialog from '../components/AuditLogDialog.jsx'
import PaymentLogDialog from '../components/PaymentLogDialog.jsx'
import PayNowModal, { PayIcon } from '../components/PayNowModal.jsx'
import OutcomeModal from '../components/OutcomeModal.jsx'
import { buildSuccessOutcome } from '../utils/outcomeMessages.js'
import './OrderDetailPage.css'

const CUSTOMER_LOGIN_TYPES = ['patient', 'doctor', 'hospital', 'doctor-pharmacy']

function fmtChequeDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// orders.lr_date round-trips through the API as a UTC-shifted ISO string (DATE
// columns are parsed in the server's local timezone) — extract LOCAL date parts,
// not .toISOString(), or an <input type="date"> ends up one day behind.
function toDateInputValue(value) {
  if (!value) return ''
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtOrderDate(iso) {
  return new Date(iso)
    .toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', ' ·')
}

function minChequeDate() {
  return toDateInputValue(new Date())
}

function maxChequeDate() {
  const thirtyDaysOut = new Date()
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
  return toDateInputValue(thirtyDaysOut)
}

// Rules-dependent body, split out so it can be wrapped in its own
// DivisionConfigProvider keyed to this specific order's division (see
// OrderDetailPage below) — a cfa's own account has no divisionCode (cfa is
// cfa_code-scoped, not division-scoped), so without this override every cfa
// viewing any order would incorrectly fall back to the 'default' division's
// rules instead of the order's real division — e.g. hiding the entire
// Payment details card if 'default' has no paymentOptions configured.
function OrderDetailPageBody({ order }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { approveOrder, rejectOrder, refreshOrder } = useOrders()
  const { selectCustomer, setResubmitOrderId, setResubmitOrderNumber } = useOrdering()
  const cart = useCart()
  const { customers } = useCustomers()
  const { rules } = useDivisionConfig()
  const [confirmAction, setConfirmAction] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [showChequePhoto, setShowChequePhoto] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logEntries, setLogEntries] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [paymentLogOpen, setPaymentLogOpen] = useState(false)
  const [paymentLogEntries, setPaymentLogEntries] = useState([])
  const [paymentLogLoading, setPaymentLogLoading] = useState(false)
  const [showPayNow, setShowPayNow] = useState(false)
  const [dispatchForm, setDispatchForm] = useState({ lrNumber: '', lrDate: '', remarks: '' })
  const [podFile, setPodFile] = useState(null)
  const [dispatchSaving, setDispatchSaving] = useState(false)
  const [dispatchError, setDispatchError] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ receivedDate: '', amount: '' })
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentError, setPaymentError] = useState(null)
  const [chequeForm, setChequeForm] = useState({ bankName: '', chequeNumber: '', chequeDate: '' })
  const [chequePhotoFile, setChequePhotoFile] = useState(null)
  const [chequeSaving, setChequeSaving] = useState(false)
  const [chequeError, setChequeError] = useState(null)
  const [bankOptions, setBankOptions] = useState([])
  const [addingBank, setAddingBank] = useState(false)
  const [newBankName, setNewBankName] = useState('')

  useEffect(() => {
    bankMasterApi.list().then(setBankOptions).catch(() => {})
  }, [])

  // Pre-fill the dispatch/payment forms from whatever values already exist on this
  // order (e.g. re-opening it to add a POD after LR Number/Date were already set) —
  // only re-syncs when navigating to a different order, so it doesn't clobber an
  // in-progress edit, and a just-saved value stays visible afterward instead of
  // reverting to blank. Hooks must run unconditionally, so this sits above the
  // `!order` early return below.
  useEffect(() => {
    if (!order) return
    setDispatchForm({ lrNumber: order.lrNumber ?? '', lrDate: toDateInputValue(order.lrDate), remarks: '' })
    setPaymentForm({ receivedDate: toDateInputValue(order.paymentReceivedDate), amount: order.paymentReceivedAmount != null ? String(order.paymentReceivedAmount) : '' })
    const existingCheque = order.paymentMethod === 'pdc-delivery' ? order.extraData?.chequeDetails : null
    setChequeForm({
      bankName: existingCheque?.bankName ?? '',
      chequeNumber: existingCheque?.chequeNumber ?? '',
      chequeDate: existingCheque?.chequeDate ?? '',
    })
    setChequePhotoFile(null)
  }, [order?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { showPrices, paymentOptions } = rules.orderEntry
  const isCustomerLogin = CUSTOMER_LOGIN_TYPES.includes(user.usertype)
  const payNowMethods = isCustomerLogin ? ['online'] : ['online', 'payment-link']
  const payNowOptions = payNowMethods.filter(o => paymentOptions.includes(o))
  const orderStep = getOrderStep(rules.orderWorkflow, user.usertype)
  const canAct = orderStep && order.approvalStatus === orderStep.fromStatus && order.placedBy?.id !== user.id
  const canResubmit = order.placedBy?.id === user.id && order.approvalStatus === 'rejected'
  const approver = { id: user.id, name: user.name, usertype: user.usertype }
  const chequeDetails = ['post-dated-cheque', 'pdc-delivery'].includes(order.paymentMethod) ? order.extraData?.chequeDetails : null
  const ccavenueOutcome = ['online', 'payment-link'].includes(order.paymentMethod) ? order.extraData?.ccavenue : null
  const paymentLink = order.paymentMethod === 'payment-link' ? order.extraData?.paymentLink : null
  const orderingCustomer = order.orderingFor?.id ? customers.find(c => c.id === order.orderingFor.id) : null
  const isMumbaiCustomer = String(orderingCustomer?.city ?? '').trim().toLowerCase() === 'mumbai'
  const securityCheque = isMumbaiCustomer ? orderingCustomer?.documents?.securityCheque : null
  const hasDispatchDetails = order.lrNumber || order.lrDate || order.sapOrderNumber || order.podUrl
  const canCfaEditOrder = user.usertype === 'cfa' && order.cfaCode === user.cfaCode && order.approvalStatus === 'approved'
  const canConfirmPayment = canCfaEditOrder && order.paymentMethod !== 'online'
  const canCaptureCheque = canCfaEditOrder && order.paymentMethod === 'pdc-delivery'
  const todayInputValue = toDateInputValue(new Date())

  const openLog = async () => {
    setLogOpen(true)
    setLogLoading(true)
    try {
      setLogEntries(await ordersApi.getApprovals(order.id))
    } finally {
      setLogLoading(false)
    }
  }

  const openPaymentLog = async () => {
    setPaymentLogOpen(true)
    setPaymentLogLoading(true)
    try {
      setPaymentLogEntries(await ordersApi.getPaymentLog(order.id))
    } finally {
      setPaymentLogLoading(false)
    }
  }

  const handleEditResubmit = async () => {
    const params = user?.divisionCode ? { division_code: user.divisionCode } : {}
    let products = []
    try {
      products = await productsApi.list(params)
    } catch {
      products = []
    }
    const entries = (order.items ?? []).map((item) => {
      const product = products.find(p => p.id === item.productId)
      const scheme = product?.schemes.find(s => s.label === item.schemeLabel) ?? null
      return {
        productId:    item.productId,
        productName:  item.productName,
        minOrderQty:  product?.minOrderQty ?? 1,
        initMinOrderQty: product?.initMinOrderQty ?? product?.minOrderQty ?? 1,
        maxOrderQty:  product?.maxOrderQty ?? Infinity,
        orderedQty:   item.orderedQty,
        scheme,
        schemeLabel:  item.schemeLabel,
        freeQty:      item.freeQty,
        totalQty:     item.orderedQty + item.freeQty,
        giftUnlocked: scheme?.type === 'gift' && item.freeQty > 0,
        price:        item.unitPrice,
        payableAmount:   item.lineTotal,
        discountAmount:  item.discountValue,
      }
    })
    cart.replaceItems(entries)
    selectCustomer(order.orderingFor)
    setResubmitOrderId(order.id)
    setResubmitOrderNumber(order.orderNumber)
    navigate('/products')
  }

  const handleDispatchSubmit = (e) => {
    e.preventDefault()
    const lrNumber = dispatchForm.lrNumber.trim()
    if (!lrNumber || !dispatchForm.lrDate) {
      setDispatchError('LR Number and LR Date are required.')
      return
    }
    if (dispatchForm.lrDate > todayInputValue) {
      setDispatchError('LR Date cannot be in the future.')
      return
    }
    setDispatchError(null)
    setConfirmAction('dispatch')
  }

  const handleDispatchConfirm = async () => {
    setConfirmAction(null)
    setDispatchSaving(true)
    setDispatchError(null)
    try {
      const lrNumber = dispatchForm.lrNumber.trim()
      // Persist the durable blob key, not the (short-lived) SAS link — falls
      // back to the existing POD's blob key when re-dispatching without a new file.
      let podUrl = order.podBlobName
      let podOriginalName = order.podOriginalName
      if (podFile) {
        const uploaded = await uploadsApi.upload(podFile, 'orders', order.id)
        podUrl = uploaded.blobName
        podOriginalName = uploaded.originalName
      }
      await ordersApi.updateDispatch(order.id, {
        lrNumber, lrDate: dispatchForm.lrDate,
        podUrl, podOriginalName,
        remarks: dispatchForm.remarks.trim() || null,
      })
      await refreshOrder(order.id)
      // lrNumber/lrDate stay as-saved (now mandatory, no reason to blank them);
      // only the per-submission remarks + POD file selection reset.
      setDispatchForm(f => ({ ...f, remarks: '' }))
      setPodFile(null)
    } catch (err) {
      setDispatchError(err.message || 'Something went wrong while saving dispatch details.')
    } finally {
      setDispatchSaving(false)
    }
  }

  const handlePaymentSubmit = (e) => {
    e.preventDefault()
    const amount = Number(paymentForm.amount)
    if (!paymentForm.receivedDate || !paymentForm.amount || !(amount > 0)) {
      setPaymentError('Payment Received Date and a positive Payment Value are required.')
      return
    }
    if (paymentForm.receivedDate > todayInputValue) {
      setPaymentError('Payment Received Date cannot be in the future.')
      return
    }
    setPaymentError(null)
    setConfirmAction('payment')
  }

  const handlePaymentConfirm = async () => {
    setConfirmAction(null)
    const amount = Number(paymentForm.amount)
    setPaymentSaving(true)
    setPaymentError(null)
    try {
      await ordersApi.updatePayment(order.id, {
        paymentReceivedDate: paymentForm.receivedDate,
        paymentReceivedAmount: amount,
      })
      await refreshOrder(order.id)
    } catch (err) {
      setPaymentError(err.message || 'Something went wrong while confirming payment.')
    } finally {
      setPaymentSaving(false)
    }
  }

  const confirmNewBank = async () => {
    const trimmed = newBankName.trim()
    if (!trimmed) return
    try {
      await bankMasterApi.add(trimmed)
      setBankOptions(curr => Array.from(new Set([...curr, trimmed])).sort())
      setChequeForm(f => ({ ...f, bankName: trimmed }))
      setNewBankName('')
      setAddingBank(false)
      setChequeError(null)
    } catch (err) {
      setChequeError(err.message)
    }
  }

  const handleChequeSubmit = (e) => {
    e.preventDefault()
    if (!chequeForm.bankName || !chequeForm.chequeNumber.trim() || !chequeForm.chequeDate) {
      setChequeError('Bank name, cheque number, and cheque date are required.')
      return
    }
    if (chequeForm.chequeDate < minChequeDate() || chequeForm.chequeDate > maxChequeDate()) {
      setChequeError('Cheque date must be between today and 30 days from today.')
      return
    }
    if (!chequePhotoFile && !chequeDetails?.chequePhoto?.url) {
      setChequeError('Upload the cheque photo.')
      return
    }
    setChequeError(null)
    setConfirmAction('cheque')
  }

  const handleChequeConfirm = async () => {
    setConfirmAction(null)
    setChequeSaving(true)
    setChequeError(null)
    try {
      let chequePhotoUrl, chequePhotoOriginalName
      if (chequePhotoFile) {
        const uploaded = await uploadsApi.upload(chequePhotoFile, 'orders', order.id)
        chequePhotoUrl = uploaded.blobName
        chequePhotoOriginalName = uploaded.originalName
      }
      await ordersApi.updateCheque(order.id, {
        bankName: chequeForm.bankName,
        chequeNumber: chequeForm.chequeNumber.trim(),
        chequeDate: chequeForm.chequeDate,
        chequePhotoUrl,
        chequePhotoOriginalName,
      })
      await refreshOrder(order.id)
      setChequePhotoFile(null)
    } catch (err) {
      setChequeError(err.message || 'Something went wrong while saving cheque details.')
    } finally {
      setChequeSaving(false)
    }
  }

  const handleApprove = async () => {
    setConfirmAction(null)
    try {
      await approveOrder(order.id, approver)
      setOutcome({ status: 'success', ...buildSuccessOutcome({ entity: 'order', action: 'approved', identifier: order.orderNumber }) })
    } catch (err) {
      setOutcome({ status: 'error', title: "Couldn't approve order", message: err.message || 'Something went wrong while approving this order.' })
    }
  }

  const handleReject = async () => {
    setConfirmAction(null)
    try {
      await rejectOrder(order.id, approver, rejectReason.trim())
      setOutcome({ status: 'success', ...buildSuccessOutcome({ entity: 'order', action: 'rejected', identifier: order.orderNumber }) })
    } catch (err) {
      setOutcome({ status: 'error', title: "Couldn't reject order", message: err.message || 'Something went wrong while rejecting this order.' })
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

  return (
    <div className="order-detail">
      <div className="order-detail__top-actions">
        <button type="button" className="order-detail__back" onClick={() => navigate('/dashboard')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {!isCustomerLogin && (
            <button type="button" className="order-detail__view-log" onClick={openLog}>
              View Approval Log
            </button>
          )}
          <button type="button" className="order-detail__view-log" onClick={openPaymentLog}>
            View Payment Log
          </button>
        </div>
      </div>

      <header className="order-detail__header">
        <div className="order-detail__heading">
          <p className="order-detail__eyebrow">Order details</p>
          <h1 className="order-detail__id">{order.orderNumber}</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className={`order-detail__status order-detail__status--${order.approvalStatus}`}>
            {STATUS_LABELS[order.approvalStatus] ?? order.approvalStatus}
          </span>
          {order.status === 'Delivered' && (
            <span className="order-detail__status order-detail__status--delivered">Delivered</span>
          )}
        </div>
      </header>

      {order.approvalStatus === 'rejected' && order.rejectionReason && (
        <div className="order-detail__rejection">
          <p className="order-detail__rejection-label">Rejection reason</p>
          <p className="order-detail__rejection-text">{order.rejectionReason}</p>
        </div>
      )}

      {canResubmit && (
        <div className="order-detail__resubmit">
          <p className="order-detail__resubmit-text">This order was rejected. You can edit it and send it back for approval.</p>
          <button type="button" className="order-detail__resubmit-btn" onClick={handleEditResubmit}>
            Edit &amp; Resubmit
          </button>
        </div>
      )}

      <div className="order-detail__meta-grid">
        <div className="order-detail__meta-card">
          <p className="order-detail__meta-label">Ordered by</p>
          <p className="order-detail__meta-value">{order.placedBy?.name ?? '—'}</p>
          <p className="order-detail__meta-sub">{USERTYPE_LABELS[order.placedBy?.usertype] ?? order.placedBy?.usertype ?? ''}</p>
        </div>
        <div className="order-detail__meta-card">
          <p className="order-detail__meta-label">Ordering for</p>
          <p className="order-detail__meta-value">{order.orderingFor?.name ?? '—'}</p>
          <p className="order-detail__meta-sub">
            {[order.orderingFor?.type, order.orderingFor?.customerCode].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="order-detail__meta-card">
          <p className="order-detail__meta-label">Order date</p>
          <p className="order-detail__meta-value">{fmtOrderDate(order.placedAt)}</p>
        </div>
        {order.deliveryAddress && (
          <div className="order-detail__meta-card">
            <p className="order-detail__meta-label">Delivery address</p>
            <p className="order-detail__meta-value">{order.deliveryAddress.address}</p>
            <p className="order-detail__meta-sub">
              {[order.deliveryAddress.city, order.deliveryAddress.stateCode, order.deliveryAddress.pinCode]
                .filter(Boolean).join(', ')}
            </p>
          </div>
        )}
        {order.cfaCode && (
          <div className="order-detail__meta-card">
            <p className="order-detail__meta-label">CFA</p>
            <p className="order-detail__meta-value">{order.cfaName ?? order.cfaCode}</p>
            <p className="order-detail__meta-sub">{order.cfaCode}</p>
          </div>
        )}
      </div>

      <section className="order-detail__card">
        <p className="order-detail__card-title">Products ordered</p>
        <div className="order-detail__table-wrap">
          <table className="order-detail__table">
            <thead>
              <tr>
                <th>Material code</th>
                <th>Product</th>
                <th className="order-detail__table-th--num">Qty</th>
                <th className="order-detail__table-th--num">Free</th>
                <th className="order-detail__table-th--num">Total units</th>
                <th>Scheme</th>
                {showPrices && <th className="order-detail__table-th--num">Unit price</th>}
                {showPrices && <th className="order-detail__table-th--num">Discount</th>}
                {showPrices && <th className="order-detail__table-th--num">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.cartItemId ?? item.id}>
                  <td className="order-detail__td-material">{item.materialCode ?? '—'}</td>
                  <td className="order-detail__td-product">{item.productName}</td>
                  <td className="order-detail__td-num">{item.orderedQty}</td>
                  <td className="order-detail__td-num order-detail__td-free">
                    {item.freeQty > 0 ? `+${item.freeQty}` : '—'}
                  </td>
                  <td className="order-detail__td-num">
                    {(item.orderedQty ?? 0) + (item.freeQty ?? 0)}
                  </td>
                  <td className="order-detail__td-scheme">
                    {item.schemeLabel && item.schemeLabel !== 'No scheme applied'
                      ? <span className="order-detail__scheme-tag">{item.schemeLabel}</span>
                      : <span className="order-detail__td-nil">None</span>}
                  </td>
                  {showPrices && (
                    <td className="order-detail__td-num">{item.unitPrice != null ? formatCurrency(item.unitPrice) : '—'}</td>
                  )}
                  {showPrices && (
                    <td className="order-detail__td-num order-detail__td-discount">
                      {item.discountValue > 0 ? `− ${formatCurrency(item.discountValue)}` : '—'}
                    </td>
                  )}
                  {showPrices && (
                    <td className="order-detail__td-num order-detail__td-amount">{item.lineTotal != null ? formatCurrency(item.lineTotal) : '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="order-detail__bottom-grid">
        <section className="order-detail__card">
          <p className="order-detail__card-title">Order totals</p>
          <div className="order-detail__totals">
            <div className="order-detail__totals-row">
              <span>Total items</span>
              <span>{order.itemCount}</span>
            </div>
            <div className="order-detail__totals-row">
              <span>Total units delivered</span>
              <span>{order.totalUnits}</span>
            </div>
            {showPrices && order.totalDiscount > 0 && (
              <div className="order-detail__totals-row order-detail__totals-row--discount">
                <span>Scheme discount</span>
                <span>− {formatCurrency(order.totalDiscount)}</span>
              </div>
            )}
            {showPrices && (
              <div className="order-detail__totals-row order-detail__totals-row--grand">
                <span>Grand total payable</span>
                <span>{formatCurrency(order.totalPayable)}</span>
              </div>
            )}
          </div>
        </section>

        {paymentOptions.length > 0 && (
          <section className="order-detail__card">
            <p className="order-detail__card-title">Payment details</p>
            <div className="order-detail__totals">
              <div className="order-detail__totals-row">
                <span>Payment method</span>
                <span>{PAYMENT_OPTION_LABELS[order.paymentMethod] ?? '—'}</span>
              </div>
              <div className="order-detail__totals-row">
                <span>Payment status</span>
                {order.paymentStatus === 'Success' ? (
                  <span className="order-detail__payment-status order-detail__payment-status--ok">Success</span>
                ) : payNowOptions.length > 0 ? (
                  <button type="button" className="order-detail__pay-now-btn" onClick={() => setShowPayNow(true)}>
                    <PayIcon /> Pay Now
                  </button>
                ) : (
                  <span className="order-detail__payment-status order-detail__payment-status--pending">Pending</span>
                )}
              </div>
              {order.paymentReceivedDate && (
                <div className="order-detail__totals-row">
                  <span>Payment Received Date</span>
                  <span>{fmtChequeDate(order.paymentReceivedDate)}</span>
                </div>
              )}
              {order.paymentReceivedAmount != null && (
                <div className="order-detail__totals-row">
                  <span>Payment Received Amount</span>
                  <span>{formatCurrency(order.paymentReceivedAmount)}</span>
                </div>
              )}
            </div>

            {canConfirmPayment && order.paymentStatus !== 'Success' && (
              <form className="order-detail__dispatch-form" onSubmit={handlePaymentSubmit}>
                <div className="order-detail__dispatch-row">
                  <label className="order-detail__dispatch-field">
                    <span>Payment Received Date *</span>
                    <input
                      type="date"
                      required
                      max={todayInputValue}
                      value={paymentForm.receivedDate}
                      onChange={e => setPaymentForm(f => ({ ...f, receivedDate: e.target.value }))}
                    />
                  </label>
                  <label className="order-detail__dispatch-field">
                    <span>Payment Value *</span>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={paymentForm.amount}
                      onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                    />
                  </label>
                </div>
                {paymentError && <p className="order-detail__dispatch-error">{paymentError}</p>}
                <button type="submit" className="order-detail__action-btn order-detail__action-btn--approve" disabled={paymentSaving}>
                  {paymentSaving ? 'Saving…' : 'Confirm Payment Received'}
                </button>
              </form>
            )}

            {(chequeDetails || canCaptureCheque) && (
              <div className="order-detail__cheque">
                <p className="order-detail__cheque-title">
                  {order.paymentMethod === 'pdc-delivery' ? 'Cheque details' : 'Post-dated cheque details'}
                </p>
                {chequeDetails && (
                  <div className="order-detail__totals">
                    <div className="order-detail__totals-row">
                      <span>Bank name</span>
                      <span>{chequeDetails.bankName ?? '—'}</span>
                    </div>
                    <div className="order-detail__totals-row">
                      <span>Cheque number</span>
                      <span>{chequeDetails.chequeNumber ?? '—'}</span>
                    </div>
                    <div className="order-detail__totals-row">
                      <span>Cheque date</span>
                      <span>{fmtChequeDate(chequeDetails.chequeDate)}</span>
                    </div>
                    <div className="order-detail__totals-row">
                      <span>Cheque photo</span>
                      {chequeDetails.chequePhoto?.url ? (
                        <button
                          type="button"
                          className="order-detail__doc-link"
                          onClick={() => setShowChequePhoto(true)}
                        >
                          View
                          <svg viewBox="0 0 20 14" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 7c1.8-3.6 5-5.4 9-5.4s7.2 1.8 9 5.4c-1.8 3.6-5 5.4-9 5.4s-7.2-1.8-9-5.4Z" />
                            <circle cx="10" cy="7" r="2.2" fill="currentColor" stroke="none" />
                          </svg>
                        </button>
                      ) : chequeDetails.chequePhoto?.urlUnavailable ? (
                        <span
                          className="order-detail__docs-status order-detail__docs-status--error"
                          title="The photo is on file but couldn't be retrieved right now — please try again shortly"
                        >
                          Unavailable — try again shortly
                        </span>
                      ) : (
                        <span className="order-detail__doc-missing">Not submitted</span>
                      )}
                    </div>
                  </div>
                )}

                {canCaptureCheque && (
                  <form className="order-detail__dispatch-form" onSubmit={handleChequeSubmit}>
                    <label className="order-detail__dispatch-field">
                      <span>Bank name *</span>
                      {addingBank ? (
                        <div className="order-detail__dispatch-row">
                          <input
                            autoFocus
                            placeholder="New bank name"
                            value={newBankName}
                            onChange={e => setNewBankName(e.target.value)}
                          />
                          <button type="button" className="aq__btn aq__btn--view" onClick={confirmNewBank}>✓</button>
                          <button type="button" className="aq__btn aq__btn--view" onClick={() => { setAddingBank(false); setNewBankName('') }}>✕</button>
                        </div>
                      ) : (
                        <div className="order-detail__dispatch-row">
                          <select
                            value={chequeForm.bankName}
                            onChange={e => setChequeForm(f => ({ ...f, bankName: e.target.value }))}
                          >
                            <option value="">Select a bank</option>
                            {bankOptions.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                          <button type="button" className="aq__btn aq__btn--view" title="Add new bank" onClick={() => setAddingBank(true)}>+</button>
                        </div>
                      )}
                    </label>
                    <div className="order-detail__dispatch-row">
                      <label className="order-detail__dispatch-field">
                        <span>Cheque number *</span>
                        <input
                          value={chequeForm.chequeNumber}
                          maxLength={6}
                          inputMode="numeric"
                          onChange={e => setChequeForm(f => ({ ...f, chequeNumber: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                        />
                      </label>
                      <label className="order-detail__dispatch-field">
                        <span>Cheque date *</span>
                        <input
                          type="date"
                          min={minChequeDate()}
                          max={maxChequeDate()}
                          value={chequeForm.chequeDate}
                          onChange={e => setChequeForm(f => ({ ...f, chequeDate: e.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="order-detail__dispatch-field">
                      <span>Cheque photo {!chequeDetails?.chequePhoto?.url && '*'}</span>
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png"
                        onChange={e => setChequePhotoFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {chequeError && <p className="order-detail__dispatch-error">{chequeError}</p>}
                    <button type="submit" className="order-detail__action-btn order-detail__action-btn--approve" disabled={chequeSaving}>
                      {chequeSaving ? 'Saving…' : 'Save Cheque Details'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {ccavenueOutcome && (
              <div className="order-detail__cheque">
                <p className="order-detail__cheque-title">Online payment</p>
                <div className="order-detail__totals">
                  <div className="order-detail__totals-row">
                    <span>Status</span>
                    <span className={`order-detail__payment-status order-detail__payment-status--${ccavenueOutcome.status === 'Success' ? 'ok' : 'failure'}`}>
                      {ccavenueOutcome.status}
                    </span>
                  </div>
                  {ccavenueOutcome.trackingId && (
                    <div className="order-detail__totals-row">
                      <span>Reference</span>
                      <span>{ccavenueOutcome.trackingId}</span>
                    </div>
                  )}
                  {ccavenueOutcome.paymentMode && (
                    <div className="order-detail__totals-row">
                      <span>Mode</span>
                      <span>{ccavenueOutcome.paymentMode}</span>
                    </div>
                  )}
                  {ccavenueOutcome.bankRefNo && (
                    <div className="order-detail__totals-row">
                      <span>Bank ref. no.</span>
                      <span>{ccavenueOutcome.bankRefNo}</span>
                    </div>
                  )}
                  {ccavenueOutcome.failureMessage && (
                    <div className="order-detail__totals-row">
                      <span>Failure reason</span>
                      <span>{ccavenueOutcome.failureMessage}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {paymentLink && !ccavenueOutcome && (
              <div className="order-detail__cheque">
                <p className="order-detail__cheque-title">Payment link</p>
                <div className="order-detail__totals">
                  <div className="order-detail__totals-row">
                    <span>Status</span>
                    <span className="order-detail__payment-status order-detail__payment-status--pending">
                      Sent — awaiting payment
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {(hasDispatchDetails || canCfaEditOrder) && (
          <section className="order-detail__card">
            <p className="order-detail__card-title">Dispatch Details</p>
            {hasDispatchDetails && (
              <div className="order-detail__totals">
                <div className="order-detail__totals-row">
                  <span>LR Number</span>
                  <span>{order.lrNumber ?? '—'}</span>
                </div>
                <div className="order-detail__totals-row">
                  <span>LR Date</span>
                  <span>{order.lrDate ? fmtChequeDate(order.lrDate) : '—'}</span>
                </div>
                <div className="order-detail__totals-row">
                  <span>SAP Order Number</span>
                  <span>{order.sapOrderNumber ?? '—'}</span>
                </div>
                <div className="order-detail__totals-row">
                  <span>Proof of Delivery</span>
                  {order.podUrl ? (
                    <a href={order.podUrl} target="_blank" rel="noopener noreferrer" className="order-detail__doc-link">
                      View
                    </a>
                  ) : order.podBlobName ? (
                    <span
                      className="order-detail__docs-status order-detail__docs-status--error"
                      title="The file is on record but couldn't be retrieved right now — please try again shortly"
                    >
                      Unavailable — try again shortly
                    </span>
                  ) : (
                    <span className="order-detail__doc-missing">Not uploaded</span>
                  )}
                </div>
              </div>
            )}

            {canCfaEditOrder && !order.podBlobName && (
              <form className="order-detail__dispatch-form" onSubmit={handleDispatchSubmit}>
                <div className="order-detail__dispatch-row">
                  <label className="order-detail__dispatch-field">
                    <span>LR Number *</span>
                    <input
                      type="text"
                      required
                      value={dispatchForm.lrNumber}
                      onChange={e => setDispatchForm(f => ({ ...f, lrNumber: e.target.value }))}
                    />
                  </label>
                  <label className="order-detail__dispatch-field">
                    <span>LR Date *</span>
                    <input
                      type="date"
                      required
                      max={todayInputValue}
                      value={dispatchForm.lrDate}
                      onChange={e => setDispatchForm(f => ({ ...f, lrDate: e.target.value }))}
                    />
                  </label>
                </div>
                <label className="order-detail__dispatch-field">
                  <span>Proof of Delivery (PDF/JPG/PNG, max 10MB)</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => setPodFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="order-detail__dispatch-field">
                  <span>Remarks</span>
                  <textarea
                    rows={2}
                    value={dispatchForm.remarks}
                    onChange={e => setDispatchForm(f => ({ ...f, remarks: e.target.value }))}
                  />
                </label>
                {dispatchError && <p className="order-detail__dispatch-error">{dispatchError}</p>}
                <button type="submit" className="order-detail__action-btn order-detail__action-btn--approve" disabled={dispatchSaving}>
                  {dispatchSaving ? 'Saving…' : 'Save Dispatch Details'}
                </button>
              </form>
            )}
          </section>
        )}
      </div>

      {(rules.documents.order.length > 0 || isMumbaiCustomer) && (
        <section className="order-detail__card">
          <p className="order-detail__card-title">Documents submitted</p>
          <ul className="order-detail__docs">
            {rules.documents.order.map((doc) => (
              <li key={doc.key} className="order-detail__docs-row">
                <svg viewBox="0 0 16 20" width="13" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 1 L9 6 L14 6 M9 1 L2 1 Q1 1 1 2 L1 18 Q1 19 2 19 L14 19 Q15 19 15 18 L15 6 Z" />
                  <path d="M4 10 L12 10 M4 13 L10 13" />
                </svg>
                <span className="order-detail__docs-name">{doc.label}</span>
                {order.extraData?.[doc.key]?.url ? (
                  <a
                    href={order.extraData[doc.key].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="order-detail__doc-link"
                  >
                    View
                  </a>
                ) : order.extraData?.[doc.key]?.urlUnavailable ? (
                  <span
                    className="order-detail__docs-status order-detail__docs-status--error"
                    title="The document is on file but couldn't be retrieved right now — please try again shortly"
                  >
                    Unavailable — try again shortly
                  </span>
                ) : (
                  <span className="order-detail__docs-status order-detail__docs-status--missing">Not submitted</span>
                )}
              </li>
            ))}
            {isMumbaiCustomer && (
              <li className="order-detail__docs-row">
                <svg viewBox="0 0 16 20" width="13" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 1 L9 6 L14 6 M9 1 L2 1 Q1 1 1 2 L1 18 Q1 19 2 19 L14 19 Q15 19 15 18 L15 6 Z" />
                  <path d="M4 10 L12 10 M4 13 L10 13" />
                </svg>
                <span className="order-detail__docs-name">Security Cheque</span>
                {securityCheque?.url ? (
                  <a
                    href={securityCheque.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="order-detail__doc-link"
                  >
                    View
                  </a>
                ) : securityCheque?.unavailable ? (
                  <span
                    className="order-detail__docs-status order-detail__docs-status--error"
                    title="The document is on file but couldn't be retrieved right now — please try again shortly"
                  >
                    Unavailable — try again shortly
                  </span>
                ) : (
                  <span className="order-detail__docs-status order-detail__docs-status--missing">Not submitted</span>
                )}
              </li>
            )}
          </ul>
        </section>
      )}

      {canAct && (
        <div className="order-detail__actions">
          <button className="order-detail__action-btn order-detail__action-btn--approve" onClick={() => setConfirmAction('approve')}>
            Approve
          </button>
          <button className="order-detail__action-btn order-detail__action-btn--reject" onClick={() => setConfirmAction('reject')}>
            Reject
          </button>
        </div>
      )}

      {confirmAction === 'approve' && (
        <ConfirmDialog
          message="Are you sure you want to approve this order?"
          confirmLabel="Approve Order"
          confirmVariant="approve"
          onConfirm={handleApprove}
          onCancel={closeConfirm}
        />
      )}

      {confirmAction === 'reject' && (
        <ConfirmDialog
          message="Are you sure you want to reject this order?"
          confirmLabel="Reject Order"
          confirmVariant="reject"
          onConfirm={handleReject}
          onCancel={closeConfirm}
          reasonValue={rejectReason}
          onReasonChange={setRejectReason}
        />
      )}

      {confirmAction === 'dispatch' && (
        <ConfirmDialog
          message={`Save dispatch details for order ${order.orderNumber}? LR Number "${dispatchForm.lrNumber.trim()}" dated ${new Date(dispatchForm.lrDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} will be recorded against this order.`}
          confirmLabel="Save Dispatch Details"
          confirmVariant="approve"
          onConfirm={handleDispatchConfirm}
          onCancel={closeConfirm}
        />
      )}

      {confirmAction === 'payment' && (
        <ConfirmDialog
          message={`Confirm that ${formatCurrency(Number(paymentForm.amount))} was received on ${new Date(paymentForm.receivedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} for order ${order.orderNumber}? This will update the payment status.`}
          confirmLabel="Confirm Payment Received"
          confirmVariant="approve"
          onConfirm={handlePaymentConfirm}
          onCancel={closeConfirm}
        />
      )}

      {confirmAction === 'cheque' && (
        <ConfirmDialog
          message={`Save cheque details for order ${order.orderNumber}? Cheque "${chequeForm.chequeNumber.trim()}" (${chequeForm.bankName}) dated ${new Date(chequeForm.chequeDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} will be recorded against this order.`}
          confirmLabel="Save Cheque Details"
          confirmVariant="approve"
          onConfirm={handleChequeConfirm}
          onCancel={closeConfirm}
        />
      )}

      {showChequePhoto && chequeDetails?.chequePhoto?.url && (
        <>
          <div className="order-detail__photo-overlay" onClick={() => setShowChequePhoto(false)} aria-hidden="true" />
          <div className="order-detail__photo-modal" role="dialog" aria-modal="true" aria-label="Cheque photo">
            <button
              type="button"
              className="order-detail__photo-close"
              onClick={() => setShowChequePhoto(false)}
              aria-label="Close cheque photo"
            >
              &times;
            </button>
            <img
              src={chequeDetails.chequePhoto.url}
              alt={`Cheque photo${chequeDetails.chequePhoto.originalName ? ` — ${chequeDetails.chequePhoto.originalName}` : ''}`}
              className="order-detail__photo-image"
            />
          </div>
        </>
      )}

      {logOpen && (
        <AuditLogDialog
          title={`Approval log — ${order.orderNumber}`}
          entries={logEntries}
          loading={logLoading}
          onClose={() => setLogOpen(false)}
        />
      )}

      {paymentLogOpen && (
        <PaymentLogDialog
          title={`Payment log — ${order.orderNumber}`}
          entries={paymentLogEntries}
          loading={paymentLogLoading}
          onClose={() => setPaymentLogOpen(false)}
        />
      )}

      {showPayNow && (
        <PayNowModal
          order={order}
          payNowOptions={payNowOptions}
          onClose={() => setShowPayNow(false)}
          onLinkCreated={() => refreshOrder(order.id)}
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

// Looks up the order first (outside any division-rules dependency), then hands
// off to OrderDetailPageBody wrapped in a DivisionConfigProvider keyed to that
// order's own division — see the comment on OrderDetailPageBody for why.
function OrderDetailPage() {
  const { state } = useLocation()
  const id = state?.id
  const navigate = useNavigate()
  const { orders } = useOrders()
  const order = id ? orders.find(o => o.id === id) : null

  if (!order) {
    return (
      <div className="order-detail">
        <button type="button" className="order-detail__back" onClick={() => navigate('/dashboard')}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div className="order-detail__empty">
          <p>{!id || orders.length > 0 ? 'Order not found.' : 'Loading…'}</p>
        </div>
      </div>
    )
  }

  return (
    <DivisionConfigProvider divisionCodeOverride={order.divisionCode}>
      <OrderDetailPageBody order={order} />
    </DivisionConfigProvider>
  )
}

export default OrderDetailPage
