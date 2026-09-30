/**
 * The combo bar+line trend charts. Reproduces four charts from the Excel:
 *
 *   "Disp, Sec, RCPA, PCPM"          bars + a PCPM line
 *   "Tgt vs. Disp vs. Coll"          bars only
 *   "RCPA Plan vs. Actual"           bars + a Value/Dr line
 *   "Credit Note"                    stacked bars + a CN% line
 *
 * A note on the secondary axis: pairing a money scale with a ratio scale on one
 * chart is a compromise. It is here because the report this replaces has read
 * that way for years and §9 is explicit that continuity of reading beats
 * reinvention. The mitigations are that the ratio series is drawn in ink rather
 * than a series colour so it does not read as a fourth measure, its axis is
 * labelled on the right, and the Table view gives exact values for both scales.
 * Set `ratio: undefined` to drop the second axis entirely.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import {
  BAR_STYLE, CHART_HEIGHT, INK_3, LINE_STYLE, STACK_STYLE, SERIES,
  baseOption, categoryAxis, grid, legend, moneyAxis, ratioAxis, tooltip,
} from './chartTheme';
import { ChartFrame, type TableSeries } from './ChartFrame';
import { moneyFull, percent } from '../../lib/format';

export interface BarSeriesSpec {
  name: string;
  data: (number | null)[];
  color: string;
  /** Stacks all series that share a stack id. */
  stack?: string;
}

export interface RatioSeriesSpec {
  name: string;
  data: (number | null)[];
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
  ratio?: RatioSeriesSpec;
  height?: number;
  stale?: boolean;
}

export function TrendCombo({
  title, note, labels, bars, ratio, height = CHART_HEIGHT.trend, stale,
}: TrendComboProps) {
  const percentNames = new Set(ratio?.isPercent ? [ratio.name] : []);

  const option: EChartsOption = {
    ...baseOption,
    grid: grid({ bottom: 30, right: ratio ? 8 : 8 }),
    legend: legend(0),
    tooltip: {
      ...tooltip('axis'),
      formatter: (params) => {
        const rows = toTooltipRows(params);
        const head = rows[0]?.axisValueLabel ?? '';
        const body = rows
          .map((p) => {
            const text =
              p.value === null || p.value === undefined
                ? '—'
                : percentNames.has(p.seriesName)
                  ? percent(p.value)
                  : moneyFull(p.value);
            return `<div style="display:flex;gap:10px;justify-content:space-between">
                      <span>${p.marker} ${p.seriesName}</span>
                      <span style="font-variant-numeric:tabular-nums">${text}</span>
                    </div>`;
          })
          .join('');
        return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${body}`;
      },
    },
    xAxis: categoryAxis(labels),
    yAxis: ratio
      ? [moneyAxis(), ratioAxis(ratio.name, ratio.isPercent)]
      : [moneyAxis()],
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
      ...(ratio
        ? [
            {
              ...LINE_STYLE,
              name: ratio.name,
              data: ratio.data,
              yAxisIndex: 1,
              itemStyle: { color: SERIES.ratio },
              lineStyle: { width: 2, color: SERIES.ratio, type: 'dashed' as const },
              // A 2px surface ring keeps the marker readable where it crosses a bar.
              symbolSize: 8,
              emphasis: { focus: 'series' as const },
            },
          ]
        : []),
    ],
  };

  const tableSeries: TableSeries[] = [
    ...bars.map((b): TableSeries => ({ name: b.name, values: b.data, format: 'money' })),
    ...(ratio
      ? [{ name: ratio.name, values: ratio.data, format: ratio.isPercent ? ('percent' as const) : ('money' as const) }]
      : []),
  ];

  // A ratio line alone (CN% without its split) is still something to draw.
  const hasData = [...bars.map((b) => b.data), ratio?.data ?? []].some((d) =>
    d.some((v) => v !== null && v !== 0),
  );

  return (
    <ChartFrame
      title={title}
      note={note}
      height={height}
      categories={labels}
      series={tableSeries}
      stale={stale}
    >
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
        <div
          className="flex h-full items-center justify-center text-[12px]"
          style={{ color: INK_3 }}
        >
          No data for the selected period.
        </div>
      )}
    </ChartFrame>
  );
}
