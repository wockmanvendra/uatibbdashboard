/**
 * Environment parsing and validation. Fails fast at startup.
 *
 * Per §7.7 this is the ONLY place `process.env` is read. Everything else
 * imports `config`. If you find `process.env` elsewhere in src/, it is a bug.
 */
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true'));

/** "a:b;c:d" into { a: b, c: d }: each key a code, each value matching `value`. */
const pairs = (name: string, value: RegExp) =>
  z.string().transform((raw, ctx) => {
    const map: Record<string, string> = {};
    for (const part of raw.split(';').map((p) => p.trim()).filter(Boolean)) {
      const [k, v] = part.split(':').map((p) => p.trim());
      if (!k || !v || !/^[A-Za-z0-9]+$/.test(k) || !value.test(v)) {
        ctx.addIssue({ code: 'custom', message: `${name}: bad entry "${part}"` });
        return z.NEVER;
      }
      map[k] = v;
    }
    return map;
  });

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    /**
     * Address to listen on. 0.0.0.0 reaches the network; 127.0.0.1 keeps the
     * API on this machine, behind the web app's /api proxy.
     */
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGIN: z.string().default('http://localhost:5174,http://localhost:5173'),

    /**
     * Which database the API reads.
     *
     *   synapse-direct  query the warehouse directly. This is the chosen
     *                   architecture (user, 2026-08-12): no intermediate
     *                   database of any kind. It sets aside invariant I9, and
     *                   the latency cost is documented in ARCHITECTURE.md
     *                   §4.10a. The response cache is what makes it workable.
     *   serving-db      retained for the day a serving database exists; the
     *                   panel SQL switches over in sqlFragments.ts.
     */
    DATA_SOURCE: z.enum(['serving-db', 'synapse-direct']).default('synapse-direct'),

    SQL_SERVER: z.string().optional(),
    SQL_DATABASE: z.string().optional(),
    SQL_USER: z.string().optional(),
    SQL_PASSWORD: z.string().optional(),
    SQL_ENCRYPT: bool(true),
    SQL_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /**
     * The table every dashboard figure is read from, as schema.table — all but
     * credit notes. Interpolated into SQL, so it must be a plain two-part
     * identifier.
     */
    DASHBOARD_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'DASHBOARD_TABLE must look like schema.table')
      .default('Infinity.Infinity_Reports'),

    /**
     * Credit notes, split Exp / SR / PD, by division, territory, product and
     * month. Interpolated into SQL like DASHBOARD_TABLE.
     */
    CN_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'CN_TABLE must look like schema.table')
      .default('Infinity.VW_Credit_Note_Details'),

    /** SAP HR leavers and joiners, one row per person. Interpolated like DASHBOARD_TABLE. */
    HR_EXIT_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'HR_EXIT_TABLE must look like schema.table')
      .default('Infinity.VW_Exit_Details'),
    HR_HIRING_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'HR_HIRING_TABLE must look like schema.table')
      .default('Infinity.VW_Hiring_Details'),

    /**
     * Which HR cost centres (KOSTL) make up each division, as
     * "division:costCentre,costCentre;division:…". The HR views carry no
     * division code, only the cost centre. The default holds the pairs
     * confirmed against Infinity's field structure; a division without an
     * entry shows attrition as unavailable rather than as zero.
     */
    HR_DIVISION_COST_CENTRES: z
      .string()
      .default('85:1000EM68;A5:1000EM75')
      .transform((raw, ctx) => {
        const map: Record<string, string[]> = {};
        for (const part of raw.split(';').map((p) => p.trim()).filter(Boolean)) {
          const [division, centres] = part.split(':').map((p) => p.trim());
          const list = (centres ?? '').split(',').map((c) => c.trim()).filter(Boolean);
          if (!division || list.length === 0 || !list.every((c) => /^[A-Za-z0-9]+$/.test(c))) {
            ctx.addIssue({ code: 'custom', message: `HR_DIVISION_COST_CENTRES: bad entry "${part}"` });
            return z.NEVER;
          }
          map[division] = list;
        }
        return map;
      }),

    /**
     * Doctor coverage and call effort, one row per location and month (all
     * nvarchar). Interpolated like DASHBOARD_TABLE.
     */
    EFFORT_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'EFFORT_TABLE must look like schema.table')
      .default('dbo.infinity_effort_data'),

    /**
     * The effort data's division names, by division code, as
     * "code:NAME;code:NAME". The effort data names a division but carries no
     * code. A name listed for more than one code
     * is split by its territories' codes; a division without an entry shows
     * effort as unavailable rather than as zero.
     */
    EFFORT_DIVISIONS: pairs('EFFORT_DIVISIONS', /\S/)
      .default('85:BIOSCIENCES;A5:RESPIRATORY;78:BIOPHARMA;A7:SPECIALITY;A8:AESTHETICS;83:PHARMA;02:RESEARCH'),

    /**
     * Division codes that are another division's code, as "alias:code;…".
     * RESEARCH is 02 in the sales data but 84 in the visits, hospitals, people
     * and user service (and both in the credit notes): every source's 84 is
     * read as 02, so the division is one everywhere — filters, scope, totals.
     */
    DIVISION_ALIASES: pairs('DIVISION_ALIASES', /^[A-Za-z0-9]+$/).default('84:02'),
    /**
     * Division display names that override the sales data's Div_Name, as
     * "code:NAME;…" (letters, digits, spaces, & . -).
     */
    DIVISION_NAMES: pairs('DIVISION_NAMES', /^[A-Za-z0-9 &.-]+$/).default('02:RESEARCH'),

    /**
     * The hospital master list (HML): one row per hospital, with its HQ and
     * tier. Interpolated like DASHBOARD_TABLE.
     */
    HOSPITAL_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'HOSPITAL_TABLE must look like schema.table')
      .default('Infinity.Hospital_List'),
    /** Divisions the hospital section is shown for (comma-separated codes): RESEARCH. */
    HOSPITAL_DIVISIONS: z
      .string()
      .default('02')
      .transform((raw) => raw.split(',').map((d) => d.trim()).filter(Boolean)),

    /**
     * One row per doctor, territory and month, with the TM's, RM's and ZSM's
     * visit counts. A doctor with tmVisitCounts = 0 was missed. Interpolated
     * like DASHBOARD_TABLE.
     */
    VISIT_SUMMARY_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'VISIT_SUMMARY_TABLE must look like schema.table')
      .default('dbo.infinity_Visit_Summary'),

    /** Budgeted TMs per division and HQ (no month). Interpolated like DASHBOARD_TABLE. */
    BUDGET_TM_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'BUDGET_TM_TABLE must look like schema.table')
      .default('Infinity.budgeted_tm'),
    /** TMs in place per division and HQ — PCPM's divisor. Interpolated like DASHBOARD_TABLE. */
    EMP_COUNT_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'EMP_COUNT_TABLE must look like schema.table')
      .default('Infinity.vw_emp_count'),

    REDIS_URL: z.string().optional(),
    /** none: no response cache — every request reads the warehouse. */
    CACHE_DRIVER: z.enum(['memory', 'redis', 'none']).default('memory'),
    /** Most views the memory cache holds (each a few hundred KB at most). */
    MEMORY_CACHE_MAX: z.coerce.number().int().min(100).max(100_000).default(1000),

    /**
     * How often to check whether any source has changed (the data
     * fingerprint). A change rebuilds the cached views in the background;
     * until then users get the previous copy at once.
     */
    DATA_CHECK_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
    /** Views rebuilt at once after a change — leaves Synapse room for users. */
    WARM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    /** Most recently used views rebuilt after a change, besides the senior defaults. */
    WARM_MAX_VIEWS: z.coerce.number().int().min(0).max(5000).default(300),
    /** A view counts as recently used for this many hours. */
    WARM_HOT_HOURS: z.coerce.number().int().min(1).max(168).default(24),

    AZURE_TENANT_ID: z.string().optional(),
    AZURE_API_AUDIENCE: z.string().optional(),

    /**
     * Sign-in: the Central User Service (users.wockregenerative.com). It holds
     * every user, emails the OTP and issues the session token (RS256), which
     * this API checks with the service's public key.
     */
    CENTRAL_USER_SERVICE_URL: z.string().url().transform((u) => u.replace(/\/+$/, '')),
    /** The token issuer, when the service is reached at another address. Default: the URL. */
    CENTRAL_ISSUER: z.string().url().optional(),
    /** This app's id in the service: the token audience, named in the OTP email. */
    CENTRAL_CLIENT_ID: z.string().min(1).default('ibb-insights'),
    /** This app's API key in the service (OTP calls, account checks, the hierarchy). */
    CENTRAL_API_KEY: z.string().min(1, 'CENTRAL_API_KEY is required: register the app in the Central User Service'),
    /**
     * Mobiles that see every division, besides the service's own admins:
     * "9876543210,9123456780".
     */
    ALL_DIVISION_MOBILES: z
      .string()
      .default('')
      .transform((raw) => new Set(raw.split(',').map((m) => m.trim()).filter(Boolean))),
    /** Sign-in requests per IP per 15 minutes, as in the D2D portal. */
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),

    /**
     * Phase 1: serve the hardcoded contract mock. The serving database does not
     * exist yet (see ARCHITECTURE.md §4.8 / §12 Q13), so this defaults on.
     */
    USE_MOCK_DATA: bool(true),
  })
  .superRefine((v, ctx) => {
    if (!v.USE_MOCK_DATA) {
      for (const k of ['SQL_SERVER', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD'] as const) {
        if (!v[k]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: `${k} is required when USE_MOCK_DATA=false`,
          });
        }
      }
    }
    if (v.CACHE_DRIVER === 'redis' && !v.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when CACHE_DRIVER=redis',
      });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  // Startup failure. Console is correct here: the logger does not exist yet.
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

/** A division code as the dashboard knows it: an alias (DIVISION_ALIASES, RESEARCH's 84) becomes its division (02). */
export const canonicalDivisionCode = (d: string) => parsed.data.DIVISION_ALIASES[d] ?? d;

/** The effort names by dashboard division; an alias's entry (an older .env's 84) counts for its division. */
const effortDivisions: Record<string, string> = {};
for (const [d, name] of Object.entries(parsed.data.EFFORT_DIVISIONS)) {
  const division = canonicalDivisionCode(d);
  if (d === division || !(division in effortDivisions)) effortDivisions[division] = name;
}

export const config = Object.freeze({
  ...parsed.data,
  CENTRAL_ISSUER: (parsed.data.CENTRAL_ISSUER ?? parsed.data.CENTRAL_USER_SERVICE_URL).replace(/\/+$/, ''),
  EFFORT_DIVISIONS: effortDivisions,
  HOSPITAL_DIVISIONS: [...new Set(parsed.data.HOSPITAL_DIVISIONS.map(canonicalDivisionCode))],
});
export type Config = typeof config;

/**
 * Guard for invariant I9.
 *
 * A Synapse host in the connection string is normally a defect: the API is
 * supposed to read a small serving database, and Synapse cannot answer an
 * interactive query in under a second (§4.0). The guard stays, but
 * `DATA_SOURCE=synapse-direct` is an explicit, deliberate opt-out rather than
 * something that can happen by pasting the wrong connection string.
 *
 * If this warning is in your logs and you did not intend it, you have the wrong
 * database and every dashboard interaction is about to take seconds.
 */
const SYNAPSE_MARKERS = ['azuresynapse', 'sqlondemand', '-ondemand.sql'];
if (config.SQL_SERVER) {
  const host = config.SQL_SERVER.toLowerCase();
  const hit = SYNAPSE_MARKERS.find((m) => host.includes(m));
  if (hit && config.DATA_SOURCE !== 'synapse-direct') {
    console.error(
      `SQL_SERVER points at Synapse ("${hit}") but DATA_SOURCE is "${config.DATA_SOURCE}". ` +
        'The API is meant to read the serving database (invariant I9). ' +
        'Set DATA_SOURCE=synapse-direct if querying the warehouse directly is intended.',
    );
    process.exit(1);
  }
  if (hit) {
    console.warn(
      '[I9 OVERRIDE] Reading the warehouse directly, by design. Tab loads run ' +
        'in seconds rather than milliseconds; the response cache absorbs repeat ' +
        'requests. See ARCHITECTURE.md §4.10a.',
    );
  }
}
