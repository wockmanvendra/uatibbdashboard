/**
 * A figure that opens its detail list in the side panel: the value, underlined
 * with dots, as a button. Without `onClick` it is plain text — callers pass it
 * only when there is something to list.
 */
import type { ReactNode } from 'react';
import type { DetailListId } from '../../types/api';

/** Opens the side panel on a list, with facet values chosen up front. */
export type OpenDetail = (list: DetailListId, initial?: Record<string, string>) => void;

export function FigureLink({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** What a click lists, for the tooltip and screen readers: "List the 24 leavers". */
  label: string;
}) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="font-semibold text-[var(--xl-navy)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </button>
  );
}

/** True when a count has anything behind it to list. */
export const hasAny = (n: number | null | undefined): n is number => n !== null && n !== undefined && n > 0;
