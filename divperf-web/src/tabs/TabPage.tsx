/**
 * The one tab engine. (§8.5)
 *
 * Reads the tab config, calls useDashTab ONCE, and renders the listed panels.
 * There is no page component per tab and there must never be one — four
 * hand-written pages is how the layout drifts between tabs.
 *
 * The layout follows the "Division Performance: Sales Dashboard" Excel report:
 * KPI tiles, the two summary tables, Key Brands, credit notes beside attrition,
 * then the EFFORT DASHBOARD, SALES TRENDS and BRAND MIX sections.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFilters } from '../store/filterStore';
import { useDashTab } from '../queries/useDashTab';
import { usePrefetchMonths } from '../queries/usePrefetch';
import { DEFAULT_TAB, getTabByPath } from './registry';
import { ApiRequestError } from '../lib/api';
import type { KeyBrandRow, TabResponse } from '../types/api';

import { KpiStrip } from '../components/panels/KpiStrip';
import {
  ManpowerAttrition, PrimaryPerformance, RxRxberPd, SecondaryPcpmRcpa,
} from '../components/panels/SummaryTables';
import { KeyBrandsTable } from '../components/panels/KeyBrandsTable';
import { GeoTable } from '../components/panels/GeoTable';
import { StockistTable } from '../components/panels/StockistTable';
import { CreditNoteCard } from '../components/panels/CreditNotePanel';
import { CnDetailPanels } from '../components/panels/CnDetail';
import { CallAvgFieldDays, DoctorCounts, EffortTable, PcpmBox } from '../components/panels/EffortPanels';
import { HmlTable, HmlTierPie, HospitalCoverageChart, TierCoverageChart } from '../components/panels/HospitalPanels';
import { DetailDrawer, type DetailRequest } from '../components/panels/DetailDrawer';
import type { OpenDetail } from '../components/ui/FigureLink';
import { MissedByCategory } from '../components/charts/MissedByCategory';
import { TrendCombo } from '../components/charts/TrendCombo';
import { CountTrend } from '../components/charts/CountTrend';
import { BrandMix } from '../components/charts/BrandMix';
import { CHART_HEIGHT, XL } from '../components/charts/chartTheme';
import { SectionBar } from '../components/ui/Panel';
import { ChartSkeleton, ErrorState, LoadingIndicator, RefetchBar } from '../components/ui/States';
import { UnavailableChart } from '../components/ui/NoSource';
import { DashboardFooter } from '../components/ui/DashboardFooter';
import { label as monthLabel } from '../lib/yrmn';

/** Sales Trends grid spans (six columns on wide screens). */
const HALF = 'xl:col-span-3';
const THIRD = 'xl:col-span-2';
const FULL = 'md:col-span-2 xl:col-span-6';

/** Effort grid spans (six columns on wide screens). */
const TWO_THIRDS = 'xl:col-span-4';

/** A series is drawable only if it exists and holds at least one real value. */
const hasSeries = (s?: (number | null)[]) => !!s && s.some((v) => v !== null);

/**
 * Which months CN% covers, when the period reaches past the sales data: only
 * those months' credit notes are set against the gross sales.
 */
function cnPctNote(meta: TabResponse['meta'] | undefined): string | undefined {
  if (!meta || meta.cnPctFrom === null || meta.cnPctTo === null) return undefined;
  if (meta.cnPctFrom === meta.from && meta.cnPctTo === meta.to) return undefined;
  const months =
    meta.cnPctFrom === meta.cnPctTo
      ? monthLabel(meta.cnPctFrom)
      : `${monthLabel(meta.cnPctFrom)} – ${monthLabel(meta.cnPctTo)}`;
  return `CN% covers ${months} only — the months of the period with sales in the source. Credit notes from the other months are counted in the values but left out of the %.`;
}

/** The server's explanation for a missing panel, if it sent one. */
const reasonFor = (data: { meta: { unavailable?: { key: string; reason: string }[] } } | undefined, key: string) =>
  data?.meta.unavailable?.find((u) => u.key === key)?.reason;

/** What the doctor counts leave out: a brand selection, divisions with no effort data. */
function effortCaveat(data: TabResponse | undefined): string | undefined {
  const parts = [reasonFor(data, 'effort.brand'), reasonFor(data, 'effort.unmapped')].filter(Boolean);
  if (data?.effort && data.effort.months.length > 1) {
    parts.unshift('Counts are per month, averaged over the months with effort data.');
  }
  return parts.length ? parts.join(' ') : undefined;
}

export function TabPage() {
  const { tab: tabPath } = useParams();
  const navigate = useNavigate();
  const config = getTabByPath(tabPath ?? '') ?? DEFAULT_TAB;

  const filters = useFilters();
  const { data, isPending, isFetching, isError, error, refetch } = useDashTab(config.id, filters);
  usePrefetchMonths(config.id, filters);

  // The side panel: closed, or open on a detail list with its facets chosen.
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const openDetail: OpenDetail = useCallback((list, initial) => setDetail({ list, initial }), []);
  const closeDetail = useCallback(() => setDetail(null), []);

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
  // An older API without one: built from the KPI totals, without collection.
  const brandTotal: KeyBrandRow | undefined = data?.keyBrands?.total ?? (data?.primary
    ? [
        'Total',
        data.primary.target.value,
        data.primary.dispatch.value,
        data.primary.dispatch.gr,
        null,
        null,
        null,
        null,
        null,
        data.secondary?.value ?? null,
        data.inventory?.value ?? null,
        data.rcpa?.actual ?? null,
        null,
      ]
    : undefined);

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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PrimaryPerformance primary={data?.primary} loading={firstLoad} stale={stale} />
              <SecondaryPcpmRcpa
                secondary={data?.secondary}
                pcpm={data?.pcpm}
                rcpa={data?.rcpa}
                inventory={data?.inventory}
                loading={firstLoad}
                stale={stale}
                onOpen={openDetail}
              />
            </div>
          </>
        )}

        {/* ---- The main grid -------------------------------------------- */}
        {has('keyBrands') && (
          <KeyBrandsTable data={data?.keyBrands} total={brandTotal} loading={firstLoad} stale={stale} />
        )}
        {has('geoTable') && (
          <GeoTable data={data?.geoTable} loading={firstLoad} stale={stale} note={cnPctNote(data?.meta)} />
        )}

        {has('stockistTable') && (
          <StockistTable data={data?.stockistTable} loading={firstLoad} stale={stale} />
        )}

        {/* ---- Credit notes, with attrition beside them ----------------- */}
        {has('creditNote') && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <CreditNoteCard
              cn={data?.creditNote}
              loading={firstLoad}
              stale={stale}
              pctNote={cnPctNote(data?.meta)}
              closingMonth={data ? monthLabel(data.meta.to) : undefined}
            />
            {has('manpower') && (
              <ManpowerAttrition
                data={data?.manpower}
                loading={firstLoad}
                stale={stale}
                reason={reasonFor(data, 'manpower')}
                onOpen={openDetail}
              />
            )}
          </div>
        )}

        {has('cnDetail') && (
          <CnDetailPanels data={data?.cnDetail} loading={firstLoad} stale={stale} note={cnPctNote(data?.meta)} />
        )}

        {/* ---- Effort dashboard ----------------------------------------- */}
        {has('effort') && (
          <>
            <SectionBar title="Effort Dashboard" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DoctorCounts
                data={data?.effort}
                loading={firstLoad}
                stale={stale}
                note={reasonFor(data, 'effort')}
                caveat={effortCaveat(data)}
                onOpen={openDetail}
              />
              <EffortTable
                data={data?.effort}
                loading={firstLoad}
                stale={stale}
                note={reasonFor(data, 'effort')}
                caveat={reasonFor(data, 'effort.noSource')}
                onOpen={openDetail}
              />
              {has('rx') && (
                <RxRxberPd
                  data={data?.rx}
                  loading={firstLoad}
                  stale={stale}
                  periodFrom={data?.meta.from}
                  periodTo={data?.meta.to}
                  reason={reasonFor(data, 'rx')}
                />
              )}
              {has('pcpm') && (
                <PcpmBox data={data?.pcpm} loading={firstLoad} stale={stale} note={reasonFor(data, 'pcpm')} onOpen={openDetail} />
              )}
            </div>

            {/* RESEARCH only: the API sends hospitals when division 84 is in view. */}
            {has('hospitals') && data?.hospitals && (
              <>
                <SectionBar title="Hospital Coverage & Tier Mix" />
                <HmlTable
                  data={data.hospitals}
                  loading={false}
                  stale={stale}
                  note={reasonFor(data, 'hospitals.coverage')}
                  onOpen={openDetail}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <HospitalCoverageChart data={data.hospitals} reason={reasonFor(data, 'hospitals.coverage')} stale={stale} />
                  <HmlTierPie data={data.hospitals} stale={stale} />
                  <TierCoverageChart data={data.hospitals} stale={stale} />
                </div>
                <SectionBar title="Effort Trends" />
              </>
            )}

            {/* Six columns on wide screens: Drs Met beside the monthly table,
                then Drs Missed beside Rx — no row is left with an empty slot. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              {firstLoad || !data ? (
                <>
                  <ChartCardSkeleton className={`md:col-span-2 ${TWO_THIRDS}`} />
                  <ChartCardSkeleton className={`md:col-span-2 ${THIRD}`} />
                </>
              ) : (
                <>
                  <div className={`md:col-span-2 ${TWO_THIRDS}`}>
                    {data.effort && data.effort.months.length > 0 ? (
                      <CountTrend
                        title="Drs Met | Covrg%"
                        labels={data.effort.months.map((m) => m.label)}
                        stale={stale}
                        bars={[
                          { name: 'Drs Met', data: data.effort.months.map((m) => m.drsMet), color: XL.blue },
                          ...(data.effort.months.some((m) => m.drsMetRtFrq !== null)
                            ? [{ name: 'Met with Rt Frq', data: data.effort.months.map((m) => m.drsMetRtFrq), color: XL.orange }]
                            : []),
                        ]}
                        ratioLines={[
                          { name: 'Covrg%', data: data.effort.months.map((m) => m.coveragePct), color: XL.green },
                          { name: 'Covrg% with Rt Frq', data: data.effort.months.map((m) => m.rtFrqCoveragePct), color: XL.purple },
                        ]}
                        ratioUnit="%"
                      />
                    ) : (
                      <UnavailableChart
                        title="Drs Met | Covrg%"
                        reason={reasonFor(data, 'effort') ?? 'No effort data for this selection.'}
                        height={CHART_HEIGHT.trend}
                      />
                    )}
                  </div>
                  <div className={`md:col-span-2 ${THIRD}`}>
                    <CallAvgFieldDays
                      data={data.effort}
                      loading={false}
                      stale={stale}
                      note={reasonFor(data, 'effort')}
                      onOpen={openDetail}
                    />
                  </div>
                </>
              )}

              <div className={THIRD}>
                {firstLoad || !data ? (
                  <ChartCardSkeleton />
                ) : data.effort?.missedByCategory ? (
                  <MissedByCategory
                    labels={data.effort.missedByCategory.labels}
                    values={data.effort.missedByCategory.values}
                    onSelect={(category) => openDetail('doctors', { status: 'missed', category })}
                    stale={stale}
                  />
                ) : (
                  <UnavailableChart
                    title="Drs Missed"
                    reason={reasonFor(data, 'effort') ?? 'No missed-doctor data for the selected period.'}
                    height={CHART_HEIGHT.trend}
                  />
                )}
              </div>

              {has('rx') && (
                <div className={TWO_THIRDS}>
                  {firstLoad || !trends ? (
                    <ChartCardSkeleton />
                  ) : hasSeries(trends.rxns) || hasSeries(trends.rxber) ? (
                    <CountTrend
                      title="Rx, Rxber, P/D"
                      labels={labels}
                      stale={stale}
                      bars={[
                        { name: 'Rxns', data: trends.rxns ?? [], color: XL.blue },
                        { name: 'Rxber', data: trends.rxber ?? [], color: XL.orange },
                      ]}
                      ratioLines={[{ name: 'P/D', data: trends.rxPd ?? [], color: XL.green }]}
                    />
                  ) : (
                    <UnavailableChart
                      title="Rx, Rxber, P/D"
                      reason={reasonFor(data, 'rx') ?? 'No Rx data for the selected period.'}
                      height={CHART_HEIGHT.trend}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ---- Sales trends --------------------------------------------- */}
        {has('trends') && (
          <>
            <SectionBar title="Sales Trends" />
            {/* Six columns on wide screens: the two sales charts share the first
                row at half width, and the next three take a third each — no row
                is left with an empty slot. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              {firstLoad || !trends ? (
                performance ? (
                  <>
                    {[0, 1].map((i) => <ChartCardSkeleton key={`h${i}`} className={HALF} />)}
                    {[0, 1, 2].map((i) => <ChartCardSkeleton key={`t${i}`} className={THIRD} />)}
                  </>
                ) : (
                  <ChartCardSkeleton className={FULL} />
                )
              ) : (
                <>
                  {performance && (hasSeries(trends.tgt) || hasSeries(trends.disp)) && (
                    <div className={HALF}>
                      <TrendCombo
                        title="Tgt vs Disp vs Coll (₹ Lacs)"
                        labels={labels}
                        stale={stale}
                        height={CHART_HEIGHT.wide}
                        trend
                        bars={[
                          { name: hasSeries(trends.divTgt) ? 'Field Tgt' : 'Tgt', data: trends.tgt ?? [], color: XL.blue },
                          ...(hasSeries(trends.divTgt) ? [{ name: 'Div Tgt', data: trends.divTgt!, color: XL.orange }] : []),
                          { name: 'Disp', data: trends.disp ?? [], color: XL.red },
                          { name: 'Coll', data: trends.coll ?? [], color: XL.green },
                        ]}
                      />
                    </div>
                  )}

                  {/* Only the series that have data become bars, so the chart
                      is not padded out with empty legend entries. */}
                  {performance && hasSeries(trends.disp) && (
                    <div className={HALF}>
                      <TrendCombo
                        title="Disp, Sec, RCPA | PCPM"
                        labels={labels}
                        stale={stale}
                        height={CHART_HEIGHT.wide}
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
                    </div>
                  )}

                  {/* Credit notes have a source (their own view), so a period
                      without any shows the chart's "no data" state, not "no source". */}
                  <div className={performance ? THIRD : FULL}>
                    <TrendCombo
                      title="Credit Notes — Exp / SRCN / PD"
                      note={
                        hasSeries(trends.cnExp) || hasSeries(trends.cnSr) || hasSeries(trends.cnPd)
                          ? hasSeries(trends.cnPct)
                            ? undefined
                            : 'CN% needs gross sales, which the source does not have for these months.'
                          : undefined
                      }
                      labels={labels}
                      stale={stale}
                      bars={[
                        { name: 'Exp CN', data: trends.cnExp ?? [], color: XL.blue, stack: 'cn' },
                        { name: 'SRCN', data: trends.cnSr ?? [], color: XL.red, stack: 'cn' },
                        { name: 'PD CN', data: trends.cnPd ?? [], color: XL.green, stack: 'cn' },
                      ]}
                      lines={
                        hasSeries(trends.cnPct)
                          ? [{ name: 'CN%', data: trends.cnPct!, color: XL.purple, isPercent: true }]
                          : []
                      }
                    />
                  </div>

                  {performance && (
                    <div className={THIRD}>
                      {hasSeries(trends.rcpaPlan) ? (
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
                      )}
                    </div>
                  )}

                  {has('manpower') && (
                    <div className={THIRD}>
                      {trends.leftTm ? (
                        <CountTrend
                          title="Attrition — TMs / RMs / ZSMs"
                          labels={labels}
                          stale={stale}
                          lines={[
                            { name: 'TMs Left', data: trends.leftTm, color: XL.blue },
                            { name: 'RMs Left', data: trends.leftRm ?? [], color: XL.orange },
                            { name: 'ZSMs Left', data: trends.leftZsm ?? [], color: XL.green },
                          ]}
                        />
                      ) : (
                        <UnavailableChart
                          title="Attrition — TMs / RMs / ZSMs"
                          reason={reasonFor(data, 'manpower') ?? 'Attrition is not available for this view.'}
                          height={CHART_HEIGHT.trend}
                        />
                      )}
                    </div>
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
            <BrandMix mix={data.mix} stale={stale} collNote={data.mix.collNote} />
          </>
        )}

        <DashboardFooter meta={data?.meta} periodLabel={periodLabel} />

        <DetailDrawer request={detail} onClose={closeDetail} filters={filters} periodLabel={periodLabel} />
      </div>

      {/* Deep-linking a tab that no longer exists lands on the default. */}
      {!getTabByPath(tabPath ?? '') && tabPath !== undefined && (
        <RedirectToDefault onRedirect={() => navigate(`/${DEFAULT_TAB.path}`, { replace: true })} />
      )}
    </div>
  );
}

function ChartCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`xl-chart ${className}`}>
      <div className="mx-auto mb-2 h-4 w-40 skeleton" />
      <ChartSkeleton height={CHART_HEIGHT.trend} />
    </div>
  );
}

function RedirectToDefault({ onRedirect }: { onRedirect: () => void }) {
  queueMicrotask(onRedirect);
  return null;
}
