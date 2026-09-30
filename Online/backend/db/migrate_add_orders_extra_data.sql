-- One-off migration for existing dev databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_add_orders_extra_data.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extra_data JSONB;
