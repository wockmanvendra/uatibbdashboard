import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  title?: string;
  /** Right-aligned content in the title row: chips, counts, a toggle. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Dims the card while a refetch is in flight, per §8.6. */
  stale?: boolean;
  /** A colour (usually a series token) for the card's top edge and title wash. */
  accent?: string;
}

export function Card({ title, aside, children, className = '', stale = false, accent }: CardProps) {
  const style: CSSProperties & { '--card-accent'?: string } = {};
  if (stale) style.opacity = 0.55;
  if (accent) style['--card-accent'] = accent;

  return (
    <section
      className={`card flex min-w-0 flex-col ${accent ? 'card-accent' : ''} ${className}`}
      style={style}
      aria-busy={stale || undefined}
    >
      {(title || aside) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="panel-title">{title}</h2>}
          {aside}
        </header>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}
