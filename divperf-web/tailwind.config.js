/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Every colour resolves to a CSS variable defined in index.css, so the
      // design tokens have exactly one definition. (§9.1)
      colors: {
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        rule: 'var(--rule)',
        'rule-soft': 'var(--rule-soft)',
        track: 'var(--track)',
        notch: 'var(--notch)',
        good: 'var(--good)',
        'good-soft': 'var(--good-soft)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        'bad-soft': 'var(--bad-soft)',
        'series-disp': 'var(--series-disp)',
        'series-sec': 'var(--series-sec)',
        'series-coll': 'var(--series-coll)',
        'series-rcpa': 'var(--series-rcpa)',
        'series-cn-pd': 'var(--series-cn-pd)',
        'series-muted': 'var(--series-muted)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        kpi: ['28px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'kpi-label': ['11px', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '500' }],
        panel: ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        table: ['13px', { lineHeight: '1.4' }],
        tick: ['11px', { lineHeight: '1.2' }],
      },
      borderRadius: { card: '12px' },
    },
  },
  plugins: [],
};
