/**
 * A monthly chart of counts — people or prescriptions, not money: the report's
 * "Attrition" (TMs / RMs / ZSMs Left lines) and "Rx, Rxber, P/D" (Rxns and
 * Rxber bars, P/D line on a right-hand axis). Whole-number left axis; zero is a
 * real value (nobody left), so a flat line at zero is drawn, not "no data".
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import {
  BAR_STYLE, CHART_HEIGHT, FONT, INK_2, LINE_STYLE, RULE, baseOption, categoryAxis, grid, legend, tooltip,
} from './chartTheme';
import { ChartFrame } from './ChartFrame';

export interface CountSeries {
  name: string;
  data: (number | null)[];
  color: string;
}

const axisLabel = { color: INK_2, fontSize: 11, fontFamily: FONT };

/** Counts as whole numbers; ratios (the right axis) to one decimal, with their unit. */
const show = (v: number | null | undefined, ratio: boolean, unit = '') =>
  v === null || v === undefined ? '—' : ratio ? `${v.toFixed(1)}${unit}` : Math.round(v).toLocaleString('en-IN');

export function CountTrend({
  title, note, labels, bars = [], lines = [], ratioLines = [], ratioUnit = '', height = CHART_HEIGHT.trend, stale,
}: {
  title: string;
  note?: string;
  labels: string[];
  /** Counts drawn as bars, on the left axis. */
  bars?: CountSeries[];
  /** Counts drawn as lines, on the left axis. */
  lines?: CountSeries[];
  /** Ratios drawn as lines on a right-hand axis, e.g. P/D. */
  ratioLines?: CountSeries[];
  /** The ratios' unit, e.g. "%" for coverage. */
  ratioUnit?: string;
  height?: number;
  stale?: boolean;
}) {
  const ratioNames = new Set(ratioLines.map((l) => l.name));
  const line = (l: CountSeries, yAxisIndex: number) => ({
    ...LINE_STYLE,
    name: l.name,
    data: l.data,
    yAxisIndex,
    itemStyle: { color: l.color },
    lineStyle: { ...LINE_STYLE.lineStyle, color: l.color },
    emphasis: { focus: 'series' as const },
  });

  const option: EChartsOption = {
    ...baseOption,
    grid: grid({ bottom: 30 }),
    legend: legend(0),
    tooltip: {
      ...tooltip('axis'),
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as {
          seriesName?: string; marker?: string; value?: number | null; axisValueLabel?: string;
        }[];
        const body = rows
          .map(
            (p) => `<div style="display:flex;gap:12px;justify-content:space-between">
                      <span>${p.marker ?? ''} ${p.seriesName ?? ''}</span>
                      <span style="font-variant-numeric:tabular-nums">${show(p.value, ratioNames.has(p.seriesName ?? ''), ratioUnit)}</span>
                    </div>`,
          )
          .join('');
        return `<div style="font-weight:600;margin-bottom:4px">${rows[0]?.axisValueLabel ?? ''}</div>${body}`;
      },
    },
    xAxis: categoryAxis(labels),
    yAxis: [
      {
        type: 'value',
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: RULE, type: 'solid', width: 1 } },
        axisLabel: { ...axisLabel, formatter: (v: number) => v.toLocaleString('en-IN') },
      },
      ...(ratioLines.length
        ? [{
            type: 'value' as const,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { ...axisLabel, formatter: (v: number) => `${v.toFixed(ratioUnit === '%' ? 0 : 1)}${ratioUnit}` },
          }]
        : []),
    ],
    series: [
      ...bars.map((b) => ({
        ...BAR_STYLE,
        name: b.name,
        data: b.data,
        yAxisIndex: 0,
        itemStyle: { ...BAR_STYLE.itemStyle, color: b.color },
      })),
      ...lines.map((l) => line(l, 0)),
      ...ratioLines.map((l) => line(l, 1)),
    ],
  };

  const all = [...bars, ...lines, ...ratioLines];
  return (
    <ChartFrame
      title={title}
      note={note}
      height={height}
      categories={labels}
      series={all.map((l) => ({
        name: l.name,
        values: l.data,
        format: ratioUnit === '%' && ratioNames.has(l.name) ? 'percent' : 'number',
      }))}
      stale={stale}
    >
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        lazyUpdate
      />
    </ChartFrame>
  );
}
