/**
 * The report's "Hospital Coverage & Tier Mix" (RESEARCH): hospitals covered vs
 * missed by month, the hospital master list (HML) by tier, and coverage by
 * tier — with the HML table below.
 *
 * Coverage is blank until visits are recorded. Meanwhile the two coverage
 * charts draw the sample in /samples/hospital-coverage.json (public/), clearly
 * marked as a sample; without that file they say why there is nothing to draw.
 * The sample's tier percentages are applied to the real HML counts.
 */
import { useQuery } from '@tanstack/react-query';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from '../charts/echartsCore';
import type { HospitalPanel } from '../../types/api';
import { count, percent } from '../../lib/format';
import {
  BAR_STYLE, CHART_HEIGHT, FONT, INK_2, INK_3, MIX_COLORS, RULE, SURFACE, XL, baseOption, legend, tooltip,
} from '../charts/chartTheme';
import { ChartFrame } from '../charts/ChartFrame';
import { CountTrend } from '../charts/CountTrend';
import { UnavailableChart } from '../ui/NoSource';
import { Panel } from '../ui/Panel';
import { TableSkeleton } from '../ui/States';
import { FigureLink, hasAny, type OpenDetail } from '../ui/FigureLink';

const axisLabel = { color: INK_2, fontSize: 11, fontFamily: FONT };

const SAMPLE_NOTE = 'Sample data for illustration — hospital visits are not recorded in the source yet.';

interface HospitalSample {
  months?: { month: string; covered: number; missed: number }[];
  tiers?: { tier: string; coveragePct: number }[];
}

/** The sample file, if it is deployed; null when it is missing or unreadable. */
function useHospitalSample(): HospitalSample | null {
  const { data } = useQuery({
    queryKey: ['hospital-sample'],
    queryFn: async () => {
      try {
        const res = await fetch('/samples/hospital-coverage.json', { cache: 'no-cache' });
        return res.ok ? ((await res.json()) as HospitalSample) : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
  });
  return data ?? null;
}
/** Said by the charts that draw the list's hospitals when it has none. */
const EMPTY_LIST = 'The hospital master list (Infinity.Hospital_List) has no hospitals for this selection.';

/** The HML's own tier names, for the list's filter. */
const SOURCE_TIER: Record<string, string> = { 'Tier I': 'Tier 1', 'Tier II': 'Tier 2', 'Tier III': 'Tier 3', 'Tier IV': 'Tier 4' };

/** Hospitals covered and missed each month, with the coverage %. */
export function HospitalCoverageChart({ data, reason, stale }: { data: HospitalPanel; reason?: string; stale?: boolean }) {
  const sample = useHospitalSample();
  const months = data.months.filter((m) => m.covered !== null);
  if (!months.length && sample?.months?.length) {
    const rows = sample.months;
    return (
      <CountTrend
        title="Hosp Covered vs Missed | Coverage %"
        note={SAMPLE_NOTE}
        labels={rows.map((m) => m.month)}
        stale={stale}
        bars={[
          { name: 'Hosp Covered', data: rows.map((m) => m.covered), color: XL.blue },
          { name: 'Hosp Missed', data: rows.map((m) => m.missed), color: XL.red },
        ]}
        ratioLines={[{
          name: 'Covrg%',
          data: rows.map((m) => (m.covered + m.missed > 0 ? (m.covered / (m.covered + m.missed)) * 100 : null)),
          color: XL.green,
        }]}
        ratioUnit="%"
      />
    );
  }
  if (!months.length) {
    return (
      <UnavailableChart
        title="Hosp Covered vs Missed | Coverage %"
        reason={reason ?? 'No hospital visits are recorded for the selected period.'}
        height={CHART_HEIGHT.trend}
      />
    );
  }
  return (
    <CountTrend
      title="Hosp Covered vs Missed | Coverage %"
      labels={months.map((m) => m.label)}
      stale={stale}
      bars={[
        { name: 'Hosp Covered', data: months.map((m) => m.covered), color: XL.blue },
        { name: 'Hosp Missed', data: months.map((m) => m.missed), color: XL.red },
      ]}
      ratioLines={[{ name: 'Covrg%', data: months.map((m) => m.coveragePct), color: XL.green }]}
      ratioUnit="%"
    />
  );
}

/** The HML's hospitals by tier. */
export function HmlTierPie({ data, stale }: { data: HospitalPanel; stale?: boolean }) {
  if (!data.tiers.some((t) => t.count > 0)) {
    return <UnavailableChart title="HML mix by Tier" reason={EMPTY_LIST} height={CHART_HEIGHT.trend} />;
  }
  const labels = data.tiers.map((t) => t.label);
  const values = data.tiers.map((t) => t.count);
  const option: EChartsOption = {
    ...baseOption,
    color: MIX_COLORS,
    legend: legend(0),
    tooltip: {
      ...tooltip('item'),
      formatter: (p) => {
        const param = Array.isArray(p) ? p[0] : p;
        return `<b>${param?.name as string}</b><br/>${count(param?.value as number)} hospitals · ${((param?.percent as number) ?? 0).toFixed(1)}%`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['0%', '62%'],
        center: ['50%', '45%'],
        startAngle: 90,
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        label: { show: true, formatter: (p) => `${Math.round((p.percent ?? 0) as number)}%`, fontSize: 11, color: INK_2, fontFamily: FONT },
        labelLine: { length: 6, length2: 4, lineStyle: { color: INK_3 } },
        data: labels.map((name, i) => ({ name, value: values[i] })),
      },
    ],
  };
  return (
    <ChartFrame
      title="HML mix by Tier"
      note={data.untiered > 0 ? `${count(data.untiered)} hospitals have no tier and are not in the mix.` : undefined}
      height={CHART_HEIGHT.trend}
      categories={labels}
      categoryLabel="Tier"
      series={[{ name: 'Hospitals', values, format: 'number' }]}
      stale={stale}
    >
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} notMerge lazyUpdate />
    </ChartFrame>
  );
}

/** Covered and missed hospitals per tier, as stacked horizontal bars. */
export function TierCoverageChart({ data, stale }: { data: HospitalPanel; stale?: boolean }) {
  const sample = useHospitalSample();
  const recorded = data.tiers.some((t) => t.covered !== null);
  if (!data.tiers.some((t) => t.count > 0)) {
    return <UnavailableChart title="Tier-wise Covered vs Missed" reason={EMPTY_LIST} height={CHART_HEIGHT.trend} />;
  }
  if (!recorded && sample?.tiers?.length) {
    const pctOf = new Map(sample.tiers.map((t) => [t.tier, t.coveragePct]));
    const tiers = data.tiers.map((t) => {
      const pct = pctOf.get(t.label);
      const covered = pct === undefined ? null : Math.round((t.count * pct) / 100);
      return { ...t, covered, missed: covered === null ? null : t.count - covered };
    });
    return <TierBars tiers={tiers} note={`${SAMPLE_NOTE} Sample coverage % applied to the real hospital counts.`} stale={stale} />;
  }
  if (!recorded) {
    return (
      <UnavailableChart
        title="Tier-wise Covered vs Missed"
        reason="Visits are not recorded per hospital yet, so coverage by tier cannot be shown."
        height={CHART_HEIGHT.trend}
      />
    );
  }
  return <TierBars tiers={data.tiers} stale={stale} />;
}

function TierBars({ tiers: byTier, note, stale }: { tiers: HospitalPanel['tiers']; note?: string; stale?: boolean }) {
  // ECharts draws the first category at the bottom: reverse so Tier I is on top.
  const tiers = [...byTier].reverse();
  const option: EChartsOption = {
    ...baseOption,
    grid: { left: 8, right: 16, top: 8, bottom: 30, containLabel: true },
    legend: legend(0),
    tooltip: tooltip('axis'),
    xAxis: { type: 'value', minInterval: 1, axisLine: { show: false }, splitLine: { lineStyle: { color: RULE } }, axisLabel },
    yAxis: { type: 'category', data: tiers.map((t) => t.label), axisTick: { show: false }, axisLabel },
    series: [
      { ...BAR_STYLE, type: 'bar', stack: 'hosp', name: 'Hosp Covered', data: tiers.map((t) => t.covered), itemStyle: { color: XL.blue } },
      { ...BAR_STYLE, type: 'bar', stack: 'hosp', name: 'Missed Count', data: tiers.map((t) => t.missed), itemStyle: { color: XL.red } },
    ],
  };
  return (
    <ChartFrame
      title="Tier-wise Covered vs Missed"
      note={note}
      height={CHART_HEIGHT.trend}
      categories={byTier.map((t) => t.label)}
      categoryLabel="Tier"
      series={[
        { name: 'Hosp Covered', values: byTier.map((t) => t.covered), format: 'number' },
        { name: 'Missed Count', values: byTier.map((t) => t.missed), format: 'number' },
      ]}
      stale={stale}
    >
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} notMerge lazyUpdate />
    </ChartFrame>
  );
}

/** "Hospital Master List (HML) — Tier wise": counts by tier, coverage below. */
export function HmlTable({
  data, loading, stale, note, onOpen,
}: {
  data?: HospitalPanel | null;
  loading: boolean;
  stale: boolean;
  /** Why coverage is blank. */
  note?: string;
  onOpen?: OpenDetail;
}) {
  const columns = data ? [data.total, ...data.tiers] : [];
  const open = (labelText: string) => () =>
    onOpen?.('hospitals', labelText === 'Total' ? {} : { tier: SOURCE_TIER[labelText] ?? 'all' });

  return (
    <Panel title="Hospital Master List (HML) — Tier wise" stale={stale}>
      {loading || !data ? (
        <div className="p-3">
          <TableSkeleton rows={4} />
        </div>
      ) : (
        <table className="xl-table tnum">
          <caption className="sr-only">Hospitals in the master list, covered and missed, by tier</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">HML Metric</th>
              {columns.map((c) => (
                <th key={c.label} scope="col" className="text-right">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="text-left">Count of Hosp in HML</th>
              {columns.map((c) => (
                <td key={c.label} className="text-right">
                  <FigureLink
                    label={`List the ${c.label === 'Total' ? '' : `${c.label} `}hospitals`}
                    onClick={onOpen && hasAny(c.count) ? open(c.label) : undefined}
                  >
                    {count(c.count)}
                  </FigureLink>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="text-left">Hosp Covered</th>
              {columns.map((c) => <td key={c.label} className="text-right">{count(c.covered)}</td>)}
            </tr>
            <tr>
              <th scope="row" className="text-left">Covered %</th>
              {columns.map((c) => <td key={c.label} className="text-right">{percent(c.coveredPct)}</td>)}
            </tr>
            <tr>
              <th scope="row" className="text-left">Missed Count</th>
              {columns.map((c) => <td key={c.label} className="text-right">{count(c.missed)}</td>)}
            </tr>
          </tbody>
        </table>
      )}
      {data && (
        <p className="px-3 py-2 text-[11px] leading-relaxed text-[var(--xl-muted)]">
          {data.untiered > 0 && `${count(data.untiered)} of the ${count(data.total.count)} hospitals have no tier: they are in the Total only. `}
          {note}
        </p>
      )}
    </Panel>
  );
}
