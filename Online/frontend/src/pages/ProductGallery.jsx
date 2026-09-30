import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProductCard from '../components/ProductCard.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useOrdering } from '../context/OrderingContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { productsApi } from '../lib/api.js'
import { formatCurrency } from '../utils/currency.js'
import './ProductGallery.css'

function ChevronIcon({ open }) {
  return (
    <svg
      className={`brand-panel__chevron${open ? ' brand-panel__chevron--open' : ''}`}
      viewBox="0 0 16 16" width="14" height="14"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3 L11 8 L6 13" />
    </svg>
  )
}

function ProductGallery() {
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [products, setProducts] = useState([])
  const [viewMode, setViewMode] = useState(['tm', 'rm'].includes(user?.usertype) ? 'list' : 'card')
  const [expandedBrand, setExpandedBrand] = useState(null)

  const navigate = useNavigate()
  const cart = useCart()
  const { orderingFor, clearCustomer } = useOrdering()
  const { rules } = useDivisionConfig()
  const { showPrices } = rules.orderEntry

  useEffect(() => {
    const params = user?.divisionCode ? { division_code: user.divisionCode } : {}
    productsApi.list(params).then(setProducts).catch(console.error)
  }, [user?.divisionCode])

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return products
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.description ?? '').toLowerCase().includes(term),
    )
  }, [searchTerm, products])

  // A product can have more than one cart line (e.g. different schemes), so
  // this sums across all of them rather than looking up a single entry.
  const cartQtyByProduct = useMemo(() => {
    const map = {}
    for (const item of cart.items) map[item.productId] = (map[item.productId] ?? 0) + item.orderedQty
    return map
  }, [cart.items])

  const hasActiveFilters = searchTerm.trim() !== ''

  const clearFilters = () => setSearchTerm('')

  const groupedByBrand = useMemo(() => {
    if (viewMode !== 'list') return []
    const map = {}
    const order = []
    for (const p of filteredProducts) {
      if (!map[p.brand]) { map[p.brand] = []; order.push(p.brand) }
      map[p.brand].push(p)
    }
    return order.map(brand => ({ brand, products: map[brand] }))
  }, [filteredProducts, viewMode])

  const toggleBrand = (brand) => {
    setExpandedBrand(prev => (prev === brand ? null : brand))
  }

  const isBrandExpanded = (brand) => expandedBrand === brand

  return (
    <section className="gallery">
      {orderingFor && (
        <div className="gallery__ordering-banner">
          <div className="gallery__ordering-info">
            <span className="gallery__ordering-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="M5 20c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="gallery__ordering-label">Ordering for</span>
            <strong className="gallery__ordering-name">{orderingFor.name}</strong>
            <span className="gallery__ordering-type">{orderingFor.type}</span>
          </div>
          {/* <button
            type="button"
            className="gallery__ordering-change"
            onClick={() => { clearCustomer(); navigate('/dashboard') }}
          >
            Change customer
          </button> */}
        </div>
      )}

      <header className="gallery__header">
        <div className="gallery__heading">
          <p className="gallery__eyebrow">Product catalogue</p>
          <h1 className="gallery__title">Browse products</h1>
        </div>

        <label className="gallery__search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.4 13.4 L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search by product name or description…"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            aria-label="Search products by name or description"
          />
          {hasActiveFilters && (
            <button type="button" className="gallery__search-clear" onClick={clearFilters} aria-label="Clear search">
              &times;
            </button>
          )}
        </label>
      </header>

      <div className="gallery__meta">
        <p>
          Showing <strong>{filteredProducts.length}</strong> of {products.length} products
        </p>
        <div className="gallery__meta-actions">
          <div className="gallery__view-toggle" role="group" aria-label="Product view">
            <button
              type="button"
              className={`gallery__view-btn${viewMode === 'list' ? ' gallery__view-btn--active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              List
            </button>
            <button
              type="button"
              className={`gallery__view-btn${viewMode === 'card' ? ' gallery__view-btn--active' : ''}`}
              onClick={() => setViewMode('card')}
              aria-pressed={viewMode === 'card'}
            >
              Cards
            </button>
          </div>

          <button type="button" className="gallery__cart-btn" onClick={() => navigate('/cart')}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M3 4h2l1.6 9.6a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.6L20 8H6.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9.5" cy="20" r="1.4" fill="currentColor" />
              <circle cx="16.5" cy="20" r="1.4" fill="currentColor" />
            </svg>
            Cart
            {cart.items.length > 0 && <span className="gallery__cart-badge">{cart.items.length}</span>}
            {showPrices && cart.totalPayable > 0 && (
              <span className="gallery__cart-value">{formatCurrency(cart.totalPayable)}</span>
            )}
          </button>
        </div>
      </div>

      {filteredProducts.length > 0 ? (
        viewMode === 'list' ? (
          <div className="gallery__brand-panels">
            {groupedByBrand.map(({ brand, products: brandProducts }) => (
              <div key={brand} className="brand-panel">
                <button
                  type="button"
                  className="brand-panel__header"
                  onClick={() => toggleBrand(brand)}
                  aria-expanded={isBrandExpanded(brand)}
                >
                  <span className="brand-panel__name">{brand}</span>
                  <span className="brand-panel__count">
                    {brandProducts.length} product{brandProducts.length !== 1 ? 's' : ''}
                  </span>
                  <ChevronIcon open={isBrandExpanded(brand)} />
                </button>
                {isBrandExpanded(brand) && (
                  <ul className="brand-panel__list">
                    {brandProducts.map((product) => (
                      <li key={product.id}>
                        <ProductCard product={product} onAddToCart={cart.addItem} viewMode="list" cartQuantity={cartQtyByProduct[product.id] ?? 0} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <ul className="gallery__grid">
            {filteredProducts.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} onAddToCart={cart.addItem} viewMode={viewMode} cartQuantity={cartQtyByProduct[product.id] ?? 0} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="gallery__empty">
          <p>No products match these filters.</p>
          <button type="button" className="gallery__clear" onClick={clearFilters}>
            Reset search &amp; filters
          </button>
        </div>
      )}
    </section>
  )
}

export default ProductGallery
