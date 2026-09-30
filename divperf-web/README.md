# divperf-web

React + TypeScript + Vite frontend for the Division Performance dashboard.
Read `../ARCHITECTURE.md` first — it is the source of truth for both repos.

## Run

Start the API first (`cd ../divperf-api && npm run dev`), then:

```bash
npm install
npm run dev        # http://localhost:5174
```

Port 5174, not 5173 — 5173 is taken by another Vite project on the current dev
machine. `/api` is proxied to `127.0.0.1:8787`, so the browser stays same-origin
in dev and the latency-critical tab request pays no CORS preflight.

```bash
npm test          # render tests
npm run typecheck
npm run build
```

Every page requires sign-in at `/login`: mobile number, then the OTP sent by
SMS and email. Outside production the API also returns the code, and the login
screen shows it, for testing. Users live in the API's own database; see
`../divperf-api/README.md`.

## Layout

```
src/
  App.tsx              router + providers
  types/api.ts         mirrors divperf-api/src/types/api.ts — keep identical
  tabs/
    registry.ts        tab config: id, path, label, grain, panels
    TabPage.tsx        THE tab engine — all six tabs render through this
  queries/             keys (canonicalised), policy (tiered freshness), hooks
  store/filterStore.ts zustand: filter state only, no server data
  components/
    filters/           FilterBar, MultiSelect, MonthRangePicker
    panels/            KpiBand, GapRibbon, DataTable, KeyBrands, GeoTable, CN
    charts/            TrendCombo, MixDonut, ChartFrame, theme, echartsCore
    ui/                Card, Stat, States, DashboardFooter
  lib/                 api (typed fetch), format (lakh/crore), yrmn, csv
```

## Rules that are easy to break

- **One query per tab (I2).** `useDashTab` is called once in `TabPage`. Do not
  add `usePrimaryPanel()`, `usePcpmPanel()`, … — that is the natural React
  instinct and it puts you back at 14 round trips.
- **No page component per tab (§8.5).** Add a registry entry, not a page.
- **`scopeId` is in every query key.** Without it, switching users in one
  browser session serves the previous user's numbers from the client cache.
- **Closed months never refetch (I7).** `queries/policy.ts` gives a closed range
  a one-day `staleTime`. `openYrMn` comes from the server, never the browser
  clock.
- **Null renders as `—`, never `0`.** `lib/format.ts` is the only place that
  decides this.

## Charts

ECharts is registered piecemeal in `charts/echartsCore.ts` (bar, line, pie,
canvas renderer only) — importing `echarts` wholesale costs 350 kB gzipped
instead of 196 kB. **If a new chart type renders blank, a missing registration
there is the first thing to check.**

Every chart ships a legend, 2px gaps between marks, and a Table toggle. Those
are not decoration: the series palette is inherited from the Excel report for
recognition, and it needs secondary encoding to be readable — the coll/sec pair
separates by only ΔE 7.4 under protanopia, and two series sit just under 3:1
contrast against the page. Do not remove them.

`--series-cn-pd` (violet) is the one colour *not* from the Excel: the obvious
choice collided with `--series-sec` at ΔE 2.8 under protanopia, which is
indistinguishable.
