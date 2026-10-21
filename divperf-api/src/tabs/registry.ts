/**
 * Tab configuration. One tab engine driven by config, not N hand-written
 * endpoints. (§1, §8.5) Mirrored in divperf-web/src/tabs/registry.ts.
 *
 * Adding a tab is a registry entry plus, at most, one new panel.
 */
import type { Grain, PanelId, TabId } from '../types/api.js';

export interface TabConfig {
  id: TabId;
  label: string;
  grain: Grain;
  panels: PanelId[];
  /** Trend series this tab's charts need. Drives which queries run. */
  trendSeries: string[];
  /** Dimension the mix donuts break down by. */
  mixDimension: 'brandGroup' | 'brand' | 'zone' | 'region' | 'hq';
}

/** The KPI band shared by every performance tab. */
const KPI_PANELS: PanelId[] = ['primary', 'pcpm', 'secondary', 'rcpa', 'inventory'];

/** The four charts shared by every performance tab. */
const CHART_SERIES = [
  // "Disp, Sec, RCPA, PCPM"
  'disp', 'sec', 'rcpa', 'pcpm',
  // "Tgt vs. Disp vs. Coll"
  'tgt', 'coll',
  // "RCPA Plan vs. Actual"
  'rcpaPlan', 'rcpaActual', 'valuePerDr',
  // "Credit Note"
  'cnExp', 'cnSr', 'cnPd', 'cnPct',
  // "Attrition": leavers per month, by cadre
  'leftTm', 'leftRm', 'leftZsm',
  // "Rx, Rxber, P/D"
  'rxns', 'rxber', 'rxPd',
];

export const TABS: TabConfig[] = [
  {
    id: 'division-performance',
    label: 'Division performance',
    grain: 'division',
    panels: [...KPI_PANELS, 'keyBrands', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
    trendSeries: CHART_SERIES,
    mixDimension: 'brand',
  },
  {
    id: 'zone-performance',
    label: 'Zonal performance',
    grain: 'zone',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
    trendSeries: CHART_SERIES,
    mixDimension: 'brand',
  },
  {
    id: 'region-performance',
    label: 'Regional performance',
    grain: 'region',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
    trendSeries: CHART_SERIES,
    mixDimension: 'brand',
  },
  {
    id: 'hq-performance',
    label: 'HQ performance',
    grain: 'hq',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
    trendSeries: CHART_SERIES,
    mixDimension: 'brand',
  },
  {
    id: 'credit-note',
    label: 'Credit note',
    grain: 'division',
    panels: ['creditNote', 'cnDetail', 'trends'],
    trendSeries: ['cnExp', 'cnSr', 'cnPd', 'cnPct'],
    mixDimension: 'brand',
  },
];

const BY_ID = new Map(TABS.map((t) => [t.id, t]));

export const getTab = (id: string): TabConfig | undefined => BY_ID.get(id as TabId);
export const isTabId = (id: string): id is TabId => BY_ID.has(id as TabId);
export const tabIds = (): TabId[] => TABS.map((t) => t.id);
