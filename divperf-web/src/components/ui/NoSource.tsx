/**
 * Treatments for "the warehouse has no feed for this".
 *
 * A panel of em dashes with no explanation reads as a broken dashboard, and a
 * manager will report it as a bug. These make the difference between "zero",
 * "not computable for this period", and "no source exists" legible at a glance.
 */
import type { Unavailable } from '../../types/api';

/** Small inline marker for a card whose measures have no source. */
export function NoSourceBadge({ title }: { title?: string }) {
  return (
    <span
      className="rounded-full border border-rule px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3"
      title={title}
    >
      No source
    </span>
  );
}

/**
 * Stands in for a chart that cannot be drawn at all, keeping the grid's shape
 * so the layout does not collapse into an odd number of cards.
 */
export function UnavailableChart({
  title,
  reason,
  height,
}: {
  title: string;
  reason: string;
  height: number;
}) {
  return (
    <section className="card flex min-w-0 flex-col">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="panel-title truncate text-ink-3">{title}</h2>
        <NoSourceBadge />
      </header>
      <div
        className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-rule bg-[var(--table-zebra)] px-6 text-center"
        style={{ minHeight: height }}
      >
        <p className="max-w-sm text-[12px] leading-relaxed text-ink-3">{reason}</p>
      </div>
    </section>
  );
}

/**
 * The footer list of everything this tab could not fill.
 *
 * Collapsed by default: on a tab where six things are missing, six lines of
 * explanation would dominate the page. The count is always visible.
 */
export function UnavailableSummary({ items }: { items: Unavailable[] }) {
  if (items.length === 0) return null;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[11px] text-ink-3 hover:text-ink-2">
        <span className="underline decoration-dotted underline-offset-2">
          {items.length} {items.length === 1 ? 'panel has' : 'panels have'} no source in the
          warehouse
        </span>
        <span className="ml-1 group-open:hidden" aria-hidden="true">
          ▸
        </span>
        <span className="ml-1 hidden group-open:inline" aria-hidden="true">
          ▾
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-rule pl-3">
        {items.map((u) => (
          <li key={u.key} className="text-[11px] leading-relaxed">
            <span className="font-medium text-ink-2">{u.label}</span>
            <span className="text-ink-3"> — {u.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
