import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Navy for the summary panels, teal for the grids — as in the report. */
  tone?: 'navy' | 'teal';
  /** Right-aligned header content: chips, Export, a unit note. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Dims the panel while a refetch is in flight, per §8.6. */
  stale?: boolean;
}

/** A titled section: a dark header bar over a white body. */
export function Panel({ title, tone = 'navy', actions, children, className = '', stale = false }: PanelProps) {
  return (
    <section
      className={`xl-panel ${className}`}
      style={stale ? { opacity: 0.55 } : undefined}
      aria-busy={stale || undefined}
    >
      <header className={`xl-panel-head ${tone === 'teal' ? 'teal' : ''}`}>
        <h2 className="min-w-0 truncate">{title}</h2>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** The full-width band that opens a section of the page. */
export function SectionBar({ title }: { title: string }) {
  return <h2 className="xl-section-bar">{title}</h2>;
}
