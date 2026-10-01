/**
 * The report's BRAND MIX: four pies — Dispatch, Collection, Secondary and RCPA
 * by brand — each labelled with slice shares and its own legend, as in Excel.
 * A measure with no values keeps its slot and says why, rather than vanishing.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import type { MixPanel } from '../../types/api';
import { CHART_HEIGHT, FONT, INK_2, INK_3, MIX_COLORS, SURFACE, baseOption, lakhLabel, legend, tooltip } from './chartTheme';
import { ChartFrame } from './ChartFrame';

/** The API's bucket for every brand outside the top few. */
const OTHERS = 'Others';

const MEASURES = [
  { key: 'disp', title: 'Dispatch mix by brand' },
  { key: 'coll', title: 'Collection mix by brand' },
  { key: 'sec', title: 'Secondary mix by brand' },
  { key: 'rcpa', title: 'RCPA mix by brand' },
] as const;

function Pie({ title, labels, values, stale, emptyReason }: {
  title: string;
  labels: string[];
  values: (number | null)[];
  stale: boolean;
  emptyReason: string;
}) {
  const hasData = values.some((v) => v !== null && v > 0);
  // The slices are the top dispatch brands plus "Others". When a measure falls
  // almost entirely under Others, its feed names brands differently — say so,
  // or a solid one-colour pie reads as a bug.
  const total = values.reduce<number>((a, v) => a + (v !== null && v > 0 ? v : 0), 0);
  const others = values[labels.indexOf(OTHERS)] ?? 0;
  const note =
    hasData && others !== null && others / total >= 0.99
      ? 'None of it matches the top dispatch brands — this feed names brands differently.'
      : undefined;
  const option: EChartsOption = {
    ...baseOption,
    color: MIX_COLORS,
    legend: legend(0),
    tooltip: {
      ...tooltip('item'),
      formatter: (p) => {
        const param = Array.isArray(p) ? p[0] : p;
        return `<div style="font-weight:600;margin-bottom:2px">${param?.name as string}</div>
                <div style="font-variant-numeric:tabular-nums">${lakhLabel(param?.value as number)} · ${(
                  (param?.percent as number) ?? 0
                ).toFixed(1)}%</div>`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['0%', '60%'],
        center: ['50%', '46%'],
        startAngle: 90,
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        label: {
          show: true,
          formatter: (p) => `${Math.round((p.percent ?? 0) as number)}%`,
          fontSize: 11,
          color: INK_2,
          fontFamily: FONT,
        },
        labelLine: { length: 6, length2: 4, lineStyle: { color: INK_3 } },
        // Tiny slices drop their label rather than collide.
        minShowLabelAngle: 8,
        data: labels.map((name, i) => ({ name, value: values[i] ?? 0 })),
      },
    ],
  };

  return (
    <ChartFrame
      title={title}
      note={note}
      height={CHART_HEIGHT.mix}
      categories={labels}
      categoryLabel="Brand"
      series={[{ name: title.replace(' mix by brand', ''), values, format: 'money' }]}
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
        <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--xl-muted)]">
          {emptyReason}
        </div>
      )}
    </ChartFrame>
  );
}

export function BrandMix({ mix, stale = false, collNote }: {
  mix: MixPanel;
  stale?: boolean;
  /** Why collection has no brand split, when the server said. */
  collNote?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {MEASURES.map((m) => (
        <Pie
          key={m.key}
          title={m.title}
          labels={mix.labels}
          values={mix[m.key]}
          stale={stale}
          emptyReason={m.key === 'coll' && collNote ? collNote : 'No data for the selected period.'}
        />
      ))}
    </div>
  );
}
