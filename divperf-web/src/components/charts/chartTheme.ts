/**
 * Shared ECharts theme and the primitives every chart in this app is built from.
 *
 * The look is the "Division Performance: Sales Dashboard" Excel report: the
 * Office palette (blue, red, green, purple…) assigned by series position, flat
 * bars, square legend keys under the plot, centred titles, and values in
 * ₹ lakhs. A legend is always present for two or more series, and every chart
 * has a Table view, so identity never rests on colour alone.
 */
import type { EChartsOption } from 'echarts';
import { axisLakhs, lakhs, percent } from '../../lib/format';

/** The Office chart palette, in the order Excel assigns it. */
export const XL = {
  blue: '#4F81BD',
  red: '#C0504D',
  green: '#9BBB59',
  purple: '#8064A2',
  aqua: '#4BACC6',
  orange: '#F79646',
} as const;

export const INK = '#404040';
export const INK_2 = '#595959';
export const INK_3 = '#7F7F7F';
export const RULE = '#D9D9D9';
export const SURFACE = '#FFFFFF';

/** Slice order for the mix pies. Fixed, never cycled. */
export const MIX_COLORS = [XL.blue, XL.red, XL.green, XL.purple, XL.aqua, XL.orange];

/** The Office palette, then further distinct colours for pies with many brands. */
const BRAND_PALETTE = [
  ...MIX_COLORS,
  '#2C4D75', '#772C2A', '#5F7530', '#4D3B62', '#276A7C', '#B65708',
  '#729ACA', '#CD7371', '#AFC97A', '#9983B5', '#6FBDD1', '#F9AB6B',
  '#3A5F8F', '#8C3836', '#71893F', '#5E4878',
];

/**
 * A distinct colour for every brand in `names`, the same for a brand wherever
 * it appears. Names are coloured in sorted order, so a brand keeps its colour
 * between the pies; beyond the palette, golden-angle hues stay apart.
 */
export function brandColors(names: string[]): Map<string, string> {
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  return new Map(
    unique.map((name, i) => [
      name,
      BRAND_PALETTE[i] ?? `hsl(${Math.round((i * 137.508) % 360)}, 55%, 50%)`,
    ]),
  );
}

export const FONT = '"Segoe UI", Calibri, "Helvetica Neue", Arial, sans-serif';

export const baseTextStyle = { fontFamily: FONT, color: INK_2, fontSize: 11 };

/** Charts get a fixed height so a month change never shifts layout. */
export const CHART_HEIGHT = { trend: 250, mix: 280, wide: 300 } as const;

export function categoryAxis(labels: string[]) {
  return {
    type: 'category' as const,
    data: labels,
    axisLine: { lineStyle: { color: RULE } },
    axisTick: { show: false },
    axisLabel: { color: INK_2, fontSize: 11, fontFamily: FONT, hideOverlap: true },
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
    axisLabel: { color: INK_2, fontSize: 11, fontFamily: FONT, formatter: (v: number) => axisLakhs(v) },
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
      color: INK_2,
      fontSize: 11,
      fontFamily: FONT,
      // One decimal where it matters, so a 0–3% axis does not read "3%, 3%, 2%, 2%".
      formatter: (v: number) => (isPercent ? `${Number(v.toFixed(1))}%` : axisLakhs(v)),
    },
  };
}

/** Flat Excel bars. */
export const BAR_STYLE = {
  type: 'bar' as const,
  barMaxWidth: 18,
  barGap: '8%',
  barCategoryGap: '30%',
  itemStyle: { borderRadius: 0 },
};

/** Stacked segments carry a hairline so they separate. */
export const STACK_STYLE = {
  type: 'bar' as const,
  stack: 'total',
  barMaxWidth: 22,
  barCategoryGap: '35%',
  itemStyle: { borderColor: SURFACE, borderWidth: 1 },
};

export const LINE_STYLE = {
  type: 'line' as const,
  smooth: false,
  symbol: 'circle' as const,
  symbolSize: 5,
  lineStyle: { width: 2.5 },
  z: 5,
};

export const legend = (bottom = 0) => ({
  bottom,
  left: 'center' as const,
  icon: 'rect',
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 16,
  textStyle: { color: INK_2, fontSize: 11, fontFamily: FONT },
});

export const grid = (opts: { left?: number; right?: number; top?: number; bottom?: number } = {}) => ({
  left: opts.left ?? 8,
  right: opts.right ?? 8,
  top: opts.top ?? 14,
  bottom: opts.bottom ?? 26,
  containLabel: true,
});

export function tooltip(kind: 'axis' | 'item' = 'axis'): EChartsOption['tooltip'] {
  return {
    trigger: kind,
    axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(79,129,189,0.08)' } },
    backgroundColor: SURFACE,
    borderColor: RULE,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: INK, fontSize: 12, fontFamily: FONT },
    extraCssText: 'box-shadow: 0 2px 8px rgba(31,56,100,0.12); border-radius: 2px;',
  };
}

/** A money value in a tooltip or table: "340.0 L". */
export const lakhLabel = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${lakhs(v, 1)} L`;

/** Formats a value for a tooltip row according to the series it belongs to. */
export function formatSeriesValue(
  name: string,
  value: number | null,
  percentSeries: ReadonlySet<string>,
): string {
  if (value === null || value === undefined) return '—';
  return percentSeries.has(name) ? percent(value) : lakhLabel(value);
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
