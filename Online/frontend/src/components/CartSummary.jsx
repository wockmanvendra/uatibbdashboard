import { useEffect, useState } from 'react'
import QuantityStepper from './QuantityStepper.jsx'
import FileDropzone from '../registration/components/FileDropzone.jsx'
import { fileValidator } from '../registration/validation.js'
import { lookupPinCode } from '../registration/api.js'
import { formatCurrency } from '../utils/currency.js'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { useOrdering } from '../context/OrderingContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { PAYMENT_OPTION_LABELS } from '../data/paymentOptions.js'
import { bankMasterApi, uploadsApi, customersApi, stateMasterApi } from '../lib/api.js'
import { getOrderQuantityIssue, isValidOrderQuantity } from '../utils/orderQuantity.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import './CartSummary.css'

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function minChequeDate() {
  return formatDateInput(new Date())
}

function maxChequeDate() {
  const thirtyDaysOut = new Date()
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30)
  return formatDateInput(thirtyDaysOut)
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function CartRow({ item, isEditing, onToggleEdit, onUpdateQuantity, onRemove, showPrices }) {
  const hasScheme = !!item.scheme
  const isGift = item.scheme?.type === 'gift'
  const showGift = hasScheme && isGift
  const showFreeQty = hasScheme && !isGift && item.freeQty > 0
  const showTotal = hasScheme && !isGift && item.freeQty > 0
  const quantityIssue = getOrderQuantityIssue(item.orderedQty, item)

  return (
    <li className="cart-row">
      <div className="cart-row__top">
        <div className="cart-row__heading">
          <span className="cart-row__name">{item.productName}</span>
          {item.schemeLabel && <span className="cart-row__scheme">{item.schemeLabel}</span>}
        </div>
        <button
          type="button"
          className="cart-row__remove"
          onClick={() => onRemove(item.cartItemId)}
          aria-label={`Remove ${item.productName} from cart`}
        >
          <RemoveIcon />
        </button>
      </div>

      <div className="cart-row__stats">
        <div className="cart-row__stat">
          <span className="cart-row__stat-label">Ordered</span>
          {isEditing ? (
            <QuantityStepper
              value={item.orderedQty}
              onChange={(next) => onUpdateQuantity(item.cartItemId, next)}
              min={item.initMinOrderQty ?? item.minOrderQty ?? 1}
              max={item.maxOrderQty}
              step={item.minOrderQty ?? 1}
              initialStep={item.initMinOrderQty ?? item.minOrderQty ?? 1}
              ariaLabel={`Edit ordered quantity for ${item.productName}`}
            />
          ) : (
            <span className="cart-row__stat-value">{item.orderedQty}</span>
          )}
        </div>
        {showGift && (
          <div className="cart-row__stat">
            <span className="cart-row__stat-label">Free gift</span>
            <span className={`cart-row__stat-value${item.giftUnlocked ? ' cart-row__stat-value--accent' : ''}`}>
              {item.giftUnlocked ? item.scheme.giftName : 'Not unlocked'}
            </span>
          </div>
        )}
        {showFreeQty && (
          <div className="cart-row__stat">
            <span className="cart-row__stat-label">Free</span>
            <span className="cart-row__stat-value cart-row__stat-value--accent">+{item.freeQty}</span>
          </div>
        )}
        {showTotal && (
          <div className="cart-row__stat">
            <span className="cart-row__stat-label">Total</span>
            <span className="cart-row__stat-value cart-row__stat-value--total">{item.totalQty}</span>
          </div>
        )}
      </div>

      {quantityIssue && (
        <p className="cart-panel__payment-error" role="alert">{quantityIssue}</p>
      )}

      {showPrices && (
        <div className="cart-row__pricing">
          <div className="cart-row__price">
            <span className="cart-row__price-label">Unit price</span>
            <span className="cart-row__price-value">{formatCurrency(item.price)}</span>
          </div>
          <div className="cart-row__price">
            <span className="cart-row__price-label">Amount payable</span>
            <span className="cart-row__price-value">{formatCurrency(item.payableAmount)}</span>
          </div>
          {item.discountAmount > 0 && (
            <div className="cart-row__price">
              <span className="cart-row__price-label">Discount</span>
              <span className="cart-row__price-value cart-row__price-value--accent">
                − {formatCurrency(item.discountAmount)}
              </span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="cart-row__edit"
        onClick={() => onToggleEdit(item.cartItemId)}
        disabled={isEditing && !!quantityIssue}
      >
        {isEditing ? 'Done editing' : 'Edit quantity'}
      </button>
    </li>
  )
}

function CartSummary({
  items,
  totalUnits,
  totalPayable,
  totalDiscount,
  onRemove,
  onUpdateQuantity,
  onClearCart,
  onPlaceOrder,
}) {
  const [editingId, setEditingId] = useState(null)
  const [documentFiles, setDocumentFiles] = useState({})
  const [documentErrors, setDocumentErrors] = useState({})
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [bankOptions, setBankOptions] = useState([])
  const [addingBank, setAddingBank] = useState(false)
  const [newBankName, setNewBankName] = useState('')
  const [chequeBank, setChequeBank] = useState('')
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [chequePhoto, setChequePhoto] = useState(null)
  const [chequeErrors, setChequeErrors] = useState({})
  const [placingOrder, setPlacingOrder] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showOrderConfirm, setShowOrderConfirm] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [customerDetail, setCustomerDetail] = useState(null)
  const [customerDetailStatus, setCustomerDetailStatus] = useState('idle')
  const [selectedAddressKey, setSelectedAddressKey] = useState('primary')
  const [addressError, setAddressError] = useState('')
  const [addingAddress, setAddingAddress] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)
  const [newAddress, setNewAddress] = useState('')
  const [newPinCode, setNewPinCode] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newState, setNewState] = useState('')
  const [newAddressErrors, setNewAddressErrors] = useState({})
  const [pinLookupStatus, setPinLookupStatus] = useState('idle')
  const [stateOptions, setStateOptions] = useState([])
  const { rules } = useDivisionConfig()
  const { orderingFor, resubmitOrderId } = useOrdering()
  const { user } = useAuth()
  const { showPrices, minOrderValue, minOrderValueByType, paymentOptions: allPaymentOptions } = rules.orderEntry
  // A logged-in customer paying for their own order can't send a payment link
  // to "themselves" — that option only makes sense when a TM collects payment
  // from someone else. Everything else the division allows stays available.
  const isCustomerLogin = ['patient', 'doctor', 'hospital', 'doctor-pharmacy'].includes(user?.usertype)
  const paymentOptions = isCustomerLogin ? allPaymentOptions.filter(o => o !== 'payment-link') : allPaymentOptions
  const customerType = orderingFor?.customerType
  const effectiveMinOrderValue = (minOrderValueByType?.[customerType] || 0) || (minOrderValue || 0)
  const orderDocuments = rules.documents.order
  const isChequePayment = paymentMethod === 'post-dated-cheque'
  const isMumbaiCustomer = String(orderingFor?.city ?? '').trim().toLowerCase() === 'mumbai'
  const securityCheque = isMumbaiCustomer ? orderingFor?.documents?.securityCheque : null

  // Fetched fresh into local state — never written back to OrderingContext, so
  // the customer an order is for stays exactly as locked (notably during resubmit,
  // where orderingFor is only the order's lightweight {id, name, type} snapshot).
  const loadCustomerDetail = () => {
    if (!orderingFor?.id) { setCustomerDetail(null); setCustomerDetailStatus('idle'); return }
    setCustomerDetailStatus('loading')
    customersApi.get(orderingFor.id)
      .then(c => {
        setCustomerDetail(c)
        setSelectedAddressKey(c.address?.trim() ? 'primary' : '')
        setCustomerDetailStatus('success')
      })
      .catch(() => setCustomerDetailStatus('error'))
  }

  useEffect(loadCustomerDetail, [orderingFor?.id])

  useEffect(() => {
    stateMasterApi.list().then(setStateOptions).catch(() => setStateOptions([]))
  }, [])

  useEffect(() => {
    bankMasterApi.list().then(setBankOptions).catch(console.error)
  }, [])

  const availableAddresses = customerDetail ? [
    ...(customerDetail.address?.trim()
      ? [{ key: 'primary', address: customerDetail.address, pinCode: customerDetail.pinCode, city: customerDetail.city, state: customerDetail.state }]
      : []),
    ...customerDetail.addresses.map(a => ({ key: `addr-${a.id}`, address: a.address, pinCode: a.pinCode, city: a.city, state: a.state })),
  ] : []

  useEffect(() => {
    if (customerDetailStatus === 'success' && availableAddresses.length === 0) setAddingAddress(true)
  }, [customerDetailStatus, availableAddresses.length])
  const selectedDeliveryAddress = availableAddresses.find(a => a.key === selectedAddressKey) ?? null

  const handleNewPinCodeChange = async (event) => {
    const { value } = event.target
    if (!/^\d{0,6}$/.test(value)) return
    setNewPinCode(value)
    if (value.length !== 6) { setPinLookupStatus('idle'); return }
    setPinLookupStatus('loading')
    try {
      const { city, state } = await lookupPinCode(value)
      setNewCity(city)
      setNewState(state)
      setPinLookupStatus('success')
    } catch {
      setPinLookupStatus('error')
    }
  }

  const handleSaveNewAddress = async () => {
    const errors = {}
    if (!newAddress.trim()) errors.address = 'Address is required.'
    if (!/^\d{6}$/.test(newPinCode)) errors.pinCode = 'Enter a valid 6-digit PIN code.'
    if (!newCity.trim()) errors.city = 'City is required.'
    if (!newState) errors.state = 'State is required.'
    if (Object.keys(errors).length > 0) {
      setNewAddressErrors(errors)
      return
    }
    setNewAddressErrors({})
    setSavingAddress(true)
    try {
      const created = await customersApi.addAddress(orderingFor.id, {
        address: newAddress.trim(), pinCode: newPinCode, city: newCity.trim(), state: newState,
      })
      setCustomerDetail(curr => ({ ...curr, addresses: [...curr.addresses, created] }))
      setSelectedAddressKey(`addr-${created.id}`)
      setAddressError('')
      setAddingAddress(false)
      setNewAddress(''); setNewPinCode(''); setNewCity(''); setNewState(''); setPinLookupStatus('idle')
    } catch (err) {
      setNewAddressErrors({ address: err.message })
    } finally {
      setSavingAddress(false)
    }
  }

  const toggleEdit = (cartItemId) => {
    setEditingId((current) => (current === cartItemId ? null : cartItemId))
  }

  const handleDocumentChange = (key, file) => {
    setDocumentFiles((curr) => ({ ...curr, [key]: file }))
    setDocumentErrors((curr) => ({ ...curr, [key]: undefined }))
  }

  const confirmNewBank = async () => {
    const trimmed = newBankName.trim()
    if (!trimmed) return
    try {
      await bankMasterApi.add(trimmed)
      setBankOptions((curr) => Array.from(new Set([...curr, trimmed])).sort())
      setChequeBank(trimmed)
      setNewBankName('')
      setAddingBank(false)
      setChequeErrors((curr) => ({ ...curr, bank: undefined }))
    } catch (err) {
      setChequeErrors((curr) => ({ ...curr, bank: err.message }))
    }
  }

  const documentsValid = () => {
    const errors = {}
    for (const doc of orderDocuments) {
      if (doc.required) {
        const result = fileValidator(documentFiles[doc.key])
        if (result !== true) errors[doc.key] = result
      }
    }
    if (Object.keys(errors).length > 0) {
      setDocumentErrors(errors)
      return false
    }
    return true
  }

  const submitOrder = async () => {
    if (isChequePayment) {
      const chequeFieldErrors = {}
      if (!chequeBank) chequeFieldErrors.bank = 'Select a bank.'
      if (!chequeNumber.trim()) chequeFieldErrors.number = 'Enter the cheque number.'
      if (!chequeDate) chequeFieldErrors.date = 'Enter the cheque date.'
      else if (chequeDate < minChequeDate()) chequeFieldErrors.date = 'Cheque date cannot be in the past.'
      else if (chequeDate > maxChequeDate()) chequeFieldErrors.date = "Cheque date can't be more than 30 days from today."
      if (!chequePhoto) chequeFieldErrors.photo = 'Upload the cheque photo.'
      if (Object.keys(chequeFieldErrors).length > 0) {
        setChequeErrors(chequeFieldErrors)
        return
      }
      setChequeErrors({})
    }

    setPlacingOrder(true)

    // Nests uploaded order documents under the owning order's own uuid in blob
    // storage — resubmit already has one (resubmitOrderId), a fresh placement
    // doesn't yet, so generate it now and carry it through to order creation
    // (see OrdersContext.placeOrder) so the row ends up with this exact id.
    const orderEntityId = resubmitOrderId || crypto.randomUUID()

    const uploadedDocuments = {}
    if (orderDocuments.length > 0) {
      const uploadErrors = {}
      for (const doc of orderDocuments) {
        const file = documentFiles[doc.key]
        if (!file) continue
        try {
          const uploaded = await uploadsApi.upload(file, 'orders', orderEntityId)
          // Persist the durable blob key under `url` (matches the customer/product
          // convention) — resolved back into a live link whenever the order is read.
          uploadedDocuments[doc.key] = { url: uploaded.blobName, originalName: uploaded.originalName }
        } catch (err) {
          uploadErrors[doc.key] = err.message
        }
      }
      if (Object.keys(uploadErrors).length > 0) {
        setDocumentErrors((curr) => ({ ...curr, ...uploadErrors }))
        setPlacingOrder(false)
        return
      }
    }

    let chequeDetails = null
    if (isChequePayment) {
      try {
        const chequePhotoMeta = await uploadsApi.upload(chequePhoto, 'orders', orderEntityId)
        chequeDetails = {
          bankName: chequeBank, chequeNumber: chequeNumber.trim(), chequeDate,
          chequePhoto: { url: chequePhotoMeta.blobName, originalName: chequePhotoMeta.originalName },
        }
      } catch (err) {
        setChequeErrors({ photo: err.message })
        setPlacingOrder(false)
        return
      }
    }

    await onPlaceOrder(
      orderDocuments.length > 0 ? uploadedDocuments : null,
      paymentOptions.length > 0 ? paymentMethod : null,
      chequeDetails,
      remarks.trim() || null,
      selectedDeliveryAddress
        ? { address: selectedDeliveryAddress.address, pinCode: selectedDeliveryAddress.pinCode, city: selectedDeliveryAddress.city, state: selectedDeliveryAddress.state }
        : null,
      orderEntityId,
    )

    setPlacingOrder(false)
    setShowPaymentModal(false)
    setChequeBank('')
    setChequeNumber('')
    setChequeDate('')
    setChequePhoto(null)
    setRemarks('')
  }

  const handleProceedToPayment = () => {
    if (!selectedDeliveryAddress) {
      setAddressError('Select or add a delivery address.')
      return
    }
    setAddressError('')
    if (!documentsValid()) return
    if (paymentOptions.length > 0) {
      setShowPaymentModal(true)
      return
    }
    setShowOrderConfirm(true)
  }

  const handleConfirmPayment = () => {
    if (!paymentMethod) {
      setPaymentError('Select a payment method to continue.')
      return
    }
    setShowOrderConfirm(true)
  }

  const closePaymentModal = () => {
    if (placingOrder) return
    setShowPaymentModal(false)
    setPaymentError('')
  }

  const belowMinimum = effectiveMinOrderValue > 0 && totalPayable < effectiveMinOrderValue
  const hasInvalidQuantities = items.some((item) => !isValidOrderQuantity(item.orderedQty, item))

  return (
    <>
      <div className="cart-summary__items">
        <div className="cart-summary__items-header">
          <span className="cart-summary__items-count">
            {items.length} item{items.length === 1 ? '' : 's'} &middot; {totalUnits} units total
          </span>
          <button type="button" className="cart-panel__clear" onClick={onClearCart}>
            Remove all
          </button>
        </div>

        <ul className="cart-panel__list">
          {items.map((item) => (
            <CartRow
              key={item.cartItemId}
              item={item}
              isEditing={editingId === item.cartItemId}
              onToggleEdit={toggleEdit}
              onUpdateQuantity={onUpdateQuantity}
              onRemove={onRemove}
              showPrices={showPrices}
            />
          ))}
        </ul>
      </div>

      <div className="cart-summary__checkout">
        <p className="cart-panel__eyebrow">Order summary</p>

        {showPrices && (
          <div className="cart-panel__summary">
            <div className="cart-panel__summary-row">
              <span>Order total</span>
              <span className="cart-panel__summary-value">{formatCurrency(totalPayable)}</span>
            </div>
            {totalDiscount > 0 && (
              <div className="cart-panel__summary-row cart-panel__summary-row--accent">
                <span>Total discount</span>
                <span className="cart-panel__summary-value">− {formatCurrency(totalDiscount)}</span>
              </div>
            )}
          </div>
        )}

        {belowMinimum && (
          <p className="cart-panel__min-order-notice" role="alert">
            {showPrices
              ? `Add ${formatCurrency(effectiveMinOrderValue - totalPayable)} more to reach the minimum order value of ${formatCurrency(effectiveMinOrderValue)}.`
              : `This order does not meet the minimum order value required to be placed.`}
          </p>
        )}

        <div className="cart-panel__documents">
          <p className="cart-panel__documents-title">Delivery Address</p>
          {customerDetailStatus === 'loading' && (
            <p className="cart-panel__payment-error" style={{ color: 'var(--ink-faint)' }}>Loading your saved addresses…</p>
          )}
          {customerDetailStatus === 'error' && (
            <p className="cart-panel__payment-error" role="alert">
              Couldn&rsquo;t load saved addresses.{' '}
              <button type="button" className="cart-row__edit" onClick={loadCustomerDetail}>Retry</button>
            </p>
          )}
          {customerDetailStatus === 'success' && availableAddresses.length === 0 && !addingAddress && (
            <p className="cart-panel__payment-error" style={{ color: 'var(--ink-faint)' }}>
              No address on file — please add one below.
            </p>
          )}
          {availableAddresses.map((addr) => (
            <label key={addr.key} className="cart-panel__payment-option">
              <input
                type="radio"
                name="delivery-address"
                checked={selectedAddressKey === addr.key}
                onChange={() => { setSelectedAddressKey(addr.key); setAddressError('') }}
              />
              {addr.address}, {addr.city}, {addr.state} – {addr.pinCode}
            </label>
          ))}

          {addingAddress ? (
            <div className="payment-modal__cheque">
              <label className="cart-panel__cheque-field">
                <span>Address<span className="cart-panel__cheque-required"> *</span></span>
                <textarea rows={2} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                {newAddressErrors.address && <span className="cart-panel__cheque-error">{newAddressErrors.address}</span>}
              </label>
              <label className="cart-panel__cheque-field">
                <span>PIN Code<span className="cart-panel__cheque-required"> *</span></span>
                <input inputMode="numeric" value={newPinCode} onChange={handleNewPinCodeChange} />
                {pinLookupStatus === 'success' && <span className="cart-panel__cheque-error" style={{ color: 'var(--steel-deep)' }}>City &amp; state auto-filled — edit if needed</span>}
                {pinLookupStatus === 'error' && <span className="cart-panel__cheque-error">Could not auto-fill — enter city &amp; state manually</span>}
                {newAddressErrors.pinCode && <span className="cart-panel__cheque-error">{newAddressErrors.pinCode}</span>}
              </label>
              <label className="cart-panel__cheque-field">
                <span>City<span className="cart-panel__cheque-required"> *</span></span>
                <input value={newCity} onChange={(e) => setNewCity(e.target.value)} />
                {newAddressErrors.city && <span className="cart-panel__cheque-error">{newAddressErrors.city}</span>}
              </label>
              <label className="cart-panel__cheque-field">
                <span>State<span className="cart-panel__cheque-required"> *</span></span>
                <select value={newState} onChange={(e) => setNewState(e.target.value)}>
                  <option value="">Select state…</option>
                  {stateOptions.map((s) => <option key={s.stateCode} value={s.stateName}>{s.stateName}</option>)}
                </select>
                {newAddressErrors.state && <span className="cart-panel__cheque-error">{newAddressErrors.state}</span>}
              </label>
              <div className="cart-panel__cheque-bank-row">
                <button type="button" className="cart-row__edit" onClick={handleSaveNewAddress} disabled={savingAddress}>
                  {savingAddress ? 'Saving…' : 'Save address'}
                </button>
                <button type="button" className="cart-row__edit" onClick={() => { setAddingAddress(false); setNewAddressErrors({}) }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            // "+ Add new address" temporarily disabled (may be re-enabled later) —
            // uncomment to restore. Note: customers with zero saved addresses still
            // get the form automatically (see the addingAddress useEffect above);
            // this only removes the "add another address" option for customers who
            // already have one on file.
            // <button type="button" className="cart-row__edit" onClick={() => setAddingAddress(true)}>
            //   + Add new address
            // </button>
            null
          )}
          {addressError && <p className="cart-panel__payment-error" role="alert">{addressError}</p>}
        </div>

        {orderDocuments.length > 0 && (
          <div className="cart-panel__documents">
            <p className="cart-panel__documents-title">Documents required</p>
            {orderDocuments.map((doc) => (
              <FileDropzone
                key={doc.key}
                label={doc.label}
                required={doc.required}
                value={documentFiles[doc.key] ?? null}
                onChange={(file) => handleDocumentChange(doc.key, file)}
                error={documentErrors[doc.key]}
              />
            ))}
          </div>
        )}

        {isMumbaiCustomer && (
          <div className="cart-panel__documents">
            <p className="cart-panel__documents-title">Security cheque on file</p>
            {securityCheque?.url ? (
              <a href={securityCheque.url} target="_blank" rel="noopener noreferrer" className="cart-panel__security-cheque-link">
                View security cheque
              </a>
            ) : (
              <span className="cart-panel__security-cheque-missing">No security cheque on file for this customer.</span>
            )}
          </div>
        )}

        <div className="cart-panel__documents">
          <p className="cart-panel__documents-title">Remarks</p>
          <textarea
            className="cart-panel__remarks"
            placeholder="Add any remarks for this order (optional)…"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>

        <button type="button" className="cart-panel__place-order" onClick={handleProceedToPayment} disabled={belowMinimum || hasInvalidQuantities || customerDetailStatus === 'loading' || placingOrder}>
          {placingOrder ? 'Placing order…' : 'Confirm & Place Order'}
        </button>
      </div>

      {showPaymentModal && (
        <>
          <div className="payment-modal-overlay" onClick={closePaymentModal} aria-hidden="true" />
          <div className="payment-modal" role="dialog" aria-modal="true" aria-label="Select payment method">
            <header className="payment-modal__header">
              <h3 className="payment-modal__title">Payment method</h3>
              <button type="button" className="payment-modal__close" onClick={closePaymentModal} aria-label="Close payment method selection">
                &times;
              </button>
            </header>

            <div className="payment-modal__body">
              <div className="payment-modal__options">
                {paymentOptions.map((option) => (
                  <label key={option} className="cart-panel__payment-option">
                    <input
                      type="radio"
                      name="payment-method"
                      value={option}
                      checked={paymentMethod === option}
                      onChange={() => {
                        setPaymentMethod(option)
                        setPaymentError('')
                      }}
                    />
                    {PAYMENT_OPTION_LABELS[option]}
                  </label>
                ))}
                {paymentError && (
                  <p className="cart-panel__payment-error" role="alert">{paymentError}</p>
                )}
              </div>

              {isChequePayment && (
                <div className="payment-modal__cheque">
                  <p className="cart-panel__cheque-title">Cheque details</p>

                  <label className="cart-panel__cheque-field">
                    <span>Bank name<span className="cart-panel__cheque-required"> *</span></span>
                    {addingBank ? (
                      <div className="cart-panel__cheque-bank-row">
                        <input
                          autoFocus
                          placeholder="New bank name"
                          value={newBankName}
                          onChange={(e) => setNewBankName(e.target.value)}
                        />
                        <button type="button" className="cart-panel__cheque-bank-btn" onClick={confirmNewBank}>✓</button>
                        <button
                          type="button"
                          className="cart-panel__cheque-bank-btn"
                          onClick={() => { setAddingBank(false); setNewBankName('') }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="cart-panel__cheque-bank-row">
                        <select
                          value={chequeBank}
                          onChange={(e) => {
                            setChequeBank(e.target.value)
                            setChequeErrors((curr) => ({ ...curr, bank: undefined }))
                          }}
                        >
                          <option value="">Select a bank</option>
                          {bankOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                        <button type="button" className="cart-panel__cheque-bank-btn" title="Add new bank" onClick={() => setAddingBank(true)}>
                          +
                        </button>
                      </div>
                    )}
                    {chequeErrors.bank && <span className="cart-panel__cheque-error">{chequeErrors.bank}</span>}
                  </label>

                  <label className="cart-panel__cheque-field">
                    <span>Cheque number<span className="cart-panel__cheque-required"> *</span></span>
                    <input
                      value={chequeNumber}
                      maxLength={6}
                      inputMode="numeric"
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setChequeNumber(val)
                        setChequeErrors((curr) => ({ ...curr, number: undefined }))
                      }}
                    />
                    {chequeErrors.number && <span className="cart-panel__cheque-error">{chequeErrors.number}</span>}
                  </label>

                  <label className="cart-panel__cheque-field">
                    <span>Cheque date<span className="cart-panel__cheque-required"> *</span></span>
                    <input
                      type="date"
                      min={minChequeDate()}
                      max={maxChequeDate()}
                      value={chequeDate}
                      onChange={(e) => {
                        setChequeDate(e.target.value)
                        setChequeErrors((curr) => ({ ...curr, date: undefined }))
                      }}
                    />
                    {chequeErrors.date && <span className="cart-panel__cheque-error">{chequeErrors.date}</span>}
                  </label>

                  <FileDropzone
                    label="Cheque photo"
                    required
                    value={chequePhoto}
                    onChange={setChequePhoto}
                    error={chequeErrors.photo}
                  />
                </div>
              )}
            </div>

            <footer className="payment-modal__footer">
              <button type="button" className="payment-modal__back" onClick={closePaymentModal}>
                Back
              </button>
              <button type="button" className="cart-panel__place-order" onClick={handleConfirmPayment} disabled={hasInvalidQuantities || placingOrder}>
                {placingOrder ? 'Placing order…' : 'Place Order'}
              </button>
            </footer>
          </div>
        </>
      )}

      {showOrderConfirm && (
        <ConfirmDialog
          message="Are you sure you want to place this order? It will be sent for management approval once submitted."
          confirmLabel="Yes, Place Order"
          confirmVariant="approve"
          onConfirm={() => { setShowOrderConfirm(false); submitOrder() }}
          onCancel={() => setShowOrderConfirm(false)}
        />
      )}
    </>
  )
}

export default CartSummary
