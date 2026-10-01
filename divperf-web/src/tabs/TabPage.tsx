/**
 * The one tab engine. (§8.5)
 *
 * Reads the tab config, calls useDashTab ONCE, and renders the listed panels.
 * There is no page component per tab and there must never be one — four
 * hand-written pages is how the layout drifts between tabs.
 *
 * The layout follows the "Division Performance: Sales Dashboard" Excel report:
 * KPI tiles, the two summary tables, Key Brands, credit notes beside attrition,
 * then the SALES TRENDS and BRAND MIX sections.
 */
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFilters } from '../store/filterStore';
import { useDashTab } from '../queries/useDashTab';
import { usePrefetchMonths } from '../queries/usePrefetch';
import { DEFAULT_TAB, getTabByPath } from './registry';
import { ApiRequestError } from '../lib/api';
import type { KeyBrandRow } from '../types/api';

import { KpiStrip } from '../components/panels/KpiStrip';
import { ManpowerAttrition, PrimaryPerformance, SecondaryPcpmRcpa } from '../components/panels/SummaryTables';
import { KeyBrandsTable } from '../components/panels/KeyBrandsTable';
import { GeoTable } from '../components/panels/GeoTable';
import { CreditNoteCard } from '../components/panels/CreditNotePanel';
import { CnDetailPanels } from '../components/panels/CnDetail';
import { TrendCombo } from '../components/charts/TrendCombo';
import { BrandMix } from '../components/charts/BrandMix';
import { CHART_HEIGHT, XL } from '../components/charts/chartTheme';
import { SectionBar } from '../components/ui/Panel';
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
  // The performance tabs carry the KPI strip; the Credit note tab does not.
  const performance = has('primary');

  // The Key Brands Total row is the server's totals, never a client-side sum.
  // Collection has no brand split, so it stays blank here as it does per brand.
  const brandTotal: KeyBrandRow | undefined = data?.primary
    ? [
        'Total',
        data.primary.target.value,
        data.primary.dispatch.value,
        null,
        null,
        data.primary.dispatch.gr,
        data.secondary?.value ?? null,
        data.inventory?.value ?? null,
        data.rcpa?.actual ?? null,
      ]
    : undefined;

  return (
    <div className="relative">
      <RefetchBar active={stale} />
      <LoadingIndicator state={firstLoad ? 'loading' : stale ? 'updating' : null} />

      <div className="space-y-4 px-5 py-4">
        {/* ---- KPI tiles and the two summary tables --------------------- */}
        {performance && (
          <>
            <KpiStrip
              primary={data?.primary}
              secondary={data?.secondary}
              pcpm={data?.pcpm}
              loading={firstLoad}
              stale={stale}
            />
            {noPriorYear && !firstLoad && (
              <p className="-mt-2 text-[11px] text-[var(--xl-muted)]">
                Growth shows — because the prior-year period has no data in the source. Totals for
                the selected period are unaffected.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PrimaryPerformance primary={data?.primary} loading={firstLoad} stale={stale} />
              <SecondaryPcpmRcpa
                secondary={data?.secondary}
                pcpm={data?.pcpm}
                rcpa={data?.rcpa}
                inventory={data?.inventory}
                loading={firstLoad}
                stale={stale}
              />
            </div>
          </>
        )}

        {/* ---- The main grid -------------------------------------------- */}
        {has('keyBrands') && (
          <KeyBrandsTable data={data?.keyBrands} total={brandTotal} loading={firstLoad} stale={stale} />
        )}
        {has('geoTable') && <GeoTable data={data?.geoTable} loading={firstLoad} stale={stale} />}

        {/* ---- Credit notes, with attrition beside them ----------------- */}
        {has('creditNote') && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <CreditNoteCard cn={data?.creditNote} loading={firstLoad} stale={stale} />
            {performance && <ManpowerAttrition stale={stale} />}
          </div>
        )}

        {has('cnDetail') && (
          <CnDetailPanels data={data?.cnDetail} loading={firstLoad} stale={stale} />
        )}

        {/* ---- Sales trends --------------------------------------------- */}
        {has('trends') && (
          <>
            <SectionBar title="Sales Trends" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {firstLoad || !trends ? (
                Array.from({ length: performance ? 6 : 1 }, (_, i) => <ChartCardSkeleton key={i} />)
              ) : (
                <>
                  {performance && (hasSeries(trends.tgt) || hasSeries(trends.disp)) && (
                    <TrendCombo
                      title="Tgt vs Disp vs Coll (₹ Lacs)"
                      labels={labels}
                      stale={stale}
                      bars={[
                        { name: 'Tgt', data: trends.tgt ?? [], color: XL.blue },
                        { name: 'Disp', data: trends.disp ?? [], color: XL.red },
                        { name: 'Coll', data: trends.coll ?? [], color: XL.green },
                      ]}
                    />
                  )}

                  {performance && hasSeries(trends.tgt) && (
                    <TrendCombo
                      title="Target vs Ach% & Gr%"
                      note={
                        hasSeries(trends.grPct)
                          ? undefined
                          : 'Gr% needs a year of prior sales, which the source does not have yet.'
                      }
                      labels={labels}
                      stale={stale}
                      bars={[{ name: 'Tgt', data: trends.tgt!, color: XL.blue }]}
                      lines={[
                        ...(hasSeries(trends.achPct)
                          ? [{ name: 'Ach%', data: trends.achPct!, color: XL.red, isPercent: true }]
                          : []),
                        ...(hasSeries(trends.grPct)
                          ? [{ name: 'Gr%', data: trends.grPct!, color: XL.green, isPercent: true }]
                          : []),
                      ]}
                    />
                  )}

                  {/* Only the series that have data become bars, so the chart
                      is not padded out with empty legend entries. */}
                  {performance && hasSeries(trends.disp) && (
                    <TrendCombo
                      title="Disp, Sec, RCPA | PCPM"
                      labels={labels}
                      stale={stale}
                      bars={[
                        { name: 'Disp', data: trends.disp!, color: XL.blue },
                        ...(hasSeries(trends.sec) ? [{ name: 'Sec', data: trends.sec!, color: XL.red }] : []),
                        ...(hasSeries(trends.rcpa) ? [{ name: 'RCPA', data: trends.rcpa!, color: XL.green }] : []),
                      ]}
                      lines={
                        hasSeries(trends.pcpm)
                          ? [{ name: 'PCPM', data: trends.pcpm!, color: XL.purple, isPercent: false }]
                          : []
                      }
                    />
                  )}

                  {/* A chart with no feed keeps its slot and says why, rather
                      than vanishing and leaving a hole in the grid. */}
                  {hasSeries(trends.cnExp) ? (
                    <TrendCombo
                      title="Credit Notes — Exp / SRCN / PD"
                      labels={labels}
                      stale={stale}
                      bars={[
                        { name: 'Exp CN', data: trends.cnExp!, color: XL.blue, stack: 'cn' },
                        { name: 'SRCN', data: trends.cnSr ?? [], color: XL.red, stack: 'cn' },
                        { name: 'PD CN', data: trends.cnPd ?? [], color: XL.green, stack: 'cn' },
                      ]}
                      lines={
                        hasSeries(trends.cnPct)
                          ? [{ name: 'CN%', data: trends.cnPct!, color: XL.purple, isPercent: true }]
                          : []
                      }
                    />
                  ) : hasSeries(trends.cnPct) ? (
                    // The split is missing but the ratio is real, so plot that
                    // rather than dropping credit notes from the tab entirely.
                    <TrendCombo
                      title="Credit Notes — CN%"
                      note="The Exp / SRCN / PD split has no source yet; total CN% shown."
                      labels={labels}
                      stale={stale}
                      bars={[]}
                      lines={[{ name: 'CN%', data: trends.cnPct!, color: XL.purple, isPercent: true }]}
                    />
                  ) : (
                    <UnavailableChart
                      title="Credit Notes — Exp / SRCN / PD"
                      reason={reasonFor(data, 'creditNote.split') ?? 'No credit-note split feed.'}
                      height={CHART_HEIGHT.trend}
                    />
                  )}

                  {performance &&
                    (hasSeries(trends.rcpaPlan) ? (
                      <TrendCombo
                        title="RCPA Plan vs Actual | Value/Dr."
                        labels={labels}
                        stale={stale}
                        bars={[
                          { name: 'RCPA Plan', data: trends.rcpaPlan!, color: XL.blue },
                          { name: 'RCPA Actual', data: trends.rcpaActual ?? [], color: XL.red },
                        ]}
                        lines={
                          hasSeries(trends.valuePerDr)
                            ? [{ name: 'Value / Dr.', data: trends.valuePerDr!, color: XL.green, isPercent: false }]
                            : []
                        }
                      />
                    ) : (
                      <UnavailableChart
                        title="RCPA Plan vs Actual | Value/Dr."
                        reason={reasonFor(data, 'rcpa') ?? 'No RCPA plan source yet.'}
                        height={CHART_HEIGHT.trend}
                      />
                    ))}

                  {performance && (
                    <UnavailableChart
                      title="Attrition — TMs / RMs / ZSMs"
                      reason="No attrition source yet. Leavers by cadre will chart here once a field-force feed is connected."
                      height={CHART_HEIGHT.trend}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ---- Brand mix ------------------------------------------------ */}
        {has('mix') && data?.mix && (
          <>
            <SectionBar title="Brand Mix" />
            <BrandMix mix={data.mix} stale={stale} collNote={reasonFor(data, 'mix.coll')} />
          </>
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
    <div className="xl-chart">
      <div className="mx-auto mb-2 h-4 w-40 skeleton" />
      <ChartSkeleton height={CHART_HEIGHT.trend} />
    </div>
  );
}

function RedirectToDefault({ onRedirect }: { onRedirect: () => void }) {
  queueMicrotask(onRedirect);
  return null;
}
