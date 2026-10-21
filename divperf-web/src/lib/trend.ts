/**
 * A least-squares straight line through a monthly series — what Excel draws as
 * a "linear trendline". Fitted over the months that have a value, then drawn
 * across every month. Fewer than two values: no trend (all null).
 *
 * Presentation only: it fits the figures already on the chart and is never
 * shown as a number in a table or tooltip.
 */
export function linearTrend(values: (number | null)[]): (number | null)[] {
  const points = values.flatMap((v, i) => (v === null || !Number.isFinite(v) ? [] : [[i, v] as const]));
  if (points.length < 2) return values.map(() => null);

  const n = points.length;
  const meanX = points.reduce((a, [x]) => a + x, 0) / n;
  const meanY = points.reduce((a, [, y]) => a + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - meanX) ** 2;
    sxy += (x - meanX) * (y - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  return values.map((_, i) => intercept + slope * i);
}
