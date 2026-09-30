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

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
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
     * The one table every dashboard figure is read from, as schema.table.
     * Interpolated into SQL, so it must be a plain two-part identifier.
     */
    DASHBOARD_TABLE: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/, 'DASHBOARD_TABLE must look like schema.table')
      .default('Infinity.Infinity_Reports'),

    REDIS_URL: z.string().optional(),
    CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),

    AZURE_TENANT_ID: z.string().optional(),
    AZURE_API_AUDIENCE: z.string().optional(),

    /** Signs session tokens; changing it signs everyone out. Required in production. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    SESSION_MAX_HOURS: z.coerce.number().positive().default(8),

    /** The sign-in database (db/schema.sql): who may sign in and what they may see. */
    USER_DATABASE_URL: z.string().url(),
    // The Infinity field-structure API, as the D2D portal calls it. The header
    // is sent only when both are set.
    INFINITY_REPORT_BASE_URL: z.string().url().default('https://infinityplus.wockhardt.com/plus/report'),
    INFINITY_API_HEADER_NAME: z.string().optional(),
    INFINITY_API_TOKEN: z.string().optional(),
    OTP_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    /** Sign-in requests per IP per 15 minutes, as in the D2D portal. */
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),

    // OTP by SMS (SMSStriker, as the D2D portal uses). The text must match the
    // DLT-registered template exactly, with {otp} where the code goes.
    SMS_URL: z.string().optional(),
    SMS_USERNAME: z.string().optional(),
    SMS_PASSWORD: z.string().optional(),
    SMS_FROM: z.string().optional(),
    SMS_TEMPLATE_ID: z.string().optional(),
    SMS_OTP_TEXT: z.string().optional(),

    // OTP by email. SMTP_USER is optional: an internal relay may not need auth.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_INSECURE_TLS: bool(false),
    EMAIL_FROM: z.string().optional(),

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
    if (v.NODE_ENV === 'production' && !v.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production',
      });
    }
    if (v.SMS_OTP_TEXT !== undefined && !v.SMS_OTP_TEXT.includes('{otp}')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_OTP_TEXT'],
        message: 'SMS_OTP_TEXT must contain {otp}',
      });
    }
    // Outside production the code is shown on the login screen instead.
    const smsReady = !!(v.SMS_URL && v.SMS_USERNAME && v.SMS_FROM && v.SMS_TEMPLATE_ID && v.SMS_OTP_TEXT);
    const emailReady = !!(v.SMTP_HOST && v.EMAIL_FROM);
    if (v.NODE_ENV === 'production' && !smsReady && !emailReady) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_URL'],
        message: 'Production needs a way to send OTPs: configure SMS_* or SMTP_HOST + EMAIL_FROM',
      });
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

// Outside production a fixed secret keeps sessions valid across `tsx watch`
// restarts. Production refuses to start without its own (see superRefine).
const DEV_JWT_SECRET = 'divperf-development-only-secret-not-for-production';

export const config = Object.freeze({
  ...parsed.data,
  JWT_SECRET: parsed.data.JWT_SECRET ?? DEV_JWT_SECRET,
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
