-- ============================================================
--  Division Performance dashboard — sign-in database (sales_dash_user_db)
--
--  Who may sign in comes from Infinity's field structure:
--    `npm run infinity:sync` pulls each division listed in infinity_division
--    from the Infinity field-structure API into field_structure_infinity, the
--    same table the D2D portal keeps; the views below — the D2D portal's
--    vw_emp_email_mobile / vw_tm_hierarchy / vw_infinity_users, plus
--    vw_dashboard_users — turn it into sign-in identities and scopes.
--
--  Idempotent: `npm run db:schema` applies it, and re-running is safe.
-- ============================================================

-- ── Source data ─────────────────────────────────────────────────────────────

-- Which divisions to pull, and Infinity's id for each (as in the D2D portal's
-- division_mapping). Add a row to bring a division's field force in.
CREATE TABLE IF NOT EXISTS infinity_division (
    division_code           VARCHAR(20)  PRIMARY KEY,      -- SPART, as in the sales data
    infinity_division_code  VARCHAR(60)  NOT NULL UNIQUE,  -- Infinity's division id
    division_name           VARCHAR(150)
);

INSERT INTO infinity_division (division_code, infinity_division_code, division_name) VALUES
    ('85', 'divsn00000000000000000000002024041501', 'BIOSCIENCES'),
    ('A5', 'divsn00000000000000000000002024111901', 'RESPIRATORY')
ON CONFLICT (division_code) DO NOTHING;

-- One row per field location, as the Infinity field-structure API returns it
-- (camelCase -> snake_case). Same columns as the D2D portal's table.
CREATE TABLE IF NOT EXISTS field_structure_infinity (
    tm_location_id          VARCHAR(60)   PRIMARY KEY,
    division                VARCHAR(150),
    division_code           VARCHAR(20)   NOT NULL,        -- infinity_division.division_code
    manager1_code           VARCHAR(50),
    manager1_name           VARCHAR(150),
    manager1_location_id    VARCHAR(60),
    manager1_location       VARCHAR(150),
    manager1_location_type  VARCHAR(50),
    manager1_sap_code       VARCHAR(100),
    manager1_sap_name       VARCHAR(150),
    manager2_code           VARCHAR(50),
    manager2_name           VARCHAR(150),
    manager2_location_id    VARCHAR(60),
    manager2_location       VARCHAR(150),
    manager2_location_type  VARCHAR(50),
    manager2_sap_code       VARCHAR(100),
    manager2_sap_name       VARCHAR(150),
    emp_code                VARCHAR(50),
    emp_name                VARCHAR(150),
    emp_location            VARCHAR(150),
    emp_location_type       VARCHAR(50),
    sap_code                VARCHAR(100),
    sap_name                VARCHAR(150),
    mirror_hq               VARCHAR(10),
    emp_job_role            VARCHAR(100),
    job_role_id             VARCHAR(60),
    emp_doj                 VARCHAR(20),
    emp_dob                 VARCHAR(20),
    active_from             VARCHAR(20),
    active_to               VARCHAR(20),
    email                   VARCHAR(150),
    mobile                  VARCHAR(50),
    corporate_mobile        VARCHAR(50),
    emp_id                  VARCHAR(60),
    town                    VARCHAR(100),
    state                   VARCHAR(100),
    whatsapp_consent_detail VARCHAR(50),
    synced_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS field_structure_division_idx ON field_structure_infinity (division_code);
CREATE INDEX IF NOT EXISTS field_structure_emp_code_idx ON field_structure_infinity (emp_code);

-- One row per division per sync run.
CREATE TABLE IF NOT EXISTS infinity_sync_log (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    division_code   VARCHAR(20)  NOT NULL,
    status          VARCHAR(10)  NOT NULL CHECK (status IN ('success', 'error')),
    row_count       INT,
    skipped_count   INT,
    error_message   TEXT,
    synced_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Views, as in the D2D portal ─────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_emp_email_mobile AS
SELECT division_code,
       emp_code,
       emp_name,
       mobile AS mobile_no,
       email  AS email_id
  FROM field_structure_infinity;

CREATE OR REPLACE VIEW vw_tm_hierarchy AS
SELECT a.division_code,
       nsm.emp_code         AS nsm_empcode,
       nsm.emp_name         AS nsm_name,
       nsm.emp_location     AS nsm_location,
       nsm.sap_code         AS nsm_sapcode,
       nsm.mobile_no        AS nsm_mobile_no,
       nsm.email_id         AS nsm_email_id,
       a.manager2_code      AS zsm_empcode,
       a.manager2_name      AS zsm_name,
       a.manager2_location  AS zsm_location,
       a.manager2_sap_code  AS zsm_sapcode,
       b.mobile_no          AS zsm_mobile_no,
       b.email_id           AS zsm_email_id,
       a.manager1_code      AS rm_empcode,
       a.manager1_name      AS rm_name,
       a.manager1_location  AS rm_location,
       a.manager1_sap_code  AS rm_sapcode,
       c.mobile_no          AS rm_mobile_no,
       c.email_id           AS rm_email_id,
       a.emp_code           AS tm_empcode,
       a.emp_name           AS tm_name,
       a.emp_location       AS tm_location,
       a.sap_code           AS tm_sapcode,
       d.mobile_no          AS tm_mobile_no,
       d.email_id           AS tm_email_id
  FROM field_structure_infinity a
  LEFT JOIN vw_emp_email_mobile b ON a.manager2_code::text = b.emp_code::text
  LEFT JOIN vw_emp_email_mobile c ON a.manager1_code::text = c.emp_code::text
  LEFT JOIN vw_emp_email_mobile d ON a.emp_code::text = d.emp_code::text
  LEFT JOIN (
        SELECT DISTINCT zsm.manager1_code     AS emp_code,
                        zsm.manager1_name     AS emp_name,
                        zsm.manager1_location AS emp_location,
                        zsm.manager1_sap_code AS sap_code,
                        ee.mobile_no,
                        ee.email_id,
                        zsm.emp_code          AS zsm_emp_code
          FROM field_structure_infinity zsm
          LEFT JOIN vw_emp_email_mobile ee ON zsm.manager1_code::text = ee.emp_code::text
         WHERE zsm.emp_location_type::text = 'Zone'
       ) nsm ON nsm.zsm_emp_code::text = a.manager2_code::text
 WHERE a.emp_location_type::text = 'Territory';

CREATE OR REPLACE VIEW vw_infinity_users AS
SELECT division_code, user_type, empcode, user_name, user_location, sapcode, mobile_no, email_id
  FROM (
        SELECT DISTINCT division_code, 'NSM'::text AS user_type, nsm_empcode AS empcode, nsm_name AS user_name,
               nsm_location AS user_location, nsm_sapcode AS sapcode, nsm_mobile_no AS mobile_no, nsm_email_id AS email_id
          FROM vw_tm_hierarchy
        UNION ALL
        SELECT DISTINCT division_code, 'ZSM'::text, zsm_empcode, zsm_name, zsm_location, zsm_sapcode, zsm_mobile_no, zsm_email_id
          FROM vw_tm_hierarchy
        UNION ALL
        SELECT DISTINCT division_code, 'RM'::text, rm_empcode, rm_name, rm_location, rm_sapcode, rm_mobile_no, rm_email_id
          FROM vw_tm_hierarchy
        UNION ALL
        SELECT DISTINCT division_code, 'TM'::text, tm_empcode, tm_name, tm_location, tm_sapcode, tm_mobile_no, tm_email_id
          FROM vw_tm_hierarchy
       ) aa
 WHERE mobile_no IS NOT NULL;

-- ── The dashboard's sign-in view ────────────────────────────────────────────
-- One row per person: the 10-digit mobile they sign in with, and what they may
-- see (ARCHITECTURE §6). Each role's own SAP code is a node at that role's
-- level — TM: HQ (BZIRK), RM: region (VKGRP), ZSM: zone (VKBUR) — and an NSM
-- sees their division (SPART). Someone listed under several roles is scoped by
-- the broadest; several nodes at that level (or a comma-separated code) are
-- all kept. `divisions` holds everyone's own division(s): an HQ, region or zone
-- code can recur in another division, so every query is held to them as well.

CREATE OR REPLACE VIEW vw_dashboard_users AS
WITH people AS (
    SELECT btrim(empcode) AS empcode,
           btrim(division_code) AS division_code,
           user_type,
           btrim(user_name) AS user_name,
           right(regexp_replace(mobile_no, '\D', '', 'g'), 10) AS mobileno,
           NULLIF(btrim(email_id), '') AS email,
           CASE user_type WHEN 'TM' THEN 'HQ' WHEN 'RM' THEN 'REGION' WHEN 'ZSM' THEN 'ZONE' ELSE 'DIVISION' END AS scope_level,
           CASE user_type WHEN 'NSM' THEN division_code ELSE sapcode END AS scope_codes,
           CASE user_type WHEN 'NSM' THEN 4 WHEN 'ZSM' THEN 3 WHEN 'RM' THEN 2 ELSE 1 END AS role_rank
      FROM vw_infinity_users
     WHERE NULLIF(btrim(empcode), '') IS NOT NULL
),
broadest AS (
    SELECT empcode, max(role_rank) AS role_rank FROM people GROUP BY empcode
)
SELECT p.empcode,
       lower(min(p.user_type)) AS usertype,
       min(p.user_name)        AS name,
       min(p.mobileno)         AS mobileno,
       min(p.email)            AS email,
       min(p.scope_level)      AS scope_level,
       COALESCE(
         array_agg(DISTINCT btrim(node) ORDER BY btrim(node))
           FILTER (WHERE btrim(node) NOT IN ('', '-', '0')),
         '{}'
       ) AS scope_nodes,
       -- Appended last: CREATE OR REPLACE VIEW can only add columns at the end.
       COALESCE(
         array_agg(DISTINCT p.division_code ORDER BY p.division_code)
           FILTER (WHERE p.division_code <> ''),
         '{}'
       ) AS divisions
  FROM people p
  JOIN broadest b ON b.empcode = p.empcode AND b.role_rank = p.role_rank
  -- LEFT, so someone with no code stays listed, with no nodes, rather than vanishing.
  LEFT JOIN LATERAL unnest(string_to_array(COALESCE(p.scope_codes, ''), ',')) AS node ON TRUE
 GROUP BY p.empcode;

-- ── Sign-in state ───────────────────────────────────────────────────────────

-- The pending one-time password per person, as an HMAC: a copy of this table
-- never reveals a usable code. Cleared when used.
CREATE TABLE IF NOT EXISTS login_otp (
    empcode         VARCHAR(50)  PRIMARY KEY,         -- vw_dashboard_users.empcode
    otp_hash        CHAR(64),
    otp_expires_at  TIMESTAMPTZ,
    otp_sent_at     TIMESTAMPTZ,                      -- resend cooldown
    otp_attempts    SMALLINT     NOT NULL DEFAULT 0,  -- wrong guesses against the pending code
    last_login_at   TIMESTAMPTZ
);

-- One row per sign-in attempt, success or failure, as in the D2D portal.
CREATE TABLE IF NOT EXISTS login_history (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(50),                      -- empcode; NULL for an unregistered number
    name            VARCHAR(150),
    mobileno        VARCHAR(15)  NOT NULL,
    usertype        VARCHAR(30),
    login_method    VARCHAR(10)  NOT NULL DEFAULT 'otp',
    status          VARCHAR(20)  NOT NULL CHECK (status IN ('success', 'failed')),
    failure_reason  TEXT,
    ip_address      VARCHAR(45),
    logged_in_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_history_logged_in_at_idx ON login_history (logged_in_at DESC);
CREATE INDEX IF NOT EXISTS login_history_mobileno_idx ON login_history (mobileno);

-- ── Password accounts ───────────────────────────────────────────────────────
-- People who sign in with a mobile number and password rather than an OTP —
-- BU heads, who are not in Infinity's field structure. As the D2D portal's
-- users table holds them: bcrypt hash, locked after 3 wrong passwords, a new
-- password forced at first sign-in and every 90 days. Each sees the divisions
-- listed here, as an NSM sees theirs. Managed with `npm run account`.
CREATE TABLE IF NOT EXISTS dashboard_accounts (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    usertype              VARCHAR(30)  NOT NULL CHECK (usertype IN ('bu-head')),
    name                  VARCHAR(150) NOT NULL,
    mobileno              VARCHAR(10)  NOT NULL UNIQUE CHECK (mobileno ~ '^[6-9][0-9]{9}$'),
    email                 VARCHAR(255),
    empcode               VARCHAR(50),
    division_codes        TEXT[]       NOT NULL CHECK (cardinality(division_codes) > 0),
    password_hash         VARCHAR(255) NOT NULL,
    password_changed_at   TIMESTAMPTZ,                  -- NULL: must set a new password at next sign-in
    password_version      INTEGER      NOT NULL DEFAULT 0, -- bumped on every change; a change token is good for one version
    failed_attempts       SMALLINT     NOT NULL DEFAULT 0,
    locked_at             TIMESTAMPTZ,                  -- set at the 3rd wrong password
    reset_otp_hash        CHAR(64),                     -- forgot-password code, as an HMAC
    reset_otp_expires_at  TIMESTAMPTZ,
    reset_otp_sent_at     TIMESTAMPTZ,
    reset_otp_attempts    SMALLINT     NOT NULL DEFAULT 0,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
