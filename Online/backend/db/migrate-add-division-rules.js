// ============================================================
//  One-time bridge script — creates the division_rules table on an
//  already-existing dev DB and seeds it with today's real overrides
//  (formerly DIVISION_OVERRIDES in src/config/divisionRules.js), so
//  behavior doesn't change for DIV-BEV/DIV-PCA/DIV-GRO/DIV-HCA once
//  getDivisionRules starts reading from the DB instead of that file.
//  Usage:  node db/migrate-add-division-rules.js
//  Safe to re-run (IF NOT EXISTS / ON CONFLICT); delete after use.
// ============================================================

import 'dotenv/config'
import pg from 'pg'
import { DEFAULT_RULES } from '../src/config/divisionRules.js'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

const DIVISION_RULES = [
  {
    division_code: 'DIV-BEV',
    order_workflow: {
      initialStatus: 'pending-l1',
      steps: [
        { step: 1, label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'], fromStatus: 'pending-l1', toStatus: 'approved' },
      ],
    },
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: DEFAULT_RULES.orderEntry,
    documents: DEFAULT_RULES.documents,
  },
  {
    division_code: 'DIV-PCA',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: false, minOrderValue: 2000, paymentOptions: [] },
    documents: {
      customer: DEFAULT_RULES.documents.customer,
      order: [{ key: 'prescriptionCopy', label: 'Prescription Copy', required: true }],
    },
  },
  {
    division_code: 'DIV-GRO',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: true, minOrderValue: 0, paymentOptions: ['pdc-delivery', 'online', 'payment-link'] },
    documents: DEFAULT_RULES.documents,
  },
  {
    division_code: 'DIV-HCA',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: true, minOrderValue: 0, paymentOptions: ['online', 'payment-link'] },
    documents: DEFAULT_RULES.documents,
  },
]

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_rules (
        division_code      VARCHAR(20)  PRIMARY KEY,
        order_workflow      JSONB        NOT NULL,
        customer_workflow   JSONB        NOT NULL,
        order_entry         JSONB        NOT NULL,
        documents           JSONB        NOT NULL,
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  console.log('division_rules table created (or already existed)')

  for (const d of DIVISION_RULES) {
    await pool.query(
      `INSERT INTO division_rules (division_code, order_workflow, customer_workflow, order_entry, documents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (division_code) DO UPDATE SET
         order_workflow = EXCLUDED.order_workflow, customer_workflow = EXCLUDED.customer_workflow,
         order_entry = EXCLUDED.order_entry, documents = EXCLUDED.documents, updated_at = NOW()`,
      [d.division_code, JSON.stringify(d.order_workflow), JSON.stringify(d.customer_workflow),
       JSON.stringify(d.order_entry), JSON.stringify(d.documents)]
    )
    console.log(`  seeded rules for ${d.division_code}`)
  }
} finally {
  await pool.end()
}
