/**
 * The report's BRAND MIX: four pies — Dispatch, Collection, Secondary and RCPA
 * by brand — each labelled with slice shares and its own legend, as in Excel.
 * A measure with no values keeps its slot and says why, rather than vanishing.
 *
 * Dispatch shows its top brands plus "Others". Secondary and RCPA name brands
 * differently from dispatch (WOSULIN CART, not WOSULIN CTG), so they show every
 * brand they have — or only the brands chosen in the filter — each in its own
 * colour, the same colour in both pies.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import type { MixPanel } from '../../types/api';
import {
  CHART_HEIGHT, FONT, INK_2, INK_3, MIX_COLORS, SURFACE, baseOption, brandColors, lakhLabel, legend, tooltip,
} from './chartTheme';
import { ChartFrame } from './ChartFrame';

const MEASURES = [
  { key: 'disp', title: 'Dispatch mix by brand' },
  { key: 'coll', title: 'Collection mix by brand' },
  { key: 'sec', title: 'Secondary mix by brand' },
  { key: 'rcpa', title: 'RCPA mix by brand' },
] as const;

function Pie({ title, note, labels, values, colors, stale, emptyReason }: {
  title: string;
  /** A caveat shown under the title. */
  note?: string;
  labels: string[];
  values: (number | null)[];
  /** One colour per slice. */
  colors: string[];
  stale: boolean;
  emptyReason: string;
}) {
  const hasData = values.some((v) => v !== null && v > 0);
  const option: EChartsOption = {
    ...baseOption,
    // Many brands: the legend scrolls rather than covering the pie.
    legend: { ...legend(0), type: 'scroll', itemGap: 12, pageIconSize: 10, pageTextStyle: { color: INK_2, fontSize: 10 } },
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
        center: ['50%', '45%'],
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
        data: labels.map((name, i) => ({
          name,
          value: values[i] ?? 0,
          itemStyle: { color: colors[i] },
        })),
      },
    ],
  };

  return (
    <ChartFrame
      title={title}
      note={hasData ? note : undefined}
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
  /** The caveat on collection by brand, from the server. */
  collNote?: string;
}) {
  // One colour per brand across the Secondary and RCPA pies.
  const brand = brandColors([...mix.sec.labels, ...mix.rcpa.labels]);
  const colorsFor = (key: (typeof MEASURES)[number]['key']) =>
    key === 'sec' || key === 'rcpa'
      ? mix[key].labels.map((l) => brand.get(l)!)
      : mix[key].labels.map((_, i) => MIX_COLORS[i % MIX_COLORS.length]!);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {MEASURES.map((m) => (
        <Pie
          key={m.key}
          title={m.title}
          labels={mix[m.key].labels}
          values={mix[m.key].values}
          colors={colorsFor(m.key)}
          note={m.key === 'coll' ? collNote : undefined}
          stale={stale}
          emptyReason="No data for the selected period."
        />
      ))}
    </div>
  );
}
