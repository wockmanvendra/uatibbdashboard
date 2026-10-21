/**
 * Tab configuration. Mirror of divperf-api/src/tabs/registry.ts. (§8.5)
 *
 * TabPage reads this and renders the listed panels. Adding a tab is a registry
 * entry — do not write a page component per tab.
 */
import type { Grain, PanelId, TabId } from '../types/api';

export interface TabConfig {
  id: TabId;
  /** URL segment. */
  path: string;
  label: string;
  grain: Grain;
  panels: PanelId[];
}

const KPI_PANELS: PanelId[] = ['primary', 'pcpm', 'secondary', 'rcpa', 'inventory'];

export const TABS: TabConfig[] = [
  {
    id: 'division-performance',
    path: 'division',
    label: 'Division',
    grain: 'division',
    panels: [...KPI_PANELS, 'keyBrands', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
  },
  {
    id: 'zone-performance',
    path: 'zone',
    label: 'Zonal',
    grain: 'zone',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
  },
  {
    id: 'region-performance',
    path: 'region',
    label: 'Regional',
    grain: 'region',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
  },
  {
    id: 'hq-performance',
    path: 'hq',
    label: 'HQ',
    grain: 'hq',
    panels: [...KPI_PANELS, 'geoTable', 'creditNote', 'manpower', 'rx', 'effort', 'trends', 'mix'],
  },
  {
    id: 'credit-note',
    path: 'credit-note',
    label: 'Credit note',
    grain: 'division',
    panels: ['creditNote', 'cnDetail', 'trends'],
  },
];

export const getTabByPath = (path: string): TabConfig | undefined =>
  TABS.find((t) => t.path === path);

export const DEFAULT_TAB = TABS[0]!;
