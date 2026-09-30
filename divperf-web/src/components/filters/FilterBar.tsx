/**
 * The global filter bar. Sticky, 56px, hairline bottom rule. (§9.3)
 * Applies to every tab — filter state is shared across the whole app.
 */
import { useFilterStore } from '../../store/filterStore';
import { useFilterOptions } from '../../queries/useFilterOptions';
import { MultiSelect } from './MultiSelect';
import { MonthRangePicker } from './MonthRangePicker';

export function FilterBar() {
  const {
    from, to, division, brand, zone, region, hq,
    setPeriod, setDimension, clearAll, density, setDensity,
  } = useFilterStore();

  const { data: options, isLoading } = useFilterOptions({ division, zone, region });

  const anyFilter = division.length + brand.length + zone.length + region.length + hq.length > 0;

  return (
    <div className="sticky top-0 z-30 border-b border-rule bg-surface">
      <div className="mx-auto flex flex-wrap items-end gap-3 px-5 py-2">
        <div className="w-[136px]">
          <MultiSelect
            label="Division"
            options={options?.divisions ?? []}
            selected={division}
            onChange={(v) => setDimension('division', v)}
            loading={isLoading}
          />
        </div>
        <div className="w-[136px]">
          <MultiSelect
            label="Brand"
            options={options?.brands ?? []}
            selected={brand}
            onChange={(v) => setDimension('brand', v)}
            loading={isLoading}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="Zone"
            options={options?.zones ?? []}
            selected={zone}
            onChange={(v) => setDimension('zone', v)}
            loading={isLoading}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="Region"
            options={options?.regions ?? []}
            selected={region}
            onChange={(v) => setDimension('region', v)}
            loading={isLoading}
            allLabel={zone.length ? 'All in zone' : 'All'}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="HQ"
            options={options?.hqs ?? []}
            selected={hq}
            onChange={(v) => setDimension('hq', v)}
            loading={isLoading}
            allLabel={region.length || zone.length ? 'All in region' : 'All'}
          />
        </div>

        <MonthRangePicker
          months={options?.months ?? []}
          from={from}
          to={to}
          onChange={setPeriod}
          loading={isLoading}
        />

        <div className="ml-auto flex items-end gap-2">
          {anyFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="h-7 rounded border border-rule px-2 text-[12px] text-ink-2 hover:bg-paper"
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            aria-pressed={density === 'compact'}
            title="Toggle row density"
            className="h-7 rounded border border-rule px-2 text-[12px] text-ink-2 hover:bg-paper"
          >
            {density === 'compact' ? 'Comfortable' : 'Compact'}
          </button>
        </div>
      </div>
    </div>
  );
}
