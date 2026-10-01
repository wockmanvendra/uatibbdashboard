/**
 * The KPI strip across the top of every performance tab: seven tiles, each
 * under a colour bar, as in the report — Target, Dispatch, Collection,
 * Ach% on Coll, Growth %, Secondary, PCPM (Coll).
 */
import type { PcpmPanel, PrimaryPanel, SecondaryPanel } from '../../types/api';
import { EM_DASH, count, lakhs, lakhsAuto, moneyFull, percent } from '../../lib/format';
import { GapRibbon } from './GapRibbon';
import { Skeleton } from '../ui/States';
import type { ReactNode } from 'react';

interface Tile {
  label: string;
  value: string;
  caption: ReactNode;
  color: string;
  /** Full-precision value on hover. */
  title?: string;
  tone?: 'bad';
  extra?: ReactNode;
}

const arrow = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n >= 0 ? '▲ ' : '▼ ';

export function KpiStrip({
  primary, secondary, pcpm, loading, stale,
}: {
  primary?: PrimaryPanel;
  secondary?: SecondaryPanel;
  pcpm?: PcpmPanel;
  loading: boolean;
  stale: boolean;
}) {
  const full = (n: number | null | undefined) => (n === null || n === undefined ? undefined : moneyFull(n));
  const gr = primary?.collection.gr ?? null;

  const tiles: Tile[] = [
    {
      label: 'Target (₹ L)',
      value: lakhsAuto(primary?.target.value),
      caption: 'Plan',
      color: 'var(--kpi-target)',
      title: full(primary?.target.value),
    },
    {
      label: 'Dispatch (₹ L)',
      value: lakhsAuto(primary?.dispatch.value),
      caption: 'Primary',
      color: 'var(--kpi-dispatch)',
      title: full(primary?.dispatch.value),
    },
    {
      label: 'Collection (₹ L)',
      value: lakhsAuto(primary?.collection.value),
      caption: 'Primary',
      color: 'var(--kpi-coll)',
      title: full(primary?.collection.value),
    },
    {
      label: 'Ach% on Coll',
      value: percent(primary?.collection.ach),
      caption: 'vs Target',
      color: 'var(--kpi-ach)',
      extra: (
        <div className="mx-auto mt-1 w-3/4">
          <GapRibbon ach={primary?.collection.ach} label="Collection achievement" inline />
        </div>
      ),
    },
    {
      label: 'Growth %',
      value: percent(gr),
      caption: `${arrow(gr)}vs LY`,
      color: 'var(--kpi-growth)',
      tone: gr !== null && gr < 0 ? 'bad' : undefined,
    },
    {
      label: 'Secondary (₹ L)',
      value: lakhsAuto(secondary?.value),
      caption: `Sec Gr% ${percent(secondary?.grPct)}`,
      color: 'var(--kpi-sec)',
      title: full(secondary?.value),
    },
    {
      label: 'PCPM (Coll) ₹ L',
      value: lakhs(pcpm?.pcpmCollection, 1),
      caption: `Budget TM: ${count(pcpm?.budgetTm)}`,
      color: 'var(--kpi-pcpm)',
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
      style={stale ? { opacity: 0.55 } : undefined}
      aria-busy={stale || undefined}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          role="group"
          aria-label={t.label}
          className="xl-tile"
          style={{ ['--tile' as string]: t.color }}
        >
          <div className="xl-tile-bar" aria-hidden="true" />
          <div className="xl-tile-body">
            <div className="text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--xl-label)]">
              {t.label}
            </div>
            {loading || !primary ? (
              <>
                <Skeleton className="mx-auto mt-1.5 h-[26px] w-20" />
                <Skeleton className="mx-auto mt-1.5 h-[11px] w-14" />
              </>
            ) : (
              <>
                <div
                  className={`mt-0.5 text-[24px] font-bold leading-tight tnum ${
                    t.value === EM_DASH ? 'text-[var(--xl-muted)]' : t.tone === 'bad' ? 'text-bad' : 'text-[var(--xl-text)]'
                  }`}
                  title={t.title}
                >
                  {t.value}
                </div>
                {t.extra}
                <div className="mt-0.5 text-[11px] text-[var(--xl-muted)] tnum">{t.caption}</div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
