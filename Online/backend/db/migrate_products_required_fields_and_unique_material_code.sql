-- One-off migration for existing dev/sandbox databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_products_required_fields_and_unique_material_code.sql
--
-- 1) Backfills any existing NULL/empty material_code, description, unit with a
--    placeholder ('N/A') so the NOT NULL constraint can be applied immediately;
--    clean up real values later via the Product Master Edit form.
-- 2) Adds a UNIQUE constraint on material_code, global across all divisions.
--    Aborts if duplicate material_code values already exist — resolve those
--    first (e.g. via the Edit form) and re-run.

BEGIN;

UPDATE products SET material_code = 'N/A' WHERE material_code IS NULL OR material_code = '';
UPDATE products SET description   = 'N/A' WHERE description   IS NULL OR description   = '';
UPDATE products SET unit           = 'N/A' WHERE unit           IS NULL OR unit           = '';

ALTER TABLE products ALTER COLUMN material_code SET NOT NULL;
ALTER TABLE products ALTER COLUMN description   SET NOT NULL;
ALTER TABLE products ALTER COLUMN unit           SET NOT NULL;

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

COMMIT;
