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
import { useFilterStore } from '../store/filterStore';
import type {
  EffortFigures,
  MissedDoctorRow,
  MissedDoctorsResponse,
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

/**
 * Answers /meta/filters as the API does: the brand and zone lists follow the
 * chosen division, regions the zone, HQs the region.
 */
function filtersFor(url: string): FiltersResponse {
  const q = new URL(url, 'http://test').searchParams;
  const picked = (key: string, code: string) => q.getAll(key).length === 0 || q.getAll(key).includes(code);
  const tree = [
    { division: '78', brand: 'HAPID', zone: 'JH', zoneName: 'MER2 - HYDERABAD', region: 'JHH', hq: 'M2HYDP' },
    { division: '85', brand: 'WOSULIN', zone: 'DZ', zoneName: 'DIAB - DELHI', region: 'DZ1', hq: 'D1DELH' },
  ];
  const underDivision = tree.filter((t) => picked('division', t.division));
  const underZone = underDivision.filter((t) => picked('zone', t.zone));
  const underRegion = underZone.filter((t) => picked('region', t.region));
  return {
    divisions: [{ code: '78', name: 'MERIND' }, { code: '85', name: 'DIABETES' }],
    brands: underDivision.map((t) => ({ code: t.brand, name: t.brand })),
    zones: underDivision.map((t) => ({ code: t.zone, name: t.zoneName })),
    regions: underZone.map((t) => ({ code: t.region, name: t.region })),
    hqs: underRegion.map((t) => ({ code: t.hq, name: t.hq })),
    months: [
      { yrMn: 202604, label: 'Apr-26', isClosed: true },
      { yrMn: 202608, label: 'Aug-26', isClosed: false },
    ],
  };
}

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
      cnPctFrom: 202604,
      cnPctTo: 202608,
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
      disp: { labels: ['Methycobal Group', 'Hapid'], values: [780_000, 190_000] },
      coll: { labels: ['Methycobal Group', 'Hapid'], values: [700_000, 175_000] },
      sec: { labels: ['Methycobal Group', 'Hapid'], values: [600_000, 150_000] },
      rcpa: { labels: ['Methycobal Group', 'Hapid'], values: [640_000, 160_000] },
    },
    ...overrides,
  };
}

let tabPayload: TabResponse = tab();

/** The missed-doctor list the API answers: 150 doctors, A and B, paged and filtered. */
const MISSED: MissedDoctorRow[] = Array.from({ length: 150 }, (_, i) => ({
  month: 202608,
  zone: 'Chennai',
  region: 'Cochin',
  hq: i < 3 ? 'Kannur' : 'Trichur',
  hqCode: 'WTKANN',
  tmName: i === 0 ? null : 'Arun E A',
  tmCode: i === 0 ? null : '829867',
  doctorCode: `D${i}`,
  doctorName: i === 1 ? 'Jikku Jacob' : `Doctor ${i}`,
  speciality: 'Surgeon',
  category: i % 3 === 0 ? 'A' : 'B',
  rmVisits: 0,
  zsmVisits: 0,
}));
const missedCalls: URL[] = [];
function missedFor(url: string): MissedDoctorsResponse {
  const u = new URL(url, 'http://test');
  missedCalls.push(u);
  const search = (u.searchParams.get('search') ?? '').toLowerCase();
  const cats = u.searchParams.getAll('category');
  const rows = MISSED.filter(
    (r) => (!search || r.doctorName!.toLowerCase().includes(search)) && (!cats.length || cats.includes(r.category!)),
  );
  const all = u.searchParams.get('all') === 'true';
  const page = Number(u.searchParams.get('page') ?? 1);
  const pageSize = all ? 50_000 : Number(u.searchParams.get('pageSize') ?? 100);
  return { total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}
let tabStatus = 200;
/** What the API answers to the correct OTP: a session, or an error. */
let verifyReply: { status: number; body: unknown } = { status: 200, body: session };

const BU_MOBILE = '9100000001';
const BU_PASSWORD = 'Temp#Pass1';
const buSession: LoginResponse = {
  token: 'bu-token',
  user: {
    id: 'acct:6f1c',
    name: 'Neha Rao',
    role: 'bu-head',
    mobile: BU_MOBILE,
    scopeId: 'division-85',
    effectiveScope: { level: 'DIVISION', nodes: ['85'] },
  },
};
/** First sign-in: the API demands a new password before a session. */
let buMustChange = true;
const BU_RESET_CODE = '615204';
/** The API returns the code outside production only. */
let apiReturnsOtp = true;
const DEV_OTP = '482913';

beforeEach(() => {
  tabPayload = tab();
  tabStatus = 200;
  verifyReply = { status: 200, body: session };
  apiReturnsOtp = true;
  buMustChange = true;
  localStorage.clear();
  useFilterStore.getState().clearAll(); // the store outlives each render
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
      if (url === '/api/auth/password') {
        if (body.mobile !== BU_MOBILE) {
          return json({ error: { code: 'NOT_FOUND', message: 'No BU head account is registered for this mobile number.' } }, 404);
        }
        if (body.password !== BU_PASSWORD) {
          return json({ error: { code: 'UNAUTHORIZED', message: 'Incorrect password. 2 attempt(s) left before the account locks.' } }, 401);
        }
        return buMustChange ? json({ mustChangePassword: true, changeToken: 'change-1' }) : json(buSession);
      }
      if (url === '/api/auth/password/change') {
        return body.changeToken === 'change-1' || body.changeToken === 'change-reset'
          ? json(buSession)
          : json({ error: { code: 'UNAUTHORIZED', message: 'This password-change link has expired. Sign in again.' } }, 401);
      }
      if (url === '/api/auth/password/forgot') {
        return json({ sentTo: 'n***@wockhardt.com', expiresInSeconds: 600, resendInSeconds: 30, devOtp: BU_RESET_CODE });
      }
      if (url === '/api/auth/password/forgot/verify') {
        return body.otp === BU_RESET_CODE
          ? json({ changeToken: 'change-reset' })
          : json({ error: { code: 'UNAUTHORIZED', message: 'Incorrect code. 4 attempt(s) left.' } }, 401);
      }
      if (url.includes('/effort/missed-doctors')) return json(missedFor(url));
      if (url.includes('/meta/version')) return json(version);
      if (url.includes('/meta/filters')) return json(filtersFor(url));
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

/** One KPI tile, found by its label. */
const kpi = async (label: string) => screen.findByRole('group', { name: label });

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

    expect(await within(await kpi('Collection (₹ L)')).findByText('175')).toBeInTheDocument();
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
  it('shows a loading indicator until the data arrives', async () => {
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('Loading dashboard…');
    expect(await within(await kpi('Collection (₹ L)')).findByText('175')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('renders the KPI tiles in ₹ lakhs, with the exact rupees on hover', async () => {
    renderApp();
    // 17,500,000 reads "175" under a "(₹ L)" label — not "$17.5M", not "1,75,00,000".
    const coll = await within(await kpi('Collection (₹ L)')).findByText('175');
    expect(coll).toHaveAttribute('title', '₹1,75,00,000.00');
    expect(await within(await kpi('Target (₹ L)')).findByText('200')).toBeInTheDocument();
    expect(await within(await kpi('Dispatch (₹ L)')).findByText('192')).toBeInTheDocument();
    // Below 100 L one decimal is kept: 10,00,000 of secondary is "100", 1,75,000 of PCPM "1.8".
    expect(await within(await kpi('Secondary (₹ L)')).findByText('100')).toBeInTheDocument();
    expect(await within(await kpi('PCPM (Coll) ₹ L')).findByText('1.8')).toBeInTheDocument();
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

  it('marks growth direction and explains a missing prior year', async () => {
    renderApp();
    const growth = within(await kpi('Growth %'));
    expect(await growth.findByText('12.3%')).toBeInTheDocument();
    expect(growth.getByText('▲ vs LY')).toBeInTheDocument();
    expect(
      screen.getByText(/prior-year period has no data in the source/i),
    ).toBeInTheDocument();
  });

  it('renders the Key Brands grid from columnar rows', async () => {
    renderApp();
    const table = await screen.findByRole('table', { name: /key brands/i });
    expect(within(table).getByText('HAPID')).toBeInTheDocument();
    // Values in ₹ lakhs, as the panel header says; exact rupees on hover.
    expect(within(table).getByText('4.0')).toHaveAttribute('title', '₹4,00,000.00');
    // The Total row is the server's totals, not a sum of the listed brands.
    const total = within(table).getByText('Total').closest('tr')!;
    expect(within(total).getByText('200.0')).toBeInTheDocument();
  });

  it('shows the CN and O/S card with percentages', async () => {
    renderApp();
    expect(await screen.findByText('Total CN')).toBeInTheDocument();
    expect(screen.getByText('Exp CN')).toBeInTheDocument();
    expect(screen.getByText('4.3%')).toBeInTheDocument();
    // CN% covers the whole period here, so the card says so plainly.
    expect(screen.getByText('% of gross sales for the selected period.')).toBeInTheDocument();
    expect(screen.queryByText(/CN% covers/)).not.toBeInTheDocument();
  });

  it('shows O/S and inventory as closing balances, naming the month', async () => {
    renderApp();
    const card = await screen.findByRole('table', { name: /credit notes and outstanding/i });
    expect(within(card).getByText('Closing O/S')).toBeInTheDocument();
    expect(screen.getByText('Closing O/S is the outstanding balance in Aug-26.')).toBeInTheDocument();
    expect(screen.getByText('Closing Invntry (₹ L)')).toBeInTheDocument();
  });

  it('says which months CN% covers when the period starts before the sales data', async () => {
    tabPayload = tab({ meta: { ...tab().meta, from: 202601, to: 202608, cnPctFrom: 202604, cnPctTo: 202608 } });
    renderApp();
    expect(await screen.findByText(/^CN% covers Apr-26 – Aug-26 only/)).toBeInTheDocument();
    expect(screen.queryByText('% of gross sales for the selected period.')).not.toBeInTheDocument();
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

  it('draws trendlines on Tgt vs Disp vs Coll, and no longer shows Target vs Ach% & Gr%', async () => {
    renderApp();
    const chart = (await screen.findByText('Tgt vs Disp vs Coll (₹ Lacs)')).closest('section')!;
    expect(within(chart).getByText('Dashed lines: linear trend.')).toBeInTheDocument();
    expect(screen.queryByText('Target vs Ach% & Gr%')).not.toBeInTheDocument();
  });

  it('renders all six tabs from the registry', async () => {
    renderApp();
    const nav = await screen.findByRole('navigation', { name: /dashboard tabs/i });
    for (const label of ['Division', 'Zonal', 'Regional', 'HQ', 'Credit note']) {
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

    expect(await screen.findByText('RCPA Plan vs Actual | Value/Dr.')).toBeInTheDocument();
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
    // In the footer, and under the Effort Dashboard's PCPM box.
    expect(screen.getAllByText(/No TM headcount feed/)).toHaveLength(2);
  });

  it('keeps an empty brand-mix pie in its slot and says why, rather than drawing it empty', async () => {
    tabPayload = tab({
      mix: {
        dimension: 'brandGroup',
        disp: { labels: ['Methycobal Group', 'Hapid'], values: [780_000, 190_000] },
        coll: { labels: ['Methycobal Group', 'Hapid'], values: [null, null] },
        sec: { labels: [], values: [] },
        rcpa: { labels: [], values: [] },
      },
    });
    renderApp();

    expect(await screen.findByText('Dispatch mix by brand')).toBeInTheDocument();
    for (const title of ['Collection mix by brand', 'Secondary mix by brand', 'RCPA mix by brand']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getAllByText('No data for the selected period.')).toHaveLength(3);
  });

  it('shows every brand in the Secondary mix, under its own brand names', async () => {
    const brands = ['WOSULIN CART', 'GLARITUS CART', 'WOSULIN 10ML', 'WOSULIN CP VIAL', 'EMROK O', 'GLIMADAY'];
    tabPayload = tab({
      mix: {
        dimension: 'brand',
        disp: { labels: ['WOSULIN CTG', 'GLARITUS', 'Others'], values: [1_750, 1_283, 900] },
        coll: { labels: ['WOSULIN CTG', 'GLARITUS', 'Others'], values: [null, null, null] },
        sec: { labels: brands, values: [1_766, 904, 686, 324, 247, 142] },
        rcpa: { labels: ['WOSULIN CART', 'GLIMADAY'], values: [1_528, 363] },
      },
    });
    renderApp();

    const frame = (await screen.findByText('Secondary mix by brand')).closest('section')!;
    fireEvent.click(within(frame).getByRole('button', { name: /table/i }));
    const table = within(frame).getByRole('table');
    for (const b of brands) expect(within(table).getByText(b)).toBeInTheDocument();
    expect(within(table).queryByText('Others')).not.toBeInTheDocument();
  });

  it('shows collection by brand in Key Brands, with the server Total and its note', async () => {
    const note = 'Collection by brand is the product-level split of collection, net of GST.';
    tabPayload = tab({
      keyBrands: {
        columns: ['brand', 'tgt', 'disp', 'coll', 'achOnColl', 'grPct', 'sec', 'inventory', 'rcpa'],
        rows: [['WOSULIN CTG', 150_000_000, 143_500_000, 142_000_000, 94.7, null, null, null, null]],
        total: ['Total', 450_000_000, 421_000_000, 399_600_000, 88.8, null, null, null, null],
        note,
      },
    });
    renderApp();

    const table = await screen.findByRole('table', { name: /key brands/i });
    expect(within(table).getByText('Coll')).toBeInTheDocument();
    expect(within(table).getByText('Total').closest('tr')!.textContent).toContain('3,996');
    expect(screen.getByText(note)).toBeInTheDocument();
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

describe('manpower attrition', () => {
  const manpower = {
    left: { tm: 18, rm: 3, zsm: 1 },
    joined: { tm: 24, rm: 2, zsm: 0 },
    leftByTenure: {
      tm: { under6m: 7, m6to12: 5, over1y: 6 },
      rm: { under6m: 0, m6to12: 1, over1y: 2 },
      zsm: { under6m: 0, m6to12: 0, over1y: 1 },
    },
  };

  it('shows leavers, joiners and leavers by tenure, by cadre', async () => {
    tabPayload = tab({
      manpower,
      trends: { ...tab().trends!, leftTm: [10, 8], leftRm: [1, 2], leftZsm: [0, 1] },
    });
    renderApp();

    const left = await screen.findByRole('table', { name: /field force who left in the period/i });
    expect(within(within(left).getByText('TMs Left').closest('tr')!).getByText('18')).toBeInTheDocument();
    expect(within(within(left).getByText('ZSMs Left').closest('tr')!).getByText('1')).toBeInTheDocument();

    const joined = screen.getByRole('table', { name: /new joiners/i });
    expect(within(within(joined).getByText('TMs').closest('tr')!).getByText('24')).toBeInTheDocument();

    // One ageing table per cadre, as in the report.
    const ageing = (cadre: string) =>
      within(screen.getByRole('table', { name: `${cadre} who left, by tenure at exit` }));
    const band = (cadre: string, label: string) =>
      ageing(cadre).getByText(label).closest('tr')!.querySelector('td')!.textContent;
    expect(ageing('TMs').getByText('No. of TMs left with ageing')).toBeInTheDocument();
    expect([band('TMs', '< 6 Months'), band('TMs', '6 months to 1 Year'), band('TMs', '> 1 Year')]).toEqual(['7', '5', '6']);
    expect([band('RMs', '< 6 Months'), band('RMs', '6 months to 1 Year'), band('RMs', '> 1 Year')]).toEqual(['0', '1', '2']);
    expect(band('ZSMs', '> 1 Year')).toBe('1');

    // One value column in each box, as asked: no Attr. % column.
    expect(within(left).queryByText('Attr. %')).not.toBeInTheDocument();
    expect(within(left).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(joined).getAllByRole('columnheader')).toHaveLength(2);
    // The attrition chart is drawn, not the "no source" placeholder.
    expect(screen.getByText('Attrition — TMs / RMs / ZSMs').closest('section')).not.toHaveTextContent('No source');
  });

  it('says why when the view is narrower than a division, in the panel and the chart', async () => {
    const reason = 'The HR exit and hiring views carry a cost centre, not a zone, region or HQ, so attrition and new joiners are shown for whole divisions only.';
    tabPayload = tab({
      manpower: null,
      meta: { ...tab().meta, unavailable: [{ key: 'manpower', label: 'Attrition and new joiners', reason }] },
    });
    renderApp();
    expect(await screen.findAllByText(reason)).toHaveLength(2);
    expect(screen.queryByRole('table', { name: /field force who left/i })).not.toBeInTheDocument();
  });
});

describe('Rx, Rxber, P/D', () => {
  const rx = {
    rxns: { value: 3000, gr: 50 },
    rxber: { value: 550, gr: 10 },
    pdm: { value: 2.727, gr: -12.5 },
    from: 202601,
    to: 202601,
  };

  it('shows No. and Gr% for Rxns, Rxber and P/D/M, and the chart', async () => {
    tabPayload = tab({
      meta: { ...tab().meta, from: 202601, to: 202603 },
      rx,
      trends: { ...tab().trends!, rxns: [3000, null], rxber: [550, null], rxPd: [5.45, null] },
    });
    renderApp();

    const table = await screen.findByRole('table', { name: /prescriptions, prescribers/i });
    const row = (label: string) =>
      within(table).getByText(label).closest('tr')!.querySelectorAll('td');
    expect([...row('Rxns')].map((c) => c.textContent)).toEqual(['3,000', '50.0%']);
    expect([...row('Rxber')].map((c) => c.textContent)).toEqual(['550', '10.0%']);
    expect([...row('P/D/M')].map((c) => c.textContent)).toEqual(['2.7', '-12.5%']);
    // Rx covers Jan only of Jan–Mar: the panel says so.
    expect(screen.getByText(/Rx data covers Jan-26 only of the selected period/)).toBeInTheDocument();
    // The table's panel and the chart both carry the report's title.
    expect(screen.getAllByText('Rx, Rxber, P/D')).toHaveLength(2);
  });

  it('names the months with Rx data when the period has none', async () => {
    const reason = 'The source has Rx (prescription) data for Jan-26 only, so there is none for the selected period.';
    tabPayload = tab({
      rx: { rxns: { value: null, gr: null }, rxber: { value: null, gr: null }, pdm: { value: null, gr: null }, from: null, to: null },
      meta: { ...tab().meta, unavailable: [{ key: 'rx', label: 'Rx, Rxber, P/D', reason }] },
    });
    renderApp();
    // Under the table, and in the chart's place.
    expect(await screen.findAllByText(reason)).toHaveLength(2);
  });
});

describe('effort dashboard', () => {
  const figures = (over: Partial<EffortFigures> = {}): EffortFigures => ({
    drs: 21_071, aPlus: null, a: 3_523, b: 8_695, c: 8_853,
    drsMet: 17_531, coveragePct: 83.2, drsMetRtFrq: null, rtFrqCoveragePct: 68.2,
    callAvg: 9.42, drsMissed: null, missedRtFrq: null, fieldDays: 22.5, ...over,
  });

  const withMissed = () =>
    tab({
      effort: {
        total: figures({ drsMissed: 150 }),
        months: [{ yrMn: 202608, label: 'Aug-26', ...figures({ drsMissed: 150 }) }],
        missedByCategory: { labels: ['A', 'B'], values: [50, 100] },
      },
    });

  it('opens the missed doctors from the right when Drs Missed is clicked', async () => {
    missedCalls.length = 0;
    tabPayload = withMissed();
    renderApp();

    const link = await screen.findByRole('button', { name: /list the 150 missed doctors/i });
    fireEvent.click(link);

    const drawer = await screen.findByRole('dialog', { name: /missed doctors/i });
    expect(await within(drawer).findByText('Jikku Jacob')).toBeInTheDocument();
    expect(within(drawer).getByText('1–100 of 150')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Vacant').length).toBeGreaterThan(0); // the vacant territory's TM
    expect(missedCalls[0]!.searchParams.get('from')).toBe(String(tab().meta.from));

    // Next page.
    fireEvent.click(within(drawer).getByRole('button', { name: /next/i }));
    expect(await within(drawer).findByText('101–150 of 150')).toBeInTheDocument();

    // A category narrows the list, back on page 1.
    fireEvent.click(within(drawer).getByRole('button', { name: 'A' }));
    expect(await within(drawer).findByText('1–50 of 50')).toBeInTheDocument();
    expect(missedCalls.at(-1)!.searchParams.getAll('category')).toEqual(['A']);

    // Esc closes it.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /missed doctors/i })).not.toBeInTheDocument());
  });

  it('searches the missed doctors', async () => {
    tabPayload = withMissed();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /list the 150 missed doctors/i }));
    const drawer = await screen.findByRole('dialog', { name: /missed doctors/i });
    await within(drawer).findByText('Jikku Jacob');

    fireEvent.change(within(drawer).getByRole('searchbox', { name: /search missed doctors/i }), {
      target: { value: 'jikku' },
    });
    expect(await within(drawer).findByText('1–1 of 1')).toBeInTheDocument();
    expect(within(drawer).queryByText('Doctor 2')).not.toBeInTheDocument();
  });

  it('keeps Drs Missed plain text when there are none', async () => {
    tabPayload = tab({
      effort: { total: figures({ drsMissed: null }), months: [], missedByCategory: null },
    });
    renderApp();
    await screen.findByRole('table', { name: /doctor coverage/i });
    expect(screen.queryByRole('button', { name: /missed doctors/i })).not.toBeInTheDocument();
  });

  it('shows the doctor counts, the effort table, the monthly table and PCPM', async () => {
    tabPayload = tab({
      effort: {
        total: figures({ drsMet: 17_603, coveragePct: 83.5, callAvg: 9.39, fieldDays: 22.9 }),
        months: [
          { yrMn: 202608, label: 'Aug-26', ...figures() },
          { yrMn: 202609, label: 'Sep-26', ...figures({ drsMet: 17_675, callAvg: 9.35, fieldDays: 23.3 }) },
        ],
      },
      pcpm: { budgetTm: 176, pcpmCollection: 523_368 },
    });
    renderApp();

    expect(await screen.findByText('Effort Dashboard')).toBeInTheDocument();
    await screen.findByRole('table', { name: /doctors on the list/i });
    const cells = (tableName: RegExp, label: string) =>
      [...within(screen.getByRole('table', { name: tableName })).getByText(label).closest('tr')!.querySelectorAll('td')]
        .map((c) => c.textContent);

    expect(cells(/doctors on the list/i, 'Count of Drs')).toEqual(['21,071', '']);
    expect(cells(/doctors on the list/i, 'A')).toEqual(['3,523', '16.7%']);
    expect(cells(/doctors on the list/i, 'A+')).toEqual(['—', '']);
    expect(cells(/doctor coverage/i, 'Drs Met')).toEqual(['17,603']);
    expect(cells(/doctor coverage/i, 'Covrg%')).toEqual(['83.5%']);
    expect(cells(/doctor coverage/i, 'Drs Missed')).toEqual(['—']);
    expect(cells(/doctor coverage/i, 'Field Days')).toEqual(['22.9']);
    expect(cells(/call average and field days/i, 'Sep-26')).toEqual(['9.3', '23.3']);
    expect(cells(/call average and field days/i, 'Period')).toEqual(['9.4', '22.9']);
    expect(cells(/budgeted tms/i, 'Budget TM')).toEqual(['176 TM']);
    expect(cells(/budgeted tms/i, 'PCPM (Coll)')).toEqual(['5.2 lacs']);
    expect(screen.getByText('Drs Met | Covrg%')).toBeInTheDocument();
    // The effort table's row, and the chart that cannot be drawn.
    expect(screen.getAllByText('Drs Missed')).toHaveLength(2);
  });

  it('says why when the period has no effort data', async () => {
    const reason = 'The effort data covers Aug-26 – Sep-26 only, so there is none for the selected period.';
    tabPayload = tab({
      effort: { total: figures({ drs: null, a: null, b: null, c: null, drsMet: null }), months: [] },
      meta: { ...tab().meta, unavailable: [{ key: 'effort', label: 'Effort', reason }] },
    });
    renderApp();
    // The monthly table and the Drs Met chart say why; the footer lists it.
    expect((await screen.findAllByText(reason)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('credit note tab', () => {
  it('shows the Exp / SR / PD split and the HQ and SKU grids', async () => {
    tabPayload = tab({
      meta: { ...tab().meta, tab: 'credit-note' },
      primary: undefined,
      keyBrands: undefined,
      mix: undefined,
      cnDetail: {
        columns: ['name', 'code', 'expCn', 'srCn', 'pdCn', 'totalCn', 'cnPct'],
        byHq: [['JAMMU', 'WTJAMM', 300_000, 120_000, 30_000, 450_000, 2.5]],
        bySku: [['WOSULIN', '401679', 80_000, 20_000, null, 100_000, 1.2]],
      },
    });
    renderApp('/credit-note');

    const hq = await screen.findByRole('table', { name: 'Credit note by HQ' });
    expect(within(hq).getByText('JAMMU')).toBeInTheDocument();
    expect(within(hq).getByText('HQ')).toBeInTheDocument();
    expect(within(hq).getByText('4.5')).toHaveAttribute('title', '₹4,50,000.00');

    const sku = screen.getByRole('table', { name: 'Credit note by SKU' });
    expect(within(sku).getByText('WOSULIN')).toBeInTheDocument();
    expect(within(sku).getByText('401679')).toBeInTheDocument();
    expect(within(sku).getByText('Product code')).toBeInTheDocument();

    // The CN & O/S card carries the split, not dashes.
    const card = screen.getByRole('table', { name: /credit notes and outstanding/i });
    const exp = within(card).getByText('Exp CN').closest('tr')!;
    expect(within(exp).getByText('0.5')).toBeInTheDocument(); // 51,000
    expect(within(exp).getByText('2.6%')).toBeInTheDocument();
  });

  it('says so when a grid has no credit notes for the period', async () => {
    tabPayload = tab({
      meta: { ...tab().meta, tab: 'credit-note' },
      cnDetail: { columns: ['name', 'code', 'expCn', 'srCn', 'pdCn', 'totalCn', 'cnPct'], byHq: [], bySku: [] },
    });
    renderApp('/credit-note');
    expect(await screen.findAllByText('No credit notes for the selected period.')).toHaveLength(2);
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

describe('filter cascade', () => {
  /** A filter dropdown, once its options have loaded. Its name is "<label> <value>". */
  const dropdown = async (label: string) => {
    const button = await screen.findByRole('button', { name: new RegExp(`^${label} `) });
    await waitFor(() => expect(button).toBeEnabled());
    return button;
  };
  /** The option codes a dropdown offers right now. */
  const offered = async (label: string) => {
    fireEvent.click(await dropdown(label));
    const list = await screen.findByRole('listbox', { name: label });
    const names = within(list).getAllByRole('option').map((o) => o.textContent);
    fireEvent.keyDown(document, { key: 'Escape' });
    return names;
  };
  const choose = async (label: string, option: RegExp) => {
    fireEvent.click(await dropdown(label));
    const list = await screen.findByRole('listbox', { name: label });
    fireEvent.click(within(list).getByRole('option', { name: option }));
    fireEvent.keyDown(document, { key: 'Escape' });
  };
  const filterUrls = () =>
    vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/meta/filters'));

  it('lists only the chosen division’s brands and zones', async () => {
    renderApp();
    expect(await offered('Brand')).toEqual(['HAPID', 'WOSULIN']);

    await choose('Division', /DIABETES/);

    expect(await offered('Brand')).toEqual(['WOSULIN']);
    expect(await offered('Zone')).toEqual(['DIAB - DELHIDZ']);
    expect(filterUrls().at(-1)).toContain('division=85');
  });

  it('narrows regions by zone and HQs by region', async () => {
    renderApp();
    await choose('Zone', /HYDERABAD/);
    expect(await offered('Region')).toEqual(['JHH']);

    await choose('Region', /JHH/);
    expect(await offered('HQ')).toEqual(['M2HYDP']);
    expect(filterUrls().at(-1)).toMatch(/zone=JH.*region=JHH/);
  });

  it('clears the brand, zone, region and HQ chosen under another division', async () => {
    renderApp();
    await choose('Brand', /HAPID/);
    await choose('Zone', /HYDERABAD/);
    await choose('Region', /JHH/);
    expect(await dropdown('Zone')).toHaveAccessibleName('Zone MER2 - HYDERABAD');

    await choose('Division', /DIABETES/);

    for (const label of ['Brand', 'Zone', 'Region', 'HQ']) {
      expect(await dropdown(label)).toHaveAccessibleName(`${label} All`);
    }
    expect(useFilterStore.getState()).toMatchObject({ division: ['85'], brand: [], zone: [], region: [], hq: [] });
  });
});

describe('BU head sign-in', () => {
  const signOut = () => useAuthStore.setState({ token: null, user: null });
  const typeInto = (label: RegExp | string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  async function signInWith(password: string) {
    fireEvent.change(await screen.findByLabelText(/mobile number/i), { target: { value: BU_MOBILE } });
    typeInto(/^password$/i, password);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('is reached from the field-force sign-in page', async () => {
    signOut();
    renderApp('/login');
    fireEvent.click(await screen.findByRole('link', { name: /sign in with your password/i }));
    expect(await screen.findByRole('heading', { name: 'BU head sign in' })).toBeInTheDocument();
  });

  it('makes a first-time BU head set a password, then opens their division', async () => {
    signOut();
    renderApp('/login/bu-head');
    await signInWith(BU_PASSWORD);

    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    // Guided by the rule list, and checked before it is sent.
    typeInto(/^new password$/i, 'short');
    typeInto(/confirm new password/i, 'short');
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);

    typeInto(/^new password$/i, 'Mine@2026x');
    typeInto(/confirm new password/i, 'Mine@2026y');
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);

    typeInto(/confirm new password/i, 'Mine@2026x');
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText(/BU Head · Division 85/)).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('bu-token');
  });

  it('opens the dashboard straight away once the password is set', async () => {
    buMustChange = false;
    signOut();
    renderApp('/login/bu-head');
    await signInWith(BU_PASSWORD);
    expect(await screen.findByText(/BU Head · Division 85/)).toBeInTheDocument();
  });

  it('shows the API message for a wrong password', async () => {
    signOut();
    renderApp('/login/bu-head');
    await signInWith('Wrong#pass1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password. 2 attempt(s) left before the account locks.');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('resets a forgotten password with a code', async () => {
    signOut();
    renderApp('/login/bu-head');
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(await screen.findByLabelText(/mobile number/i), { target: { value: BU_MOBILE } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText(/sent a 6-digit code to n\*\*\*@wockhardt.com/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Testing mode — your code is ${BU_RESET_CODE}`);
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    typeInto(/^new password$/i, 'Fresh#2026');
    typeInto(/confirm new password/i, 'Fresh#2026');
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText(/BU Head · Division 85/)).toBeInTheDocument();
  });
});
