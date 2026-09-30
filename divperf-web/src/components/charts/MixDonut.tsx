/**
 * The four mix donuts (Disp / Coll / Sec / RCPA by brand group).
 *
 * A donut is the right form only because these are parts of one whole with few
 * slices and the Excel report reads that way. Slices are direct-labelled with
 * their share so identity never depends on colour alone, and the four donuts
 * share one legend rendered by the parent — repeating an identical legend four
 * times is noise.
 */
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from './echartsCore';
import { MIX_COLORS, INK_2, INK_3, SURFACE, baseOption, tooltip } from './chartTheme';
import { moneyFull } from '../../lib/format';

interface MixDonutProps {
  title: string;
  labels: string[];
  values: (number | null)[];
  height?: number;
  stale?: boolean;
}

export function MixDonut({ title, labels, values, height = 170 }: MixDonutProps) {
  const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const hasData = total > 0;

  const option: EChartsOption = {
    ...baseOption,
    color: MIX_COLORS,
    tooltip: {
      ...tooltip('item'),
      formatter: (p) => {
        const param = Array.isArray(p) ? p[0] : p;
        const v = param?.value as number;
        const share = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
        return `<div style="font-weight:600;margin-bottom:2px">${param?.name as string}</div>
                <div style="font-variant-numeric:tabular-nums">${moneyFull(v)} · ${share}%</div>`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['50%', '48%'],
        avoidLabelOverlap: true,
        // A 2px surface ring between slices, matching the bar spacer rule.
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: {
          show: true,
          formatter: (p) => `${((p.percent ?? 0) as number).toFixed(0)}%`,
          fontSize: 10,
          color: INK_2,
          fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
        },
        labelLine: { length: 6, length2: 6, lineStyle: { color: INK_3 } },
        // Slices below 4% collapse their label rather than collide.
        minShowLabelAngle: 14,
        data: labels.map((name, i) => ({ name, value: values[i] ?? 0 })),
      },
    ],
  };

  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-center text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
        {title}
      </h3>
      <div style={{ height }} role="img" aria-label={`${title} mix by share`}>
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
          <div className="flex h-full items-center justify-center text-[12px] text-ink-3">—</div>
        )}
      </div>
    </div>
  );
}
