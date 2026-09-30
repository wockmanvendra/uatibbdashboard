-- One-off migration for existing dev databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_add_orders_payment_method.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
