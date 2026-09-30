/**
 * Render smoke tests against a stubbed API.
 *
 * These assert the things that would be embarrassing to ship broken: the KPI
 * band shows the right numbers, nulls render as an em dash rather than 0, the
 * gap ribbon reports achievement accessibly, and the empty and error states
 * appear instead of a blank screen.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { useAuthStore } from '../auth/authStore';
import type {
  TabResponse,
  VersionResponse,
  FiltersResponse,
  LoginResponse,
} from '../types/api';

const session: LoginResponse = {
  token: 'test-token',
  user: {
    id: 'dev-tm-01',
    name: 'Amit Verma',
    role: 'tm',
    mobile: '9000000002',
    scopeId: 'hq-1234abcd',
    effectiveScope: { level: 'HQ', nodes: ['M2HYDP'] },
  },
};

const version: VersionResponse = {
  dataVersion: 'test-1',
  openYrMn: 202608,
  updatedAt: '2026-08-11T00:00:00Z',
};

const filters: FiltersResponse = {
  divisions: [{ code: '78', name: 'MERIND' }],
  zones: [{ code: 'JH', name: 'MER2 - HYDERABAD' }],
  regions: [{ code: 'JHH', name: 'MER2 - HYDERABAD' }],
  hqs: [{ code: 'M2HYDP', name: 'MER HYDERABAD POOL' }],
  brands: [{ code: 'HAPID', name: 'HAPID' }],
  months: [
    { yrMn: 202604, label: 'Apr-26', isClosed: true },
    { yrMn: 202608, label: 'Aug-26', isClosed: false },
  ],
};

function tab(overrides: Partial<TabResponse> = {}): TabResponse {
  return {
    meta: {
      tab: 'division-performance',
      dataVersion: 'test-1',
      from: 202604,
      to: 202608,
      monthCount: 5,
      effectiveScope: { level: 'ALL', nodes: [] },
      unassignedRows: 0,
      cached: false,
      queryMs: 12,
      priorFrom: null,
      priorTo: null,
      unavailable: [],
    },
    primary: {
      target: { value: 20_000_000, ach: null, gr: null },
      collection: { value: 17_500_000, ach: 87.5, gr: 12.3 },
      dispatch: { value: 19_200_000, ach: 96, gr: null },
    },
    pcpm: { budgetTm: 20, pcpmCollection: 175_000 },
    secondary: { value: 10_000_000, grPct: 10 },
    rcpa: { plan: 1200, actual: 1080, achPct: 90, grPct: 4.2 },
    inventory: { value: 1_000_000 },
    keyBrands: {
      columns: ['brand', 'tgt', 'disp', 'coll', 'achOnColl', 'grPct', 'sec', 'inventory', 'rcpa'],
      rows: [['HAPID', 400_000, 380_000, 350_000, 87.5, 9.1, 210_000, 190_000, 240]],
    },
    creditNote: {
      totalCn: 82_000, expCn: 51_000, srCn: 19_000, pdCn: 12_000, totalOs: 640_000,
      cnPct: 4.3, expCnPct: 2.6, srCnPct: 1.0, pdCnPct: 0.6, osPct: 33.3,
    },
    trends: {
      months: [202604, 202605],
      labels: ['Apr-26', 'May-26'],
      disp: [420_000, 480_000],
      sec: [300_000, 340_000],
      rcpa: [410_000, 470_000],
      pcpm: [9.4, 9.9],
      tgt: [440_000, 480_000],
      coll: [400_000, 450_000],
      rcpaPlan: [1200, 1250],
      rcpaActual: [1080, 1190],
      valuePerDr: [4.8, 5.1],
      cnExp: [40_000, 44_000],
      cnSr: [15_000, 17_000],
      cnPd: [9_000, 10_000],
      cnPct: [4.1, 4.3],
    },
    mix: {
      dimension: 'brandGroup',
      labels: ['Methycobal Group', 'Hapid'],
      disp: [780_000, 190_000],
      coll: [700_000, 175_000],
      sec: [600_000, 150_000],
      rcpa: [640_000, 160_000],
    },
    ...overrides,
  };
}

let tabPayload: TabResponse = tab();
let tabStatus = 200;
/** What the API answers to the correct OTP: a session, or an error. */
let verifyReply: { status: number; body: unknown } = { status: 200, body: session };
/** The API returns the code outside production only. */
let apiReturnsOtp = true;
const DEV_OTP = '482913';

beforeEach(() => {
  tabPayload = tab();
  tabStatus = 200;
  verifyReply = { status: 200, body: session };
  apiReturnsOtp = true;
  localStorage.clear();
  useAuthStore.setState({ token: session.token, user: session.user });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/auth/otp/request') {
        return body.mobile === '9000000002'
          ? json({ expiresInSeconds: 600, resendInSeconds: 30, ...(apiReturnsOtp ? { devOtp: DEV_OTP } : {}) })
          : json({ error: { code: 'NOT_FOUND', message: 'This mobile number is not registered for the dashboard.' } }, 404);
      }
      if (url === '/api/auth/otp/verify') {
        return body.otp === DEV_OTP
          ? json(verifyReply.body, verifyReply.status)
          : json({ error: { code: 'UNAUTHORIZED', message: 'Incorrect OTP. 4 attempt(s) left.' } }, 401);
      }
      if (url.includes('/meta/version')) return json(version);
      if (url.includes('/meta/filters')) return json(filters);
      if (url.includes('/dashboard/')) {
        if (tabStatus !== 200) {
          return json({ error: { code: 'BAD_REQUEST', message: 'Period is 77 months.' } }, tabStatus);
        }
        return json(tabPayload);
      }
      return json({}, 404);
    }),
  );
});

function renderApp(path = '/division') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('sign-in', () => {
  const signOut = () => useAuthStore.setState({ token: null, user: null });

  function typeOtp(code: string) {
    code.split('').forEach((d, i) => {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), { target: { value: d } });
    });
  }

  async function requestCode(mobile = '9000000002') {
    fireEvent.change(await screen.findByLabelText(/mobile number/i), {
      target: { value: mobile },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    await screen.findByLabelText('Digit 1 of 6');
  }

  it('shows the login page instead of the dashboard when signed out', async () => {
    signOut();
    renderApp('/division');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /dashboard tabs/i })).not.toBeInTheDocument();
  });

  it('rejects a malformed mobile number before calling the API', async () => {
    signOut();
    renderApp('/login');
    fireEvent.change(await screen.findByLabelText(/mobile number/i), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid 10-digit mobile/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs in with mobile + OTP and opens the dashboard with the user shown', async () => {
    signOut();
    renderApp('/division');
    await requestCode();
    typeOtp(DEV_OTP);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText('1.75 Cr')).toBeInTheDocument();
    expect(screen.getByText('Amit Verma')).toBeInTheDocument();
    expect(screen.getByText(/Territory Manager · HQ M2HYDP/)).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe(session.token);
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.slice(0, 2)).toEqual(['/api/auth/otp/request', '/api/auth/otp/verify']);
  });

  it('shows the OTP on the login screen whenever the API returns it, and fills it on request', async () => {
    signOut();
    renderApp('/login');
    await requestCode();
    expect(screen.getByRole('status')).toHaveTextContent(`Testing mode — your OTP is ${DEV_OTP}`);
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue(DEV_OTP[5]);
  });

  it('shows no OTP when the API does not return one, as in production', async () => {
    apiReturnsOtp = false;
    signOut();
    renderApp('/login');
    await requestCode();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so when the mobile is not registered', async () => {
    signOut();
    renderApp('/login');
    fireEvent.change(await screen.findByLabelText(/mobile number/i), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not registered for the dashboard/i);
  });

  it('shows the API message for a wrong OTP and stays on the login page', async () => {
    signOut();
    renderApp('/login');
    await requestCode();
    typeOtp('000000');
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect OTP. 4 attempt(s) left.');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('offers a new code straight away once too many wrong guesses burn this one', async () => {
    verifyReply = {
      status: 429,
      body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many incorrect attempts. Request a new OTP.' } },
    };
    signOut();
    renderApp('/login');
    await requestCode();
    typeOtp(DEV_OTP);
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/request a new OTP/i);
    expect(screen.getByRole('button', { name: 'Resend OTP' })).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('fills every box when a whole code is pasted', async () => {
    signOut();
    renderApp('/login');
    await requestCode();
    fireEvent.paste(screen.getByLabelText('Digit 1 of 6'), {
      clipboardData: { getData: () => DEV_OTP },
    });
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue(DEV_OTP[5]);
  });

  it('returns to sign-in when the API rejects the session', async () => {
    tabStatus = 401;
    renderApp('/division');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('signs out from the header', async () => {
    renderApp('/division');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('Division performance tab', () => {
  it('renders the KPI band with Indian-abbreviated money', async () => {
    renderApp();
    // 17,500,000 must read as "1.75 Cr", not "$17.5M" and not "1,75,00,000".
    expect(await screen.findByText('1.75 Cr')).toBeInTheDocument();
    expect(screen.getByText('2.00 Cr')).toBeInTheDocument();
    expect(screen.getByText('1.92 Cr')).toBeInTheDocument();
  });

  it('exposes achievement on the gap ribbon accessibly', async () => {
    renderApp();
    const meter = await screen.findByRole('meter', { name: /collection achievement/i });
    expect(meter).toHaveAttribute('aria-valuenow', '87.5');
    expect(meter).toHaveAttribute('aria-valuetext', '87.5%');
  });

  it('renders a null metric as an em dash, never as 0', async () => {
    tabPayload = tab({
      primary: {
        target: { value: null, ach: null, gr: null },
        collection: { value: null, ach: null, gr: null },
        dispatch: { value: null, ach: null, gr: null },
      },
    });
    renderApp();
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('signs growth and explains a missing prior year', async () => {
    renderApp();
    expect(await screen.findByText('+12.3%')).toBeInTheDocument();
    expect(
      screen.getByText(/prior-year period has no data in the source/i),
    ).toBeInTheDocument();
  });

  it('renders the Key Brands grid from columnar rows', async () => {
    renderApp();
    const table = await screen.findByRole('table', { name: /key brands/i });
    expect(within(table).getByText('HAPID')).toBeInTheDocument();
    expect(within(table).getByText('4.00 L')).toBeInTheDocument();
  });

  it('shows the CN and O/S card with percentages', async () => {
    renderApp();
    expect(await screen.findByText('Total CN')).toBeInTheDocument();
    expect(screen.getByText('Exp CN')).toBeInTheDocument();
    expect(screen.getByText('4.3%')).toBeInTheDocument();
  });

  it('surfaces the query timing footer', async () => {
    renderApp();
    expect(await screen.findByText('12 ms')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('shows the API error message rather than a blank page', async () => {
    tabStatus = 400;
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Period is 77 months.');
  });

  it('renders all six tabs from the registry', async () => {
    renderApp();
    const nav = await screen.findByRole('navigation', { name: /dashboard tabs/i });
    for (const label of ['Division', 'Brand', 'Zonal', 'Regional', 'HQ', 'Credit note']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('panels with no source in the warehouse', () => {
  it('explains a missing chart instead of dropping it from the grid', async () => {
    // Live data omits rcpaPlan/cnExp entirely — those feeds do not exist.
    tabPayload = tab({
      meta: {
        ...tab().meta,
        unavailable: [
          { key: 'rcpa', label: 'RCPA value', reason: 'No RCPA feed in this view.' },
          { key: 'creditNote.split', label: 'CN split', reason: 'No credit-note split feed.' },
        ],
      },
      trends: {
        months: [202604, 202605],
        labels: ['Apr-26', 'May-26'],
        disp: [420_000, 480_000],
        tgt: [440_000, 480_000],
        coll: [400_000, 450_000],
      },
    });
    renderApp();

    expect(await screen.findByText('RCPA plan vs. actual')).toBeInTheDocument();
    expect(screen.getByText('No RCPA feed in this view.')).toBeInTheDocument();
    expect(screen.getAllByText('No source').length).toBeGreaterThan(0);
  });

  it('lists everything unavailable in the footer with a reason', async () => {
    tabPayload = tab({
      meta: {
        ...tab().meta,
        unavailable: [
          { key: 'pcpm', label: 'PCPM', reason: 'No TM headcount feed.' },
          { key: 'secondary', label: 'Secondary', reason: 'No chemist-level sales feed.' },
        ],
      },
    });
    renderApp();

    expect(await screen.findByText(/2 panels have no source/i)).toBeInTheDocument();
    expect(screen.getByText(/No TM headcount feed/)).toBeInTheDocument();
  });

  it('drops mix donuts that have no values rather than drawing empty ones', async () => {
    tabPayload = tab({
      mix: {
        dimension: 'brandGroup',
        labels: ['Methycobal Group', 'Hapid'],
        disp: [780_000, 190_000],
        coll: [null, null],
        sec: [null, null],
        rcpa: [null, null],
      },
    });
    renderApp();

    expect(await screen.findByText(/Mix by brand group/i)).toBeInTheDocument();
    expect(screen.getByText(/Coll, Sec, RCPA not shown/i)).toBeInTheDocument();
  });

  it('hides table columns that are null in every row', async () => {
    tabPayload = tab({
      keyBrands: {
        columns: ['brand', 'tgt', 'disp', 'coll', 'achOnColl', 'grPct', 'sec', 'inventory', 'rcpa'],
        rows: [['HAPID', 400_000, 380_000, null, null, null, null, 190_000, null]],
      },
    });
    renderApp();

    const table = await screen.findByRole('table', { name: /key brands/i });
    expect(within(table).getByText('Disp')).toBeInTheDocument();
    // Coll / Sec / RCPA have no values at all, so they are not rendered.
    expect(within(table).queryByText('Coll')).not.toBeInTheDocument();
    expect(within(table).queryByText('RCPA')).not.toBeInTheDocument();
  });
});

describe('geo tab', () => {
  it('renders the geo grid with its header chips and a server Total row', async () => {
    tabPayload = tab({
      meta: { ...tab().meta, tab: 'zone-performance' },
      keyBrands: undefined,
      geoTable: {
        grain: 'zone',
        columns: [
          'name', 'tgt', 'disp', 'dispGrPct', 'coll', 'achOnColl', 'collGrPct', 'pcpmColl',
          'creditNote', 'cnPct', 'sec', 'inventoryValue', 'rcpa', 'rcpaPctToSec',
        ],
        codes: ['JH'],
        rows: [['MER2 - HYDERABAD', 1_000_000, 900_000, 5.1, 850_000, 85, 3.2, 42_500, 40_000, 4.4, 700_000, 300_000, 650_000, 92.9]],
        total: ['Total', 1_000_000, 900_000, 5.1, 850_000, 85, 3.2, 42_500, 40_000, 4.4, 700_000, 300_000, 650_000, 92.9],
        onTargetCount: 3,
        growingCount: 7,
        degrowingCount: 2,
      },
    });
    renderApp('/zone');

    expect(await screen.findByText(/Zones on tgt/i)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /zone performance/i });
    expect(within(table).getByText('Total')).toBeInTheDocument();
  });
});
