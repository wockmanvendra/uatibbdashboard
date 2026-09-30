-- ============================================================
--  D2D Portal — Data Reset Script
--  Deletes all transactional / operational data in FK-safe order.
--  Keeps users rows where usertype IN:
--    'super-admin', 'admin', 'mm', 'dm'
--
--  Usage:
--    psql -U postgres -d d2d_portal -f db/reset_data.sql
-- ============================================================

BEGIN;

-- ── 1. Payment log (no FK constraints) ──────────────────────
DELETE FROM payment_log;

-- ── 2. Order children (must precede orders) ──────────────────
DELETE FROM order_approvals;
DELETE FROM order_items;

-- ── 3. Orders ────────────────────────────────────────────────
DELETE FROM orders;

-- ── 4. Customer children (must precede customers) ────────────
DELETE FROM customer_approvals;
DELETE FROM customer_outstanding;
DELETE FROM customer_documents;
DELETE FROM customer_addresses;

-- ── 5. Customers ─────────────────────────────────────────────
DELETE FROM customers;

-- ── 6. Audit / operational data ──────────────────────────────
DELETE FROM sync_history;
DELETE FROM login_history;

-- ── 7. Infinity master data (re-sync from API when needed) ───
DELETE FROM doctor_master_infinity;
DELETE FROM chemist_master_infinity;
DELETE FROM field_structure_infinity;
DELETE FROM field_user_details;

-- ── 8. Users — remove field users / OTP-login users ──────────
--  user_cfa_access rows for deleted users cascade automatically.
--  Keeping:  super-admin | admin | mm | dm
--  Removing: tm | rm | zsm | nsm | patient | doctor |
--             doctor-pharmacy | hospital | cfa | bu-head
DELETE FROM users
WHERE usertype NOT IN ('super-admin', 'admin', 'mm', 'dm');

-- ── Optional: reset sequence counters ────────────────────────
-- WARNING: uncommenting means new orders/customers will get codes
-- that were previously assigned (e.g. orders starting from 0001 again).
-- Only reset if you are sure no historical records will be re-imported.
-- TRUNCATE TABLE order_number_sequences;
-- TRUNCATE TABLE customer_code_sequences;

-- ── Optional: clear product catalogue ────────────────────────
-- product_schemes cascades from products (ON DELETE CASCADE),
-- so deleting from products is sufficient.
-- DELETE FROM products;

-- ── Optional: clear configuration / reference tables ─────────
-- DELETE FROM bank_master;
-- DELETE FROM division_contacts;
-- DELETE FROM division_rules;
-- DELETE FROM division_mapping;
-- Note: clearing cfa_state_master / cfa_locations / state_master
-- requires that orders, customers, users with FK references to
-- those tables are already cleared above.
-- DELETE FROM cfa_state_master;
-- DELETE FROM cfa_locations;
-- DELETE FROM state_master;

COMMIT;
