// Builds a CSV client-side from already-fetched rows and triggers a browser
// download — shared by every admin panel that reports per-row skip reasons
// (bulk uploads, Infinity master syncs) without needing a server round-trip.
export function downloadCsv(filename, headers, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [headers.map(h => h.label), ...rows.map(r => headers.map(h => r[h.key]))]
    .map(cols => cols.map(escape).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
