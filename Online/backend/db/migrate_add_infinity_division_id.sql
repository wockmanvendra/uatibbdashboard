-- One-off migration for existing dev databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_add_infinity_division_id.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS infinity_division_id VARCHAR(20);
