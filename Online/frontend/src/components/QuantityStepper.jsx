import './QuantityStepper.css'

function QuantityStepper({ value, onChange, min = 0, max, step = 1, initialStep = step, id, ariaLabel }) {
  const numericValue = Number(value) || 0

  const clamp = (next) => {
    let result = next
    if (Number.isFinite(min)) result = Math.max(min, result)
    if (Number.isFinite(max)) result = Math.min(max, result)
    return result
  }

  // The first step away from zero jumps by initialStep (e.g. a product's
  // larger "first order" minimum); every step after that moves by the
  // regular step. Stepping back down below initialStep snaps to 0 rather
  // than landing on an in-between, not-quite-valid quantity.
  const adjustUp = () => {
    onChange(clamp(numericValue < initialStep ? initialStep : numericValue + step))
  }

  const adjustDown = () => {
    onChange(clamp(numericValue - step < initialStep ? 0 : numericValue - step))
  }

  const handleInputChange = (event) => {
    const raw = event.target.value
    if (raw === '') {
      onChange('')
      return
    }
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) return
    onChange(clamp(parsed))
  }

  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        onClick={adjustDown}
        disabled={Number.isFinite(min) && numericValue <= min}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="stepper__input"
        value={value}
        onChange={handleInputChange}
        aria-label={ariaLabel || 'Quantity'}
        min={min}
        max={max}
        step={step}
      />
      <button
        type="button"
        className="stepper__btn"
        onClick={adjustUp}
        disabled={Number.isFinite(max) && numericValue >= max}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}

export default QuantityStepper
