import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StockistTable } from '../components/panels/StockistTable';
import { STOCKIST_COLUMNS, type StockistRow, type StockistTablePanel } from '../types/api';

const stockist = (i: number): StockistRow => [
  `Stockist ${i}`, String(10000 + i), i % 2 ? 'WTCHEN' : '94HYD, WTHYDE', i % 2 ? 'CHENNAI' : 'HYDERABAD', 1_000_000 * i, 5, 900_000 * i, -2, 800_000 * i, 1, 100_000,
];

const data = (n: number): StockistTablePanel => ({
  columns: STOCKIST_COLUMNS,
  rows: Array.from({ length: n }, (_, i) => stockist(i + 1)),
  total: ['Total', '', '', '', 1, 2, 3, 4, 5, 6, 7],
  growingCount: n,
  degrowingCount: 0,
});

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1, -1);

describe('the stockist grid', () => {
  it('shows the largest dispatch first, 200 at a time, with the total', () => {
    render(<StockistTable data={data(260)} loading={false} stale={false} />);
    expect(screen.getByText('Showing 200 of 260')).toBeInTheDocument();
    expect(within(bodyRows()[0]!).getByText('Stockist 260')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show more \(60 left\)/ }));
    expect(screen.getByText('Showing 260 of 260')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
  });

  it('searches by name, code or HQ', () => {
    render(<StockistTable data={data(30)} loading={false} stale={false} />);
    fireEvent.change(screen.getByLabelText('Search stockists'), { target: { value: '10012' } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Stockist 12')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search stockists'), { target: { value: 'chennai' } });
    expect(screen.getByText('Showing 15 of 15')).toBeInTheDocument();
  });
});
