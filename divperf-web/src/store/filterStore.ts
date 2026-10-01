/**
 * Filter state only. (§8.1)
 *
 * Server data lives in TanStack Query; this store holds nothing that came from
 * the API. Keeping the two separate is what makes the query keys reliable.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Filters } from '../queries/keys';

export type Density = 'comfortable' | 'compact';

interface FilterState extends Filters {
  density: Density;
  setPeriod: (from: number, to: number) => void;
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
 * Default period: the current fiscal year to date. The real open month arrives
 * from the API; these are only the values used before it does.
 */
const DEFAULT_FROM = 202604;
const DEFAULT_TO = 202608;

export const useFilterStore = create<FilterState>((set) => ({
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  division: [],
  brand: [],
  zone: [],
  region: [],
  hq: [],
  density: initialDensity(),

  setPeriod: (from, to) => set({ from, to }),

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
