/**
 * Shared ECharts theme and the primitives every chart in this app is built from.
 *
 * Design rules encoded here (see §9 and the palette note in index.css):
 *  - Recessive grid and axes; the data is the only thing with weight.
 *  - Thin marks with a 2px surface gap between adjacent bars and between
 *    stacked segments, so the coll/sec pair stays separable under protanopia
 *    where it only reaches ΔE 7.4.
 *  - 4px rounded data-ends anchored to the baseline.
 *  - A legend is always present for two or more series — identity is never
 *    carried by colour alone.
 *  - Axis labels and values wear ink tokens, never the series colour.
 */
import type { EChartsOption } from 'echarts';
import { axisMoney, moneyFull, percent } from '../../lib/format';

export const SERIES = {
  disp: '#17607D',
  sec: '#E8743B',
  coll: '#2E7D4F',
  rcpa: '#4FA3C7',
  tgt: '#A9B8BF',
  cnExp: '#17607D',
  cnSr: '#E8743B',
  cnPd: '#7B4EA3',
  /** Ratio lines read as a different kind of quantity, so they wear ink. */
  ratio: '#47606B',
} as const;

export const INK = '#10242E';
export const INK_2 = '#47606B';
export const INK_3 = '#7B909A';
export const RULE = '#DDE3E1';
export const SURFACE = '#FFFFFF';

/** Categorical order for the mix donuts. Fixed, never cycled. */
export const MIX_COLORS = [SERIES.disp, SERIES.sec, SERIES.coll, SERIES.cnPd, SERIES.rcpa, INK_3];

const FONT = '"IBM Plex Sans", system-ui, sans-serif';

export const baseTextStyle = { fontFamily: FONT, color: INK_2, fontSize: 11 };

/** Charts get a fixed height per breakpoint so a month change never shifts layout. */
export const CHART_HEIGHT = { trend: 260, mix: 170, wide: 300 } as const;

export function categoryAxis(labels: string[]) {
  return {
    type: 'category' as const,
    data: labels,
    axisLine: { lineStyle: { color: RULE } },
    axisTick: { show: false },
    axisLabel: { color: INK_3, fontSize: 11, fontFamily: FONT, hideOverlap: true },
  };
}

export function moneyAxis(name?: string) {
  return {
    type: 'value' as const,
    name,
    nameTextStyle: { color: INK_3, fontSize: 11, fontFamily: FONT, align: 'left' as const },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: RULE, type: 'solid' as const, width: 1 } },
    axisLabel: {
      color: INK_3,
      fontSize: 11,
      fontFamily: FONT,
      formatter: (v: number) => axisMoney(v),
    },
  };
}

export function ratioAxis(name: string, isPercent: boolean) {
  return {
    type: 'value' as const,
    name,
    nameTextStyle: { color: INK_3, fontSize: 11, fontFamily: FONT, align: 'right' as const },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: {
      color: INK_3,
      fontSize: 11,
      fontFamily: FONT,
      // One decimal where it matters, so a 0–3% axis does not read "3%, 3%, 2%, 2%".
      formatter: (v: number) => (isPercent ? `${Number(v.toFixed(1))}%` : axisMoney(v)),
    },
  };
}

/** 4px rounded data-ends anchored to the baseline, plus the 2px inter-bar gap. */
export const BAR_STYLE = {
  type: 'bar' as const,
  barMaxWidth: 22,
  barGap: '12%',
  barCategoryGap: '32%',
  itemStyle: { borderRadius: [4, 4, 0, 0] as [number, number, number, number] },
};

/** A stacked segment carries a surface-coloured hairline so segments separate. */
export const STACK_STYLE = {
  type: 'bar' as const,
  stack: 'total',
  barMaxWidth: 22,
  barCategoryGap: '32%',
  itemStyle: { borderColor: SURFACE, borderWidth: 2 },
};

export const LINE_STYLE = {
  type: 'line' as const,
  smooth: false,
  symbol: 'circle' as const,
  symbolSize: 8,
  lineStyle: { width: 2 },
  z: 5,
};

export const legend = (bottom = 0) => ({
  bottom,
  left: 'center' as const,
  icon: 'roundRect',
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 14,
  textStyle: { color: INK_2, fontSize: 11, fontFamily: FONT },
});

export const grid = (opts: { left?: number; right?: number; top?: number; bottom?: number } = {}) => ({
  left: opts.left ?? 8,
  right: opts.right ?? 8,
  top: opts.top ?? 16,
  bottom: opts.bottom ?? 26,
  containLabel: true,
});

/**
 * Crosshair tooltip. Money series render at full precision here — the axis
 * abbreviates, the tooltip does not.
 */
export function tooltip(kind: 'axis' | 'item' = 'axis'): EChartsOption['tooltip'] {
  return {
    trigger: kind,
    axisPointer: { type: 'line', lineStyle: { color: INK_3, width: 1, type: 'dashed' } },
    backgroundColor: SURFACE,
    borderColor: RULE,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: INK, fontSize: 12, fontFamily: FONT },
    extraCssText: 'box-shadow: 0 2px 8px rgba(16,36,46,0.10); border-radius: 6px;',
  };
}

/** Formats a value for a tooltip row according to the series it belongs to. */
export function formatSeriesValue(
  name: string,
  value: number | null,
  percentSeries: ReadonlySet<string>,
): string {
  if (value === null || value === undefined) return '—';
  return percentSeries.has(name) ? percent(value) : moneyFull(value);
}

export const baseOption: EChartsOption = {
  textStyle: baseTextStyle,
  animationDuration: 300,
  // Respect the OS setting rather than animating regardless. (§9.6)
  animation:
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? false
      : true,
};
