-- One-off migration for existing dev/sandbox databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_products_description_nullable.sql
--
-- Reverts products.description back to nullable — it was made NOT NULL on
-- 2026-07-16 but description should not be a mandatory field after all.

ALTER TABLE products ALTER COLUMN description DROP NOT NULL;
