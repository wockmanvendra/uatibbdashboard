-- One-off migration for existing dev databases — delete after running.
--   psql -U postgres -d d2d_portal -f db/migrate_add_field_user_details.sql
CREATE TABLE IF NOT EXISTS field_user_details (
    emp_code      VARCHAR(20)  PRIMARY KEY,   -- Emp_Code
    emp_name      VARCHAR(150) NOT NULL,      -- Emp_Name
    desig         VARCHAR(20),                -- DESIG (designation, e.g. TM, RM, ZSM, SM)
    mobile_no     VARCHAR(15),                -- MOBILE_NO
    email_id      VARCHAR(150),               -- EMIAL ID
    division_code VARCHAR(20)                 -- division_code (Infinity numeric division code)
);
