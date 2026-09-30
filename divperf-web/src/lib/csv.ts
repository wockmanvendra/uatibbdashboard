/**
 * CSV export for the grids. (§10 Phase 7)
 *
 * Values are written raw, not formatted — an export is for further analysis, so
 * "17.50 L" would be actively harmful. Excel gets full precision.
 */

function escapeCell(v: string | number): string {
  const s = String(v ?? '');
  // A leading =, +, -, or @ is executed as a formula by Excel on open. Prefix
  // with a single quote so an exported territory name can never run as one.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
    '\r\n',
  );
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  // BOM so Excel opens UTF-8 territory names correctly.
  const blob = new Blob(['﻿' + toCsv(headers, rows)], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
