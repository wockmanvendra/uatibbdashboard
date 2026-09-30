import { useEffect, useId, useRef, useState } from 'react'
import QuantityStepper from './QuantityStepper.jsx'
import { calculateSchemeBenefit } from '../utils/schemeCalculator.js'
import { formatCurrency } from '../utils/currency.js'
import { getOrderQuantityIssue } from '../utils/orderQuantity.js'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import './ProductCard.css'

function ThumbVisual({ product, size }) {
  const initials = product.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  if (product.image) {
    return (
      <span className={`thumb thumb--${size}`} style={{ '--thumb-accent': product.accent }}>
        <img className="thumb__image" src={product.image} alt={product.name} />
        {size === 'card' && <span className="thumb__hint">Tap to enlarge</span>}
      </span>
    )
  }

  return (
    <span className={`thumb thumb--${size}`} style={{ '--thumb-accent': product.accent }}>
      <svg className="thumb__crate" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M6 22 L32 10 L58 22 L32 34 Z" fill="currentColor" opacity="0.9" />
        <path d="M6 22 L32 34 L32 56 L6 44 Z" fill="currentColor" opacity="0.65" />
        <path d="M58 22 L32 34 L32 56 L58 44 Z" fill="currentColor" opacity="0.4" />
      </svg>
      <span className="thumb__initials">{initials}</span>
      {size === 'card' && <span className="thumb__hint">Tap to enlarge</span>}
    </span>
  )
}

function ProductThumb({ product, onEnlarge }) {
  return (
    <button
      type="button"
      className="thumb-trigger"
      onClick={onEnlarge}
      aria-label={`View larger image of ${product.name}`}
    >
      <ThumbVisual product={product} size="card" />
    </button>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M3 8.5 L6.5 12 L13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ProductCard({ product, onAddToCart, viewMode = 'card', cartQuantity = 0 }) {
  const fieldId = useId()
  const { rules } = useDivisionConfig()
  const { showPrices } = rules.orderEntry
  const [quantity, setQuantity] = useState(() => (cartQuantity > 0 ? String(cartQuantity) : ''))
  const [selectedSchemeId, setSelectedSchemeId] = useState(null)
  const [touched, setTouched] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const confirmationTimer = useRef(null)

  useEffect(() => () => clearTimeout(confirmationTimer.current), [])

  // Keeps the stepper in sync with the cart's source of truth — after Add
  // to cart updates cart.items, the parent recomputes cartQuantity and this
  // resyncs to it, so the field shows the new total rather than going blank.
  useEffect(() => {
    setQuantity(cartQuantity > 0 ? String(cartQuantity) : '')
  }, [cartQuantity])

  const numericQty = Number(quantity) || 0
  const selectedScheme = product.schemes.find((scheme) => scheme.id === selectedSchemeId) || null
  const benefit = calculateSchemeBenefit(numericQty, selectedScheme)
  const payableAmount = product.price * numericQty
  const isGiftScheme = selectedScheme?.type === 'gift'
  const discountAmount = isGiftScheme ? benefit.giftValue : product.price * benefit.freeQty

  const quantityIssue = quantity !== '' ? getOrderQuantityIssue(numericQty, product) : null
  const hasValidQuantity = numericQty > 0 && !quantityIssue
  const showValidation = touched && quantity !== '' && !!quantityIssue

  // Total delivered / free-unit rows only mean anything once a scheme is
  // actually unlocking extra units — a gift scheme never changes totalQty,
  // and a quantity scheme below its block size adds nothing yet.
  const showBenefitPanel = numericQty > 0 && !!selectedScheme && (isGiftScheme || benefit.freeQty > 0)

  const handleAddToCart = () => {
    setTouched(true)
    if (!hasValidQuantity) return

    onAddToCart({
      productId: product.id,
      productName: product.name,
      minOrderQty: product.minOrderQty,
      initMinOrderQty: product.initMinOrderQty,
      maxOrderQty: product.maxOrderQty,
      orderedQty: numericQty,
      scheme: selectedScheme,
      schemeLabel: selectedScheme?.label ?? null,
      freeQty: benefit.freeQty,
      totalQty: benefit.totalQty,
      giftUnlocked: benefit.giftUnlocked,
      price: product.price,
      payableAmount,
      discountAmount,
    })

    setConfirmation(`Cart updated — ${benefit.totalQty} unit${benefit.totalQty === 1 ? '' : 's'}`)
    clearTimeout(confirmationTimer.current)
    confirmationTimer.current = setTimeout(() => setConfirmation(null), 2600)
    setTouched(false)
  }

  return (
    <article className={`product-card${viewMode === 'list' ? ' product-card--list' : ''}`}>
      {viewMode !== 'list' && <ProductThumb product={product} onEnlarge={() => setLightboxOpen(true)} />}

      <div className="product-card__body">
        <header className="product-card__header">
          <div className="product-card__heading-row">
            <span className="product-card__brand">{product.brand}</span>
            {showPrices && (
              <span className="product-card__price">
                {formatCurrency(product.price)}
                <span className="product-card__price-unit"> /unit</span>
              </span>
            )}
          </div>
          <div className="product-card__tags">
            <span className={`product-card__unit${product.unit ? '' : ' product-card__unit--empty'}`}>
              {product.unit || ' '}
            </span>
          </div>
          <h3 className="product-card__name">{product.name}</h3>
          {product.unitDescription && (
            <p className="product-card__unit-description">{product.unitDescription}</p>
          )}
          {cartQuantity > 0 && (
            <span className="product-card__in-cart">
              {cartQuantity} unit{cartQuantity === 1 ? '' : 's'} already in cart
            </span>
          )}
        </header>

        <p className="product-card__description">{product.description}</p>

        <div className="product-card__field-group">
          <div className="product-card__field">
            <label htmlFor={`${fieldId}-qty`} className="product-card__field-label">
              Order quantity{' '}
              <span className="product-card__field-hint">
                min {product.initMinOrderQty} · max {product.maxOrderQty}
              </span>
            </label>
            <QuantityStepper
              id={`${fieldId}-qty`}
              value={quantity}
              onChange={(next) => {
                setQuantity(next)
                setTouched(true)
              }}
              min={0}
              max={product.maxOrderQty}
              step={product.minOrderQty}
              initialStep={product.initMinOrderQty}
              ariaLabel={`Order quantity for ${product.name}`}
            />
            {viewMode === 'list' && (
              <span className="product-card__field-hint-standalone">
                min {product.initMinOrderQty} · max {product.maxOrderQty}
              </span>
            )}
          </div>
          <p
            className={`product-card__validation${showValidation ? ' is-visible' : ''}`}
            role={showValidation ? 'alert' : undefined}
          >
            {showValidation ? quantityIssue : ' '}
          </p>
        </div>

        {product.schemes.length > 0 && (
          <div className="product-card__field product-card__field--stack">
            <label htmlFor={`${fieldId}-scheme`} className="product-card__field-label">
              Available schemes
            </label>
            <select
              id={`${fieldId}-scheme`}
              className="scheme-select"
              value={selectedSchemeId ?? ''}
              onChange={(event) => setSelectedSchemeId(event.target.value || null)}
            >
              <option value="">No scheme — standard order</option>
              {product.schemes.map((scheme) => (
                <option key={scheme.id} value={scheme.id}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {numericQty > 0 && (
          <div className="order-summary">
            <div className="order-summary__row">
              <span className="order-summary__qty">
                {numericQty} unit{numericQty === 1 ? '' : 's'}
              </span>
              {showPrices && <span className="order-summary__amount">{formatCurrency(payableAmount)}</span>}
            </div>

            {showBenefitPanel && (
              <dl className="benefit">
                {isGiftScheme ? (
                  <div className={`benefit__row${benefit.giftUnlocked ? ' benefit__row--accent' : ''}`}>
                    <dt>Free gift</dt>
                    <dd>{benefit.giftUnlocked ? selectedScheme.giftName : 'Not yet unlocked'}</dd>
                  </div>
                ) : (
                  <>
                    <div className="benefit__row benefit__row--accent">
                      <dt>Free units</dt>
                      <dd>+{benefit.freeQty}</dd>
                    </div>
                    <div className="benefit__row benefit__row--total">
                      <dt>Total delivered</dt>
                      <dd>{benefit.totalQty}</dd>
                    </div>
                  </>
                )}
                {showPrices && discountAmount > 0 && (
                  <div className="benefit__row benefit__row--accent">
                    <dt>Discount</dt>
                    <dd>− {formatCurrency(discountAmount)}</dd>
                  </div>
                )}
              </dl>
            )}

            {selectedScheme && isGiftScheme && !benefit.giftUnlocked && (
              <p className="order-summary__note">
                Order {selectedScheme.minQty - numericQty} more unit
                {selectedScheme.minQty - numericQty === 1 ? '' : 's'} to unlock the free{' '}
                {selectedScheme.giftName}
                {showPrices ? ` (worth ${formatCurrency(selectedScheme.giftValue)}).` : '.'}
              </p>
            )}
            {selectedScheme && !isGiftScheme && benefit.freeQty === 0 && (
              <p className="order-summary__note">
                Add {selectedScheme.buyQty - (numericQty % selectedScheme.buyQty)} more to unlock
                this scheme&rsquo;s free units.
              </p>
            )}
          </div>
        )}

        <div className="product-card__footer">
          <button
            type="button"
            className="add-to-cart"
            onClick={handleAddToCart}
            disabled={quantity === '' || !hasValidQuantity}
          >
            Add to cart
          </button>
        </div>
      </div>

      {confirmation && (
        <div className="add-toast" role="status">
          <span className="add-toast__icon">
            <CheckIcon />
          </span>
          {confirmation}
        </div>
      )}

      {lightboxOpen && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${product.name} — enlarged image`}
          onClick={() => setLightboxOpen(false)}
        >
          <div className="lightbox__frame" onClick={(event) => event.stopPropagation()}>
            <ThumbVisual product={product} size="lightbox" />
            <p className="lightbox__caption">{product.name}</p>
            <button type="button" className="lightbox__close" onClick={() => setLightboxOpen(false)}>
              Close &times;
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

export default ProductCard
