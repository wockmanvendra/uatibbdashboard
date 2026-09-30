-- Consolidated one-off migration — every DB change made since 2026-07-16,
-- for applying to an existing (production/UAT) database. Safe to re-run.
-- Delete after running.
--
--   psql -U postgres -d d2d_portal -f db/migrate_since_2026-07-16.sql
--
-- Individually these came from (kept for reference, superseded by this file):
--   migrate_products_required_fields_and_unique_material_code.sql (2026-07-16)
--   migrate_products_description_nullable.sql                     (2026-07-17)
--   migrate-add-customer-outstanding-since.js                     (2026-07-18)

BEGIN;

-- ── 2026-07-16 "product changes" ────────────────────────────────────────────
-- Backfill + NOT NULL on material_code and unit, plus a UNIQUE constraint on
-- material_code (global across divisions). description is intentionally left
-- nullable here — it was briefly made NOT NULL the same day, then reverted
-- the next day (2026-07-17), so this reflects the final state directly.

UPDATE products SET material_code = 'N/A' WHERE material_code IS NULL OR material_code = '';
UPDATE products SET unit          = 'N/A' WHERE unit          IS NULL OR unit          = '';

ALTER TABLE products ALTER COLUMN material_code SET NOT NULL;
ALTER TABLE products ALTER COLUMN unit          SET NOT NULL;

DO $$
DECLARE
  dupe_count integer;
BEGIN
  SELECT COUNT(*) INTO dupe_count FROM (
    SELECT material_code FROM products GROUP BY material_code HAVING COUNT(*) > 1
  ) d;
  IF dupe_count > 0 THEN
    RAISE EXCEPTION 'Cannot add UNIQUE constraint: % duplicate material_code value(s) exist. Resolve them first.', dupe_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_material_code_key') THEN
    ALTER TABLE products ADD CONSTRAINT products_material_code_key UNIQUE (material_code);
  END IF;
END $$;

-- ── 2026-07-18 "outstanding" ────────────────────────────────────────────────
-- Timestamps when a customer_outstanding balance last moved from <=0 to
-- positive; cleared back to NULL whenever it's settled. Auto-maintained by
-- the app (Excel-upload upsert in routes/customer-outstanding.js, and the
-- CCAvenue "Pay Now" settlement path in config/ccavenue.js) — never supplied
-- by the admin upload itself. Drives the "outstanding days" aging shown on
-- the dashboard (stat cards, Top 5 Customers, customer/order tables).

ALTER TABLE customer_outstanding ADD COLUMN IF NOT EXISTS outstanding_since TIMESTAMPTZ;

COMMIT;
