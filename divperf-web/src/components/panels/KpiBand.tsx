/**
 * The KPI band across the top of every performance tab.
 * Reproduces the Excel's four cards: Primary, PCPM, Secondary, RCPA Value.
 */
import type {
  InventoryPanel, PcpmPanel, PrimaryPanel, RcpaPanel, SecondaryPanel,
} from '../../types/api';
import { Card } from '../ui/Card';
import { Stat } from '../ui/Stat';
import { StatSkeleton } from '../ui/States';
import { NoSourceBadge } from '../ui/NoSource';
import { EM_DASH, growth, growthClass, money, percent } from '../../lib/format';

/** True when every measure a card shows is absent — not merely zero. */
const allNull = (...vals: (number | null | undefined)[]) =>
  vals.every((v) => v === null || v === undefined);

interface KpiBandProps {
  primary?: PrimaryPanel;
  pcpm?: PcpmPanel;
  secondary?: SecondaryPanel;
  rcpa?: RcpaPanel;
  inventory?: InventoryPanel;
  monthCount: number;
  loading: boolean;
  stale: boolean;
  /** True when the prior-year window has no data, so every Gr% is an em dash. */
  noPriorYear: boolean;
}

export function KpiBand({
  primary, pcpm, secondary, rcpa, inventory, monthCount, loading, stale, noPriorYear,
}: KpiBandProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* Primary — Tgt / Coll / Disp against Value, Ach%, Gr% */}
      <Card title="Primary" stale={stale}>
        {loading || !primary ? (
          <div className="space-y-4">
            <StatSkeleton />
            <StatSkeleton />
          </div>
        ) : (
          <div className="space-y-3.5">
            <Stat label="Tgt" srLabel="Target" value={primary.target.value} gr={primary.target.gr} />
            <Stat
              label="Coll"
              srLabel="Collection"
              value={primary.collection.value}
              ach={primary.collection.ach}
              gr={primary.collection.gr}
            />
            <Stat
              label="Disp"
              srLabel="Dispatch"
              value={primary.dispatch.value}
              ach={primary.dispatch.ach}
              gr={primary.dispatch.gr}
            />
          </div>
        )}
      </Card>

      {/* PCPM — the definition is carried in the card, as it is in the Excel */}
      <Card
        title="PCPM"
        stale={stale}
        aside={
          pcpm && allNull(pcpm.budgetTm, pcpm.pcpmCollection) ? (
            <NoSourceBadge title="No TM headcount feed — PCPM has no denominator." />
          ) : undefined
        }
      >
        {loading || !pcpm ? (
          <div className="space-y-4">
            <StatSkeleton />
            <StatSkeleton />
          </div>
        ) : (
          <div className="space-y-3.5">
            <Stat label="Budget TM" value={pcpm.budgetTm} format="count" />
            <Stat
              label="PCPM (Coll)"
              value={pcpm.pcpmCollection}
              hint={`Collection / budgeted TMs / ${monthCount} ${monthCount === 1 ? 'month' : 'months'}`}
            />
          </div>
        )}
      </Card>

      {/* Secondary — carries Inventory too, matching the Excel card */}
      <Card
        title="Secondary"
        stale={stale}
        aside={
          secondary && allNull(secondary.value, secondary.grPct) ? (
            <NoSourceBadge title="No chemist-level sales feed. This view holds primary sales only." />
          ) : undefined
        }
      >
        {loading || !secondary ? (
          <div className="space-y-4">
            <StatSkeleton />
            <StatSkeleton />
          </div>
        ) : (
          <div className="space-y-3.5">
            <Stat label="Sec" srLabel="Secondary" value={secondary.value} gr={secondary.grPct} />
            <Stat label="Invntry" srLabel="Inventory" value={inventory?.value ?? null} size="sm" />
          </div>
        )}
      </Card>

      {/* RCPA Value — Plan / Actual / Ach% / Gr% as a compact 2x2 */}
      <Card
        title="RCPA value"
        stale={stale}
        aside={
          rcpa && allNull(rcpa.plan, rcpa.actual, rcpa.achPct, rcpa.grPct) ? (
            <NoSourceBadge title="No RCPA feed. Doctor-level plan and actual are not in this view." />
          ) : undefined
        }
      >
        {loading || !rcpa ? (
          <div className="space-y-4">
            <StatSkeleton />
            <StatSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Stat label="Plan" value={rcpa.plan} size="sm" />
            <Stat label="Actual" value={rcpa.actual} ach={rcpa.achPct} size="sm" />
            <div>
              <div className="kpi-label">Ach%</div>
              <div className="mt-0.5 text-[19px] font-semibold tnum text-ink">
                {percent(rcpa.achPct)}
              </div>
            </div>
            <div>
              <div className="kpi-label">Gr%</div>
              <div className={`mt-0.5 text-[19px] font-semibold tnum ${growthClass(rcpa.grPct)}`}>
                {growth(rcpa.grPct)}
              </div>
            </div>
          </div>
        )}
      </Card>

      {noPriorYear && !loading && (
        <p className="col-span-full -mt-1 text-[11px] text-ink-3">
          Growth shows {EM_DASH} because the prior-year period has no data in the source. Totals for
          the selected period are unaffected.
        </p>
      )}
    </div>
  );
}

/** Compact inline total used above tables. */
export function InlineTotal({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="text-[11px] text-ink-3">
      {label} <span className="tnum text-ink-2">{money(value)}</span>
    </span>
  );
}
