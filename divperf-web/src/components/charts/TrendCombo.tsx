/**
 * The combo bar + line trend charts, as in the report:
 *
 *   "Tgt vs Disp vs Coll (₹ Lacs)"     bars
 *   "Target vs Ach% & Gr%"             Tgt bars + Ach% and Gr% lines
 *   "Disp, Sec, RCPA | PCPM"           bars + a PCPM line
 *   "Credit Notes — Exp / SRCN / PD"   stacked bars (+ CN% line)
 *
 * Lines sit on a second axis on the right. Money is in ₹ lakhs; the Table view
 * gives exact values for both scales.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import {
  BAR_STYLE, CHART_HEIGHT, INK_3, LINE_STYLE, STACK_STYLE,
  baseOption, categoryAxis, formatSeriesValue, grid, legend, moneyAxis, ratioAxis, tooltip,
} from './chartTheme';
import { ChartFrame, type TableSeries } from './ChartFrame';

export interface BarSeriesSpec {
  name: string;
  data: (number | null)[];
  color: string;
  /** Stacks all series that share a stack id. */
  stack?: string;
}

export interface LineSeriesSpec {
  name: string;
  data: (number | null)[];
  color: string;
  /** Percent renders the axis and tooltip with a % suffix. */
  isPercent: boolean;
}

/**
 * ECharts types the axis-trigger callback as CallbackDataParams, which omits
 * `axisValueLabel` even though the runtime always supplies it on an axis
 * trigger. Narrowing here keeps the single unavoidable cast in one place.
 */
interface TooltipRow {
  seriesName: string;
  marker: string;
  value: number | null;
  axisValueLabel: string;
}

function toTooltipRows(params: unknown): TooltipRow[] {
  const list = Array.isArray(params) ? params : [params];
  return list.map((p) => {
    const r = p as Partial<TooltipRow>;
    return {
      seriesName: r.seriesName ?? '',
      marker: r.marker ?? '',
      value: typeof r.value === 'number' ? r.value : null,
      axisValueLabel: r.axisValueLabel ?? '',
    };
  });
}

interface TrendComboProps {
  title: string;
  note?: string;
  labels: string[];
  bars: BarSeriesSpec[];
  lines?: LineSeriesSpec[];
  height?: number;
  stale?: boolean;
}

export function TrendCombo({
  title, note, labels, bars, lines = [], height = CHART_HEIGHT.trend, stale,
}: TrendComboProps) {
  const percentNames = new Set(lines.filter((l) => l.isPercent).map((l) => l.name));
  const linesArePercent = lines.length > 0 && lines.every((l) => l.isPercent);

  const option: EChartsOption = {
    ...baseOption,
    grid: grid({ bottom: 30 }),
    legend: legend(0),
    tooltip: {
      ...tooltip('axis'),
      formatter: (params) => {
        const rows = toTooltipRows(params);
        const head = rows[0]?.axisValueLabel ?? '';
        const body = rows
          .map(
            (p) => `<div style="display:flex;gap:12px;justify-content:space-between">
                      <span>${p.marker} ${p.seriesName}</span>
                      <span style="font-variant-numeric:tabular-nums">${formatSeriesValue(p.seriesName, p.value, percentNames)}</span>
                    </div>`,
          )
          .join('');
        return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${body}`;
      },
    },
    xAxis: categoryAxis(labels),
    yAxis: lines.length ? [moneyAxis(), ratioAxis('', linesArePercent)] : [moneyAxis()],
    series: [
      ...bars.map((b) => ({
        ...(b.stack ? { ...STACK_STYLE, stack: b.stack } : BAR_STYLE),
        name: b.name,
        data: b.data,
        yAxisIndex: 0,
        itemStyle: {
          ...(b.stack ? STACK_STYLE.itemStyle : BAR_STYLE.itemStyle),
          color: b.color,
        },
      })),
      ...lines.map((l) => ({
        ...LINE_STYLE,
        name: l.name,
        data: l.data,
        yAxisIndex: 1,
        itemStyle: { color: l.color },
        lineStyle: { ...LINE_STYLE.lineStyle, color: l.color },
        emphasis: { focus: 'series' as const },
      })),
    ],
  };

  const tableSeries: TableSeries[] = [
    ...bars.map((b): TableSeries => ({ name: b.name, values: b.data, format: 'money' })),
    ...lines.map((l): TableSeries => ({ name: l.name, values: l.data, format: l.isPercent ? 'percent' : 'money' })),
  ];

  // A line alone (CN% without its split) is still something to draw.
  const hasData = [...bars.map((b) => b.data), ...lines.map((l) => l.data)].some((d) =>
    d.some((v) => v !== null && v !== 0),
  );

  return (
    <ChartFrame title={title} note={note} height={height} categories={labels} series={tableSeries} stale={stale}>
      {hasData ? (
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
          lazyUpdate
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[12px]" style={{ color: INK_3 }}>
          No data for the selected period.
        </div>
      )}
    </ChartFrame>
  );
}
