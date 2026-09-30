import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  /** Right-aligned content in the title row: chips, counts, a toggle. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Dims the card while a refetch is in flight, per §8.6. */
  stale?: boolean;
}

export function Card({ title, aside, children, className = '', stale = false }: CardProps) {
  return (
    <section
      className={`card flex min-w-0 flex-col ${className}`}
      style={stale ? { opacity: 0.55 } : undefined}
      aria-busy={stale || undefined}
    >
      {(title || aside) && (
        <header className="mb-3 flex items-baseline justify-between gap-2">
          {title && <h2 className="panel-title">{title}</h2>}
          {aside}
        </header>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}
