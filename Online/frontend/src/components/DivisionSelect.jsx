import { useEffect, useState } from 'react'
import { divisionsApi } from '../lib/api.js'
import './DivisionSelect.css'

// Shared division dropdown for the Admin Dashboard — used by both `admin`
// (with allowAll, defaulting to "All Divisions") and `super-admin` (without
// allowAll, must always have one real division selected).
function DivisionSelect({ value, onChange, allowAll = false, className = '', disabled = false }) {
  const [divisions, setDivisions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    divisionsApi.list()
      .then(rows => { if (!cancelled) setDivisions(rows) })
      .catch(() => { if (!cancelled) setDivisions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <select
      className={`division-select ${className}`.trim()}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={loading || disabled}
      aria-label="Division"
    >
      {loading && <option value="">Loading divisions…</option>}
      {!loading && allowAll && <option value="">All Divisions</option>}
      {!loading && !allowAll && !value && <option value="" disabled>Select a division…</option>}
      {!loading && divisions.map(d => (
        <option key={d.code} value={d.code}>{d.name}</option>
      ))}
    </select>
  )
}

export default DivisionSelect
