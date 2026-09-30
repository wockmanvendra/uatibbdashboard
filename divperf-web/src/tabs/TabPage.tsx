/**
 * The one tab engine. (§8.5)
 *
 * Reads the tab config, calls useDashTab ONCE, and renders the listed panels.
 * There is no page component per tab and there must never be one — four
 * hand-written pages is how the layout drifts between tabs.
 */
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFilters } from '../store/filterStore';
import { useDashTab } from '../queries/useDashTab';
import { usePrefetchMonths } from '../queries/usePrefetch';
import { DEFAULT_TAB, getTabByPath } from './registry';
import { ApiRequestError } from '../lib/api';

import { KpiBand } from '../components/panels/KpiBand';
import { KeyBrandsTable } from '../components/panels/KeyBrandsTable';
import { GeoTable } from '../components/panels/GeoTable';
import { CreditNoteCard } from '../components/panels/CreditNotePanel';
import { CnDetailPanels } from '../components/panels/CnDetail';
import { TrendCombo } from '../components/charts/TrendCombo';
import { MixPanelCard } from '../components/charts/MixPanel';
import { SERIES, CHART_HEIGHT } from '../components/charts/chartTheme';
import { ChartSkeleton, ErrorState, LoadingIndicator, RefetchBar } from '../components/ui/States';
import { UnavailableChart } from '../components/ui/NoSource';
import { DashboardFooter } from '../components/ui/DashboardFooter';
import { label as monthLabel } from '../lib/yrmn';

/** A series is drawable only if it exists and holds at least one real value. */
const hasSeries = (s?: (number | null)[]) => !!s && s.some((v) => v !== null);

/** The server's explanation for a missing panel, if it sent one. */
const reasonFor = (data: { meta: { unavailable?: { key: string; reason: string }[] } } | undefined, key: string) =>
  data?.meta.unavailable?.find((u) => u.key === key)?.reason;

export function TabPage() {
  const { tab: tabPath } = useParams();
  const navigate = useNavigate();
  const config = getTabByPath(tabPath ?? '') ?? DEFAULT_TAB;

  const filters = useFilters();
  const { data, isPending, isFetching, isError, error, refetch } = useDashTab(config.id, filters);
  usePrefetchMonths(config.id, filters);

  const has = (p: string) => config.panels.includes(p as never);

  // First load shows skeletons; a refetch keeps the previous data and dims it.
  const firstLoad = isPending && !data;
  const stale = isFetching && !!data;

  const periodLabel = useMemo(
    () =>
      filters.from === filters.to
        ? monthLabel(filters.from)
        : `${monthLabel(filters.from)} – ${monthLabel(filters.to)}`,
    [filters.from, filters.to],
  );

  if (isError) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : 'Could not load this dashboard. Try again in a moment.';
    return (
      <div className="px-5 py-10">
        <ErrorState message={message} onRetry={() => void refetch()} />
      </div>
    );
  }

  const trends = data?.trends;
  const labels = trends?.labels ?? [];
  const noPriorYear = !!data && data.meta.priorFrom === null;

  return (
    <div className="relative">
      <RefetchBar active={stale} />
      <LoadingIndicator state={firstLoad ? 'loading' : stale ? 'updating' : null} />

      <div className="space-y-5 px-5 py-5">
        {/* ---- KPI band ------------------------------------------------- */}
        {has('primary') && (
          <KpiBand
            primary={data?.primary}
            pcpm={data?.pcpm}
            secondary={data?.secondary}
            rcpa={data?.rcpa}
            inventory={data?.inventory}
            monthCount={data?.meta.monthCount ?? 1}
            loading={firstLoad}
            stale={stale}
            noPriorYear={noPriorYear}
          />
        )}

        {/* ---- Grid: table on the left, CN card on the right ------------ */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
          {has('keyBrands') && (
            <KeyBrandsTable data={data?.keyBrands} loading={firstLoad} stale={stale} />
          )}
          {has('geoTable') && <GeoTable data={data?.geoTable} loading={firstLoad} stale={stale} />}
          {has('creditNote') && (
            <CreditNoteCard cn={data?.creditNote} loading={firstLoad} stale={stale} />
          )}
        </div>

        {/* ---- Credit Note tab detail grids ----------------------------- */}
        {has('cnDetail') && (
          <CnDetailPanels data={data?.cnDetail} loading={firstLoad} stale={stale} />
        )}

        {/* ---- The four trend charts ------------------------------------ */}
        {has('trends') && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {firstLoad || !trends ? (
              <>
                <ChartCardSkeleton />
                <ChartCardSkeleton />
                <ChartCardSkeleton />
                <ChartCardSkeleton />
              </>
            ) : (
              <>
                {/* Only the series that actually have data become bars, so the
                    chart is not padded out with empty legend entries. */}
                {hasSeries(trends.disp) && (
                  <TrendCombo
                    title={
                      hasSeries(trends.sec) || hasSeries(trends.rcpa)
                        ? 'Disp, Sec, RCPA, PCPM'
                        : 'Dispatch'
                    }
                    note={
                      hasSeries(trends.sec) || hasSeries(trends.rcpa)
                        ? undefined
                        : 'Sec, RCPA and PCPM have no source in the warehouse.'
                    }
                    labels={labels}
                    stale={stale}
                    bars={[
                      { name: 'Disp', data: trends.disp!, color: SERIES.disp },
                      ...(hasSeries(trends.sec)
                        ? [{ name: 'Sec', data: trends.sec!, color: SERIES.sec }]
                        : []),
                      ...(hasSeries(trends.rcpa)
                        ? [{ name: 'RCPA', data: trends.rcpa!, color: SERIES.rcpa }]
                        : []),
                    ]}
                    ratio={
                      hasSeries(trends.pcpm)
                        ? { name: 'PCPM', data: trends.pcpm!, isPercent: false }
                        : undefined
                    }
                  />
                )}

                {hasSeries(trends.tgt) && (
                  <TrendCombo
                    title="Tgt vs. Disp vs. Coll"
                    labels={labels}
                    stale={stale}
                    bars={[
                      { name: 'Tgt', data: trends.tgt!, color: SERIES.tgt },
                      { name: 'Disp', data: trends.disp ?? [], color: SERIES.disp },
                      { name: 'Coll', data: trends.coll ?? [], color: SERIES.coll },
                    ]}
                  />
                )}

                {/* A chart with no feed keeps its slot and says why, rather than
                    vanishing and leaving a hole in the grid. */}
                {hasSeries(trends.rcpaPlan) ? (
                  <TrendCombo
                    title="RCPA plan vs. actual"
                    labels={labels}
                    stale={stale}
                    bars={[
                      { name: 'RCPA plan', data: trends.rcpaPlan!, color: SERIES.tgt },
                      { name: 'RCPA actual', data: trends.rcpaActual ?? [], color: SERIES.rcpa },
                    ]}
                    ratio={
                      hasSeries(trends.valuePerDr)
                        ? { name: 'Value / Dr.', data: trends.valuePerDr!, isPercent: false }
                        : undefined
                    }
                  />
                ) : (
                  <UnavailableChart
                    title="RCPA plan vs. actual"
                    reason={reasonFor(data, 'rcpa') ?? 'No RCPA feed in the warehouse.'}
                    height={CHART_HEIGHT.trend}
                  />
                )}

                {hasSeries(trends.cnExp) ? (
                  <TrendCombo
                    title="Credit note"
                    labels={labels}
                    stale={stale}
                    bars={[
                      { name: 'Exp CN', data: trends.cnExp!, color: SERIES.cnExp, stack: 'cn' },
                      { name: 'SRCN', data: trends.cnSr ?? [], color: SERIES.cnSr, stack: 'cn' },
                      { name: 'PD CN', data: trends.cnPd ?? [], color: SERIES.cnPd, stack: 'cn' },
                    ]}
                    ratio={
                      hasSeries(trends.cnPct)
                        ? { name: 'CN%', data: trends.cnPct!, isPercent: true }
                        : undefined
                    }
                  />
                ) : hasSeries(trends.cnPct) ? (
                  // The split is missing but the ratio is real, so plot that
                  // rather than dropping credit notes from the tab entirely.
                  <TrendCombo
                    title="Credit note %"
                    note="Exp CN / SRCN / PD CN split is not in the warehouse; total CN% shown."
                    labels={labels}
                    stale={stale}
                    bars={[]}
                    ratio={{ name: 'CN%', data: trends.cnPct!, isPercent: true }}
                  />
                ) : (
                  <UnavailableChart
                    title="Credit note"
                    reason={reasonFor(data, 'creditNote.split') ?? 'No credit-note split feed.'}
                    height={CHART_HEIGHT.trend}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ---- Mix donuts ----------------------------------------------- */}
        {has('mix') && data?.mix && (
          <MixPanelCard
            mix={data.mix}
            stale={stale}
            note={reasonFor(data, 'mix.coll')}
          />
        )}

        <DashboardFooter meta={data?.meta} periodLabel={periodLabel} />
      </div>

      {/* Deep-linking a tab that no longer exists lands on the default. */}
      {!getTabByPath(tabPath ?? '') && tabPath !== undefined && (
        <RedirectToDefault onRedirect={() => navigate(`/${DEFAULT_TAB.path}`, { replace: true })} />
      )}
    </div>
  );
}

function ChartCardSkeleton() {
  return (
    <div className="card">
      <div className="mb-2 h-4 w-40 skeleton" />
      <ChartSkeleton height={CHART_HEIGHT.trend} />
    </div>
  );
}

function RedirectToDefault({ onRedirect }: { onRedirect: () => void }) {
  queueMicrotask(onRedirect);
  return null;
}
