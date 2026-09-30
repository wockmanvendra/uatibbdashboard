/**
 * The footer strip.
 *
 * `queryMs` and `cached` are shown because you cannot optimise what you cannot
 * see (§7.5). The unassigned-row count is surfaced whenever it is non-zero,
 * because a silently dropped dimension is how a dashboard stops tying to the
 * ERP without anyone noticing (§4.3).
 */
import type { TabMeta } from '../../types/api';
import { UnavailableSummary } from './NoSource';

export function DashboardFooter({
  meta,
  periodLabel,
}: {
  meta?: TabMeta;
  periodLabel: string;
}) {
  if (!meta) return null;

  const slow = meta.queryMs > 2000;

  return (
    <footer className="space-y-2 border-t border-rule pt-3 text-[11px] text-ink-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          Period <span className="text-ink-2 tnum">{periodLabel}</span>
        </span>

        {meta.unassignedRows > 0 && (
          <span className="text-warn">
            {meta.unassignedRows.toLocaleString('en-IN')} source rows have no territory and are
            grouped under “Unassigned”
          </span>
        )}

        <span className="ml-auto flex items-center gap-3 tnum">
          <span>{meta.cached ? 'cached' : 'live'}</span>
          <span className={slow ? 'text-warn' : undefined}>
            {meta.queryMs >= 1000 ? `${(meta.queryMs / 1000).toFixed(1)} s` : `${meta.queryMs} ms`}
          </span>
          <span className="font-mono">{meta.dataVersion}</span>
        </span>
      </div>

      {/* What this tab could not fill, and why. Collapsed by default. */}
      <UnavailableSummary items={meta.unavailable ?? []} />
    </footer>
  );
}
