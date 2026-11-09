/**
 * The global filter panel — the report's light-blue "FILTERS ▾" block. Sticky,
 * and collapsible so a manager reading the grids can reclaim the space; when
 * collapsed it still says how many filters are on. (§9.3)
 * Applies to every tab — filter state is shared across the whole app.
 */
import { useState } from 'react';
import { useFilterStore } from '../../store/filterStore';
import { useFilterOptions } from '../../queries/useFilterOptions';
import { MultiSelect } from './MultiSelect';
import { MonthRangePicker } from './MonthRangePicker';

export function FilterBar() {
  const {
    from, to, division, brand, zone, region, hq,
    setPeriod, setDimension, clearAll, density, setDensity,
  } = useFilterStore();
  const [open, setOpen] = useState(true);

  const { data: options, isLoading, pending } = useFilterOptions({ division, zone, region });

  const active = [division, brand, zone, region, hq].filter((d) => d.length > 0).length;

  return (
    <div className="xl-filters sticky top-0 z-30 px-5 py-2 shadow-[0_1px_2px_rgba(31,56,100,0.08)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="filter-fields"
          className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--xl-navy)]"
        >
          Filters
          <span aria-hidden="true" className={`text-[11px] transition-transform ${open ? '' : '-rotate-90'}`}>
            ▾
          </span>
        </button>
        {!open && active > 0 && (
          <span className="text-[11px] font-semibold text-[var(--xl-label)]">{active} active</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {active > 0 && (
            <button type="button" onClick={clearAll} className="xl-btn">
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            aria-pressed={density === 'compact'}
            title="Toggle row density"
            className="xl-btn"
          >
            {density === 'compact' ? 'Comfortable' : 'Compact'}
          </button>
        </div>
      </div>

      <div id="filter-fields" hidden={!open} className="mt-2 flex flex-wrap items-end gap-3 pb-1">
        <div className="w-[140px]">
          <MultiSelect
            label="Division"
            options={options?.divisions ?? []}
            selected={division}
            onChange={(v) => setDimension('division', v)}
            loading={isLoading}
          />
        </div>
        <div className="w-[140px]">
          <MultiSelect
            label="Brand"
            options={options?.brands ?? []}
            selected={brand}
            onChange={(v) => setDimension('brand', v)}
            loading={isLoading || pending.brand}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="Zone"
            options={options?.zones ?? []}
            selected={zone}
            onChange={(v) => setDimension('zone', v)}
            loading={isLoading || pending.zone}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="Region"
            options={options?.regions ?? []}
            selected={region}
            onChange={(v) => setDimension('region', v)}
            loading={isLoading || pending.region}
            allLabel={zone.length ? 'All in zone' : 'All'}
          />
        </div>
        <div className="w-[150px]">
          <MultiSelect
            label="HQ"
            options={options?.hqs ?? []}
            selected={hq}
            onChange={(v) => setDimension('hq', v)}
            loading={isLoading || pending.hq}
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

      </div>
    </div>
  );
}
