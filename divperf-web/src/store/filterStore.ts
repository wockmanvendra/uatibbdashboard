/**
 * Filter state only. (§8.1)
 *
 * Server data lives in TanStack Query; this store holds nothing that came from
 * the API. Keeping the two separate is what makes the query keys reliable.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Filters } from '../queries/keys';
import { defaultPeriod } from '../lib/yrmn';

export type Density = 'comfortable' | 'compact';

interface FilterState extends Filters {
  density: Density;
  /**
   * The period is settled: the default from the server's open month has been
   * applied, or the user chose one. Dashboard queries wait for it, so the first
   * load is the period the user sees — and the one the API has pre-built.
   */
  periodReady: boolean;
  /** The user picked the period; the default no longer applies. */
  periodChosen: boolean;
  setPeriod: (from: number, to: number) => void;
  /** Fiscal year to date for the server's open month, unless the user chose a period. */
  applyDefaultPeriod: (openYrMn: number) => void;
  setDimension: (key: 'division' | 'brand' | 'zone' | 'region' | 'hq', values: string[]) => void;
  clearAll: () => void;
  setDensity: (d: Density) => void;
}

const DENSITY_KEY = 'divperf.density';

function initialDensity(): Density {
  if (typeof localStorage === 'undefined') return 'comfortable';
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
}

/**
 * Default period: the current fiscal year to date (applyDefaultPeriod). The
 * real open month arrives from the API; these are only placeholders until then.
 */
const DEFAULT_FROM = 202604;
const DEFAULT_TO = 202608;

export const useFilterStore = create<FilterState>((set) => ({
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  periodReady: false,
  periodChosen: false,
  division: [],
  brand: [],
  zone: [],
  region: [],
  hq: [],
  density: initialDensity(),

  setPeriod: (from, to) => set({ from, to, periodChosen: true, periodReady: true }),

  applyDefaultPeriod: (openYrMn) =>
    set((s) => (s.periodChosen ? { periodReady: true } : { ...defaultPeriod(openYrMn), periodReady: true })),

  setDimension: (key, values) =>
    set((s) => {
      const next = { ...s, [key]: values } as FilterState;
      // Changing a parent invalidates its children, whose option lists it
      // decides (Division → Brand, Division → Zone → Region → HQ). A child
      // left set from another branch silently returns an empty dashboard.
      if (key === 'division') {
        next.brand = [];
        next.zone = [];
        next.region = [];
        next.hq = [];
      }
      if (key === 'zone') {
        next.region = [];
        next.hq = [];
      }
      if (key === 'region') next.hq = [];
      return next;
    }),

  clearAll: () => set({ division: [], brand: [], zone: [], region: [], hq: [] }),

  setDensity: (density) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DENSITY_KEY, density);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.density = density;
    }
    set({ density });
  },
}));

/**
 * The query-relevant slice, so a density change never triggers a refetch.
 *
 * Must go through `useShallow`: the selector builds a new object on every call,
 * and zustand v5 reads it through useSyncExternalStore, which treats a new
 * reference as a new snapshot and re-renders forever. Comparing shallowly ends
 * the loop and also keeps the reference stable enough for the query key.
 */
export const useFilters = (): Filters =>
  useFilterStore(
    useShallow((s) => ({
      from: s.from,
      to: s.to,
      division: s.division,
      brand: s.brand,
      zone: s.zone,
      region: s.region,
      hq: s.hq,
    })),
  );
