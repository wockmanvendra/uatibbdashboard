/**
 * Tree-shaken ECharts build.
 *
 * Importing `echarts` wholesale pulls in every chart type and both renderers —
 * about 1 MB minified, 350 kB gzipped, on a dashboard that draws bars, lines,
 * and pies. Registering only what is used cuts that to roughly a third, which
 * is real money against the sub-1200 ms cold-load target in §11.
 *
 * Adding a new chart type means registering it here. If a chart renders blank,
 * a missing registration is the first thing to check.
 */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DatasetComponent,
  TransformComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DatasetComponent,
  TransformComponent,
  LabelLayout,
  UniversalTransition,
  // Canvas, not SVG: 14 panels of SVG marks bloat the DOM and slow interaction.
  CanvasRenderer,
]);

export default echarts;
