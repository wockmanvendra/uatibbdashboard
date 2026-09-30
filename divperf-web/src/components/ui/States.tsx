/**
 * The three loading states and the two failure states. (§8.6)
 *
 * None of these is an afterthought:
 *  - first load        skeletons matching final panel dimensions, no layout shift
 *  - refetch           panels stay at opacity 0.55 with a thin progress line
 *  - empty             say so plainly and say what to change
 *
 * Errors state what happened and what to do. They do not apologize and they are
 * never vague.
 */
import type { CSSProperties, ReactNode } from 'react';

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** A skeleton shaped like a KPI tile, so nothing moves when data lands. */
export function StatSkeleton() {
  return (
    <div className="min-w-0">
      <Skeleton className="h-[11px] w-16" />
      <Skeleton className="mt-1.5 h-[28px] w-28" />
      <Skeleton className="mt-2 h-1 w-full" />
      <Skeleton className="mt-2 h-[11px] w-20" />
    </div>
  );
}

export function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-[11px] w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[var(--row-h)] w-full" />
      ))}
    </div>
  );
}

/** The indeterminate line at the top of the content area during a refetch. */
export function RefetchBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="progress-line pointer-events-none absolute inset-x-0 top-0 h-0.5"
      role="status"
      aria-label="Updating"
    />
  );
}

interface EmptyStateProps {
  /** What has no data, in the user's own words: "MER2 – Hyderabad in Aug-26". */
  what: string;
  /** What to change. Always actionable. */
  suggestion?: string;
}

export function EmptyState({ what, suggestion = 'Try a wider period.' }: EmptyStateProps) {
  return (
    <div className="flex min-h-[120px] flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className="text-[13px] text-ink-2">No data recorded for {what}.</p>
      <p className="text-[12px] text-ink-3">{suggestion}</p>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}

export function ErrorState({ message, onRetry, children }: ErrorStateProps) {
  return (
    <div
      className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-4 py-8 text-center"
      role="alert"
    >
      <p className="max-w-md text-[13px] text-ink">{message}</p>
      {children}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded border border-rule px-3 py-1 text-[12px] text-ink-2 hover:bg-paper"
        >
          Try again
        </button>
      )}
    </div>
  );
}
