/**
 * The report's "Drs Missed" chart: missed doctors by category, as horizontal
 * bars. A click on a bar lists that category's doctors.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import { BAR_STYLE, CHART_HEIGHT, FONT, INK_2, RULE, XL, baseOption, tooltip } from './chartTheme';
import { ChartFrame } from './ChartFrame';

const axisLabel = { color: INK_2, fontSize: 11, fontFamily: FONT };

export function MissedByCategory({
  labels,
  values,
  onSelect,
  stale,
}: {
  labels: string[];
  values: number[];
  /** A bar was clicked: list that category's doctors. */
  onSelect: (category: string) => void;
  stale?: boolean;
}) {
  // ECharts draws the first category at the bottom: reverse so A reads first.
  const ys = [...labels].reverse();
  const xs = [...values].reverse();
  const option: EChartsOption = {
    ...baseOption,
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    tooltip: tooltip('axis'),
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: RULE } },
      axisLabel: { ...axisLabel, formatter: (v: number) => v.toLocaleString('en-IN') },
    },
    yAxis: { type: 'category', data: ys, axisTick: { show: false }, axisLabel },
    series: [
      {
        ...BAR_STYLE,
        type: 'bar',
        name: 'Drs Missed',
        data: xs,
        cursor: 'pointer',
        itemStyle: { ...BAR_STYLE.itemStyle, color: XL.red },
        label: {
          show: true,
          position: 'right',
          color: INK_2,
          fontSize: 11,
          fontFamily: FONT,
          formatter: (p) => Number(p.value).toLocaleString('en-IN'),
        },
      },
    ],
  };

  return (
    <ChartFrame
      title="Drs Missed"
      note="Click a bar, or the Drs Missed figure, to list the doctors."
      height={CHART_HEIGHT.trend}
      categories={labels}
      categoryLabel="Category"
      series={[{ name: 'Drs Missed', values, format: 'number' }]}
      stale={stale}
    >
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={{ click: (p: { name?: string }) => p.name && onSelect(p.name) }}
        notMerge
        lazyUpdate
      />
    </ChartFrame>
  );
}
