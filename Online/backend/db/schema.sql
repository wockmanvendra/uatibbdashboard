-- ============================================================
--  D2D Direct-to-Customer Portal — PostgreSQL Schema
--  Run once against an empty database:
--    psql -U postgres -d d2d_portal -f db/schema.sql
-- ============================================================

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    usertype      VARCHAR(30)  NOT NULL,          -- patient | doctor | doctor-pharmacy | hospital | tm | rm | zsm | nsm | admin | cfa | mm | dm
    name          VARCHAR(100) NOT NULL,
    mobileno      VARCHAR(15)  UNIQUE NOT NULL,
    password_hash VARCHAR(255),                   -- bcrypt hash; NULL for OTP-only users
    otp           VARCHAR(10),                    -- generated OTP (random 6-digit); NULL for password users or after successful verify
    otp_expires_at TIMESTAMPTZ,                  -- set on each OTP request; NULL after use or never requested
    division_code VARCHAR(20),                    -- restricts product/customer access to this division when set; NULL = all divisions
    cfa_code      VARCHAR(20),                    -- the one CFA location a 'cfa' usertype account is scoped to; NULL for non-cfa usertypes (FK added below, after cfa_locations exists)
    sap_code      VARCHAR(30),                    -- field rep's SAP code (matches doctor/chemist_master_infinity.sap_code) — scopes the registration directory to this user's territory
    email         VARCHAR(150),                   -- used for OTP delivery and approval notifications
    infinity_division_id VARCHAR(20),             -- numeric division ID used by the Infinity DML/CML sync APIs (admin users only)
    empcode       VARCHAR(20)  UNIQUE,            -- links to vw_tm_hierarchy/vw_infinity_users empcode for approval-hierarchy lookups; NULL for non-field users
    user_location VARCHAR(150),                   -- vw_infinity_users.user_location / field_structure_infinity.emp_location — scopes the registration directory to this user's territory
    failed_attempts      INT         NOT NULL DEFAULT 0,     -- brute-force counter; reset to 0 on success
    locked_at            TIMESTAMPTZ,                          -- set when failed_attempts reaches 3; NULL = not locked
    password_changed_at  TIMESTAMPTZ,                          -- NULL = never changed (first login); triggers forced reset after 3 months
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Order number sequences ───────────────────────────────────────────────────
-- Permanent per-(division_code, year) counters backing generateOrderNumber()
-- (src/utils/orderNumber.js). next_seq only ever increases within a given
-- (division_code, year) pair, so order_number values are never reused even
-- after the order they were assigned to is deleted.

CREATE TABLE IF NOT EXISTS order_number_sequences (
    division_code VARCHAR(20) NOT NULL,
    year          SMALLINT    NOT NULL,
    next_seq      INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (division_code, year)
);

-- Permanent per-(customer_type, year) counters backing generateCustomerCode()
-- (src/utils/customerCode.js) — same pattern as order_number_sequences above.

CREATE TABLE IF NOT EXISTS customer_code_sequences (
    customer_type VARCHAR(30) NOT NULL,
    year          SMALLINT    NOT NULL,
    next_seq      INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (customer_type, year)
);

-- ── CFA locations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cfa_locations (
    cfa_code  VARCHAR(20)  PRIMARY KEY,
    cfa_name  VARCHAR(100) NOT NULL,
    mobile    VARCHAR(15),
    email     VARCHAR(150)
);

-- users.cfa_code references cfa_locations, but both tables are declared above
-- this point — added here as a standalone constraint instead of an inline
-- REFERENCES, so table declaration order doesn't matter.
ALTER TABLE users ADD CONSTRAINT users_cfa_code_fkey
  FOREIGN KEY (cfa_code) REFERENCES cfa_locations(cfa_code);

-- ── State master (statecode/statename reference list) ───────────────────────

CREATE TABLE IF NOT EXISTS state_master (
    state_code  VARCHAR(10)   PRIMARY KEY,
    state_name  VARCHAR(100)  NOT NULL UNIQUE
);

-- ── User CFA access (which CFAs a dm/mm is scoped to) ────────────────────────
-- Distribution Managers (dm) and Marketing Managers (mm) give final approval
-- on customers/orders respectively. When a user has one or more rows here,
-- they may only see/approve customers/orders whose cfa_code is in this set —
-- a user with zero rows is blocked from everything, not unrestricted.

CREATE TABLE IF NOT EXISTS user_cfa_access (
    user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cfa_code  VARCHAR(20)  NOT NULL REFERENCES cfa_locations(cfa_code),
    PRIMARY KEY (user_id, cfa_code)
);

-- ── CFA state master (state -> the one CFA that serves it) ──────────────────
-- Customer registration resolves the CFA automatically from the customer's
-- state via this table — TMs never pick a CFA directly. One CFA per
-- state_code (division-independent); approvers can still override a
-- customer's cfa_code by hand via PATCH /api/customers/:id.
-- division_code is unused (kept only so existing rows don't need a column
-- drop) — always NULL going forward.

CREATE TABLE IF NOT EXISTS cfa_state_master (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    division_code  VARCHAR(20),
    state_code     VARCHAR(10)  NOT NULL REFERENCES state_master(state_code),
    cfa_code       VARCHAR(20)  NOT NULL REFERENCES cfa_locations(cfa_code),
    UNIQUE (state_code)
);

-- ── Division mapping (D2D division <-> Infinity division) ───────────────────
-- Maps D2D's internal division_code (e.g. 'DIV-GRO') to the numeric/opaque
-- division code Infinity expects on its DML/CML sync endpoints.

CREATE TABLE IF NOT EXISTS division_mapping (
    division_code           VARCHAR(50)   PRIMARY KEY,   -- D2D division code (matches users.division_code)
    infinity_division_code  VARCHAR(1000),                -- divisionId Infinity expects in /customer/dml|cml/<id>
    division_name           VARCHAR(1000)
);

-- ── Division rules (admin-managed approval workflow / order-entry / document config) ──
-- One row per division that has been explicitly configured; a division with no row
-- here falls back to DEFAULT_RULES in src/config/divisionRules.js. Each JSONB column
-- holds the complete object for that piece (not a partial diff) — see divisionRules.js
-- for the expected shapes.

CREATE TABLE IF NOT EXISTS division_rules (
    division_code           VARCHAR(20)  PRIMARY KEY,
    order_workflow           JSONB        NOT NULL,
    customer_workflow        JSONB        NOT NULL,
    order_entry              JSONB        NOT NULL,
    documents                JSONB        NOT NULL,
    allowed_customer_types   TEXT[]       NOT NULL DEFAULT ARRAY['patient','doctor','doctor-pharmacy','hospital'],
    -- Which customer types may log in (OTP) to their own account in this
    -- division — independent of allowed_customer_types (registration
    -- eligibility). An empty array is a valid, deliberate "block everyone".
    allowed_login_customer_types TEXT[]   NOT NULL DEFAULT ARRAY['patient','doctor','doctor-pharmacy','hospital'],
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Division contacts (admin-managed CC email(s) + admin mobile per division) ──
-- Every workflow/payment notification email CCs cc_emails for the relevant
-- division; admin_mobile replaces the single global ADMIN_CONTACT_MOBILE env
-- var as the "contact administrator" number shown in the frontend's error
-- modal. A division with no row here falls back to {ccEmails: [], adminMobile:
-- process.env.ADMIN_CONTACT_MOBILE} — see src/config/divisionContacts.js.

CREATE TABLE IF NOT EXISTS division_contacts (
    division_code VARCHAR(20)  PRIMARY KEY,
    cc_emails     TEXT[]       NOT NULL DEFAULT '{}',
    admin_mobile  VARCHAR(20)
);

-- ── Bank master (shared, growing list of bank names for post-dated-cheque payments) ──
-- Anyone placing a cheque-payment order can add a missing bank via the "+" control
-- in CartPanel; the new name is persisted here so it's available to every user.

CREATE TABLE IF NOT EXISTS bank_master (
    bank_name  VARCHAR(120)  PRIMARY KEY
);

-- ── Doctor master data (synced from Infinity DML API) ────────────────────────
-- Columns mirror the Infinity DML API field names (camelCase -> snake_case).
-- d2d_division_code is the only field not present in the API response — it
-- stores our internal DIV-XXX code (set from the syncing admin's division)
-- so the directory search can be scoped per-division.

CREATE TABLE IF NOT EXISTS doctor_master_infinity (
    doctor_id                VARCHAR(60)   PRIMARY KEY,   -- doctorId
    division_code            VARCHAR(20),                 -- divisionCode (Infinity's numeric division code)
    division                 VARCHAR(100),                -- division
    zone                     VARCHAR(100),                -- zone
    region                   VARCHAR(100),                -- region
    location_id              VARCHAR(60),                 -- locationId
    location                 VARCHAR(100),                -- location
    employee_code            VARCHAR(20),                 -- employeeCode
    employee_name            VARCHAR(150),                -- employeeName
    doctor_uid                VARCHAR(50),                -- doctorUid
    doctor_code              VARCHAR(50),                 -- doctorCode
    doctor_name              VARCHAR(150) NOT NULL,       -- doctorName
    doctor_speciality        VARCHAR(100),                -- doctorSpeciality
    doctor_classification     VARCHAR(50),                -- doctorClassification
    address_line1            VARCHAR(500),                -- addressLine1
    address_line2            VARCHAR(500),                -- addressLine2
    state                    VARCHAR(100),                -- state
    town                     VARCHAR(100),                -- town
    beat                     VARCHAR(150),                -- beat
    email_id                 VARCHAR(255),                -- emailId
    mobile                   VARCHAR(50),                 -- mobile
    created_on               VARCHAR(20),                 -- createdOn
    dispensing               VARCHAR(50),                 -- dispensing
    town_type                VARCHAR(20),                 -- townType
    activities               VARCHAR(255),                -- activities (comma-separated activity names)
    employee_date_of_joining VARCHAR(20),                 -- employeeDateOfJoining
    sap_code                 VARCHAR(30),                 -- sapCode
    sap_name                 VARCHAR(100),                -- sapName
    pin_code                 VARCHAR(20),                 -- pinCode
    fees                     NUMERIC(10,2),               -- fees
    follow_up_fees           NUMERIC(10,2),               -- followUpFees
    practising_days          INTEGER,                     -- practisingDays
    call_days                VARCHAR(255),                -- callDays
    call_place               VARCHAR(255),                -- callPlace
    call_time                VARCHAR(50),                 -- callTime
    mirror_hq                VARCHAR(10),                 -- mirrorHq
    req_visit_frequency      VARCHAR(50),                 -- reqVisitFrequency
    profile_update_status    VARCHAR(50),                 -- profileUpdateStatus
    dispensing_type          VARCHAR(50),                 -- dispensingType
    pbrands                  VARCHAR(255),                -- pbrands (comma-separated brand names)
    d2d_division_code        VARCHAR(20)                  -- D2D's internal division (DIV-GRO etc.), set during sync
);

-- ── Chemist master data (synced from Infinity CML API) ───────────────────────
-- Columns mirror the Infinity CML API field names (camelCase -> snake_case).
-- d2d_division_code is the only field not present in the API response — it
-- stores our internal DIV-XXX code (set from the syncing admin's division)
-- so the directory search can be scoped per-division.

CREATE TABLE IF NOT EXISTS chemist_master_infinity (
    chemist_id              VARCHAR(60)   PRIMARY KEY,   -- chemistId
    division_code           VARCHAR(20),                 -- divisionCode (Infinity's numeric division code)
    division                VARCHAR(100),                -- division
    zone                    VARCHAR(100),                -- zone
    region                  VARCHAR(100),                -- region
    location                VARCHAR(100),                -- location
    sap_code                VARCHAR(30),                 -- sapCode
    sap_name                VARCHAR(100),                -- sapName
    employee_code           VARCHAR(20),                 -- employeeCode
    employee_name           VARCHAR(150),                -- employeeName
    chemist_code            VARCHAR(50),                 -- chemistCode
    chemist_name            VARCHAR(255) NOT NULL,       -- chemistName
    chemist_classification  VARCHAR(50),                 -- chemistClassification
    address_line1           VARCHAR(500),                -- addressLine1
    address_line2           VARCHAR(500),                -- addressLine2
    state                   VARCHAR(100),                -- state
    town                    VARCHAR(100),                -- town
    beat                    VARCHAR(150),                -- beat
    email_id                VARCHAR(255),                -- emailId
    mobile                  VARCHAR(50),                 -- mobile
    town_type               VARCHAR(20),                 -- townType
    date_of_shop_opening    VARCHAR(20),                 -- dateOfShopOpening
    date_of_anniversary     VARCHAR(20),                 -- dateOfAnniversary
    creation_date           VARCHAR(20),                 -- creationDate
    customer_type           VARCHAR(50),                 -- customerType
    date_of_birth           VARCHAR(20),                 -- dateOfBirth
    d2d_division_code       VARCHAR(20)                  -- D2D's internal division (DIV-GRO etc.), set during sync
);

-- ── Field structure data (synced from Infinity field-structure report API) ────
-- Columns mirror the Infinity field-structure API field names (camelCase -> snake_case).
-- d2d_division_code is the only field not present in the API response — it
-- stores our internal DIV-XXX code (set from the syncing admin's division)
-- so the data can be scoped per-division.

CREATE TABLE IF NOT EXISTS field_structure_infinity (
    tm_location_id          VARCHAR(60)   PRIMARY KEY,   -- tmLocationId
    division                VARCHAR(150),                -- division
    division_code           VARCHAR(20),                 -- divisionCode (Infinity's numeric division code)
    manager1_code           VARCHAR(50),                 -- manager1Code
    manager1_name           VARCHAR(150),                -- manager1Name
    manager1_location_id    VARCHAR(60),                 -- manager1LocationId
    manager1_location       VARCHAR(150),                -- manager1Location
    manager1_location_type  VARCHAR(50),                 -- manager1LocationType
    manager1_sap_code       VARCHAR(100),                -- manager1SapCode
    manager1_sap_name       VARCHAR(150),                -- manager1SapName
    manager2_code           VARCHAR(50),                 -- manager2Code
    manager2_name           VARCHAR(150),                -- manager2Name
    manager2_location_id    VARCHAR(60),                 -- manager2LocationId
    manager2_location       VARCHAR(150),                -- manager2Location
    manager2_location_type  VARCHAR(50),                 -- manager2LocationType
    manager2_sap_code       VARCHAR(100),                -- manager2SapCode
    manager2_sap_name       VARCHAR(150),                -- manager2SapName
    emp_code                VARCHAR(50),                 -- empCode
    emp_name                VARCHAR(150),                -- empName
    emp_location            VARCHAR(150),                -- empLocation
    emp_location_type       VARCHAR(50),                 -- empLocationType
    sap_code                VARCHAR(100),                -- sapCode
    sap_name                VARCHAR(150),                -- sapName
    mirror_hq               VARCHAR(10),                 -- mirrorHq
    emp_job_role            VARCHAR(100),                -- empJobRole
    job_role_id             VARCHAR(60),                 -- jobRoleId
    emp_doj                 VARCHAR(20),                 -- empDOJ
    emp_dob                 VARCHAR(20),                 -- empDOB
    active_from             VARCHAR(20),                 -- activeFrom
    active_to               VARCHAR(20),                 -- activeTo
    email                   VARCHAR(150),                -- email
    mobile                  VARCHAR(50),                 -- mobile
    corporate_mobile        VARCHAR(50),                 -- corporateMobile
    emp_id                  VARCHAR(60),                 -- empId
    town                    VARCHAR(100),                -- town
    state                   VARCHAR(100),                -- state
    whatsapp_consent_detail VARCHAR(50),                 -- whatsappConsentDetail
    d2d_division_code       VARCHAR(20)                  -- D2D's internal division (DIV-GRO etc.), set during sync
);

-- ── Internal field user details (HR-provided Internal_User_Details.xlsx) ─────
-- One-time import of internal field-force staff; columns mirror the source
-- spreadsheet headers (Emp_Code, Emp_Name, DESIG, MOBILE_NO, EMIAL ID, division_code).

CREATE TABLE IF NOT EXISTS field_user_details (
    emp_code      VARCHAR(20)  PRIMARY KEY,   -- Emp_Code
    emp_name      VARCHAR(150) NOT NULL,      -- Emp_Name
    desig         VARCHAR(20),                -- DESIG (designation, e.g. TM, RM, ZSM, SM)
    mobile_no     VARCHAR(15),                -- MOBILE_NO
    email_id      VARCHAR(150),               -- EMIAL ID
    division_code VARCHAR(20)                 -- division_code (Infinity numeric division code)
);

-- ── Infinity master sync job history ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_history (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type         VARCHAR(30)  NOT NULL,   -- doctors | chemists | field-structure | users
    division_code     VARCHAR(20),
    status            VARCHAR(20)  NOT NULL,   -- success | error
    record_count      INTEGER,
    skipped_count     INTEGER,
    deactivated_count INTEGER,                -- users sync only: accounts deactivated for no longer appearing in vw_infinity_users
    error_message     TEXT,
    run_by            UUID         REFERENCES users(id),
    run_by_name       VARCHAR(100),
    run_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Login history (audit trail of every login attempt) ─────────────────────────
-- No FK on user_id: a "user not found" attempt has none — identity is captured
-- directly via the name/usertype/mobileno columns instead, same pattern as
-- *_approvals.approved_by_name.

CREATE TABLE IF NOT EXISTS login_history (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID,
    name           VARCHAR(100),
    mobileno       VARCHAR(15)  NOT NULL,
    usertype       VARCHAR(30),
    login_method   VARCHAR(10)  NOT NULL,   -- otp | password
    status         VARCHAR(20)  NOT NULL,   -- success | failed
    failure_reason TEXT,
    division_code  VARCHAR(20),
    logged_in_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Products ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(150)   NOT NULL,
    brand          VARCHAR(100)   NOT NULL,
    material_code  VARCHAR(50)    NOT NULL UNIQUE,
    division_code  VARCHAR(20)    NOT NULL,
    price          NUMERIC(10,2)  NOT NULL,
    description    TEXT,
    min_order_qty  INTEGER        NOT NULL DEFAULT 1,
    init_min_order_qty INTEGER    NOT NULL DEFAULT 1,  -- first +/- step on the order entry stepper; min_order_qty steps thereafter
    max_order_qty  INTEGER        NOT NULL DEFAULT 100,
    accent         VARCHAR(20),
    image_url      TEXT,          -- relative /uploads/... URL from the admin Product Master form
    unit           VARCHAR(100)   NOT NULL,  -- packaging unit, e.g. "Strip of 10 Tablets", "1 Litre Bottle"
    unit_description TEXT,        -- longer free-text explanation of the unit
    is_active      BOOLEAN        NOT NULL DEFAULT TRUE
);

-- ── Product schemes ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_schemes (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    seq          SERIAL,       -- display-order only (id is a random UUID and carries no ordering signal)
    product_id   UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label        VARCHAR(150)  NOT NULL,
    scheme_type  VARCHAR(20)   NOT NULL DEFAULT 'buy_get_free',   -- buy_get_free | gift
    buy_qty      INTEGER,
    free_qty     INTEGER,
    min_qty      INTEGER,
    gift_name    VARCHAR(100),
    gift_value   NUMERIC(10,2)
);

-- ── Customers (registered via TM flow) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_type    VARCHAR(30)  NOT NULL,   -- patient | doctor | doctor-pharmacy | hospital
    customer_code    VARCHAR(20)  UNIQUE,     -- <type initials><year><6-digit seq>, e.g. DR2026000001 — see customer_code_sequences
    name             VARCHAR(150) NOT NULL,
    email            VARCHAR(150) UNIQUE NOT NULL,
    mobile           VARCHAR(15)  UNIQUE NOT NULL,
    address          TEXT,
    pin_code         VARCHAR(10),
    city             VARCHAR(100),
    state            VARCHAR(100),
    cfa_code         VARCHAR(20)  REFERENCES cfa_locations(cfa_code),
    division_code    VARCHAR(20),
    sap_customer_code VARCHAR(30),
    sap_code          VARCHAR(30) NOT NULL CHECK (sap_code <> ''),
    approval_status  VARCHAR(30)  NOT NULL DEFAULT 'pending-l1',  -- pending-l1 | approved-l1 | approved | rejected
    registered_by    UUID         REFERENCES users(id),
    registered_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- shared demographic (patient + doctor)
    age                              SMALLINT,
    gender                           VARCHAR(20),
    -- doctor
    registration_number              VARCHAR(100) UNIQUE,
    selected_doctor_dml_code         VARCHAR(50),
    selected_doctor_name             VARCHAR(150),
    selected_doctor_speciality       VARCHAR(100),
    selected_doctor_classification   VARCHAR(50),
    -- doctor-pharmacy + hospital
    gst_number                       VARCHAR(20),
    composition_scheme               BOOLEAN,
    drug_licence_number              VARCHAR(100),
    drug_licence_valid_till          DATE,
    pan_number                       VARCHAR(10)  UNIQUE,
    aadhaar_number                   VARCHAR(12)  UNIQUE,
    -- doctor-pharmacy only
    linked_doctor_dml_code           VARCHAR(50),
    linked_doctor_name               VARCHAR(150),
    linked_doctor_speciality         VARCHAR(100),
    linked_doctor_registration_number VARCHAR(100),  -- manually entered; not in doctor_master_infinity
    selected_pharmacy_cml_code       VARCHAR(50),
    selected_pharmacy_name           VARCHAR(150),
    -- hospital only
    hospital_registration_number     VARCHAR(100)
    -- uploaded documents live in customer_documents (one row per doc_type)
);

-- ── Customer documents (uploaded files, one row per customer + doc_type) ──────
-- Normalized out of customers so new document kinds for future customer types
-- need no schema change — just a new doc_type value. doc_type uses the canonical
-- keys from src/config/divisionRules.js (signedRegistrationForm, gstCertificate,
-- hospitalRegistrationCertificate, drugLicenceCertificate, …).

CREATE TABLE IF NOT EXISTS customer_documents (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    doc_type      VARCHAR(50)  NOT NULL,
    url           TEXT         NOT NULL,
    original_name VARCHAR(255),
    uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, doc_type)
);

-- ── Customer addresses (additional delivery addresses, beyond the single ─────
-- registration address on customers.address/pin_code/city/state) ─────────────
-- Added freely by whoever places an order on the customer's behalf; orders
-- snapshot whichever address was chosen onto orders.delivery_* rather than
-- referencing this table live (see orders below).

CREATE TABLE IF NOT EXISTS customer_addresses (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label        VARCHAR(50),
    address      TEXT         NOT NULL,
    pin_code     VARCHAR(10),
    city         VARCHAR(100),
    state        VARCHAR(100),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Customer approval history ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_approvals (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id       UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    step              INTEGER,
    action            VARCHAR(20)  NOT NULL,   -- approve | reject | resubmit
    approved_by       UUID         REFERENCES users(id),
    approved_by_name  VARCHAR(100),
    approver_usertype VARCHAR(30),             -- acting user's role at time of action, for the "View Log" designation column
    approved_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    reason            TEXT                     -- rejection reason (action = 'reject')
);

-- ── Customer outstanding (SAP balance per customer) ──────────────────────────
-- One row per customer. extra_data mirrors orders.extra_data — it stores the
-- CCAvenue outcome + shareable payment-link token for the customer's Pay Now
-- flow; "paid" is simply outstanding_amount <= 0, no separate status column.

CREATE TABLE IF NOT EXISTS customer_outstanding (
    customerid         UUID          PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    division_code      VARCHAR(20),
    sap_customer_code  VARCHAR(30),
    outstanding_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- Timestamp the balance last moved from <=0 to positive; cleared to NULL
    -- whenever it's settled back to <=0. Not admin-supplied — auto-maintained
    -- by the upload upsert (routes/customer-outstanding.js) and by the
    -- CCAvenue "Pay Now" settlement path (config/ccavenue.js). Drives the
    -- "outstanding days" aging shown in the frontend.
    outstanding_since  TIMESTAMPTZ,
    extra_data          JSONB
);

-- Upsert target for the Excel-upload import (matches "already available" by
-- division + SAP code, not by customerid — see routes/customer-outstanding.js).
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_outstanding_division_sap
  ON customer_outstanding(division_code, sap_customer_code);

-- ── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number          VARCHAR(40)   NOT NULL,   -- human-readable <division_code><year><seq>, see src/utils/orderNumber.js — not the PK
    placed_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    status                VARCHAR(30)   NOT NULL DEFAULT 'processing',  -- processing | Delivered (set once the CFA records LR/dispatch details)
    approval_status       VARCHAR(30)   NOT NULL DEFAULT 'pending-l1',   -- pending-l1 | approved-l1 | approved | rejected
    placed_by             UUID          REFERENCES users(id),
    placed_by_name        VARCHAR(100),
    placed_by_usertype    VARCHAR(30),
    ordering_for_id       UUID,
    ordering_for_name     VARCHAR(150),
    ordering_for_type     VARCHAR(50),
    division_code         VARCHAR(20),
    item_count            INTEGER       NOT NULL DEFAULT 0,
    total_units           INTEGER       NOT NULL DEFAULT 0,
    total_payable         NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_discount        NUMERIC(10,2) NOT NULL DEFAULT 0,
    extra_data            JSONB,        -- division-specific uploaded documents, e.g. prescriptionCopy
    payment_method        VARCHAR(30),  -- pdc-delivery | online | payment-link | post-dated-cheque, when rules.orderEntry.paymentOptions is non-empty
    payment_status        VARCHAR(20)   NOT NULL DEFAULT 'Pending',  -- Pending | Success
    -- Delivery address snapshot, frozen at placement/resubmit time — never a live
    -- join to customers or customer_addresses, so editing either later never
    -- silently rewrites a historical order's recorded delivery address.
    delivery_address      TEXT,
    delivery_pin_code     VARCHAR(10),
    delivery_city         VARCHAR(100),
    delivery_state_code   VARCHAR(10)   REFERENCES state_master(state_code),
    cfa_code              VARCHAR(20)   REFERENCES cfa_locations(cfa_code),
    -- Dispatch details, recorded by the order's CFA once approval_status = 'approved'
    -- (PATCH /api/orders/:id/dispatch, or in bulk via POST /api/orders/dispatch/upload).
    lr_number             VARCHAR(50),
    lr_date               DATE,
    sap_order_number      VARCHAR(40),  -- SAP's own order reference — stored for cross-reference only, never a lookup key
    pod_url               TEXT,         -- proof-of-delivery file, via POST /api/uploads (same convention as other document URLs)
    pod_original_name     VARCHAR(255),
    -- Manual payment confirmation, recorded by the order's CFA for non-online orders
    -- (PATCH /api/orders/:id/payment, or in bulk via POST /api/orders/payment/upload) —
    -- online orders are settled automatically via the CCAvenue callback instead.
    payment_received_date   DATE,
    payment_received_amount NUMERIC(10,2)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_order_number ON orders(order_number);

-- ── Order line items ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    seq            SERIAL,        -- display-order only (id is a random UUID and carries no ordering signal)
    order_id       UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id     UUID           REFERENCES products(id),
    product_name   VARCHAR(150),
    material_code  VARCHAR(50),
    quantity       INTEGER        NOT NULL,
    free_qty       INTEGER        NOT NULL DEFAULT 0,
    unit_price     NUMERIC(10,2),
    scheme_label   VARCHAR(150),
    discount_value NUMERIC(10,2)  NOT NULL DEFAULT 0,
    line_total     NUMERIC(10,2)
);

-- ── Order approval history ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_approvals (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    step              INTEGER,
    action            VARCHAR(20)  NOT NULL,   -- place | approve | reject | resubmit | dispatch | payment-update
    approved_by       UUID         REFERENCES users(id),
    approved_by_name  VARCHAR(100),
    approver_usertype VARCHAR(30),             -- acting user's role at time of action, for the "View Log" designation column
    approved_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    reason            TEXT                     -- rejection reason (action = 'reject'); remarks (action = 'place' | 'resubmit')
);

-- ── Payment log (full history of CCAvenue attempts, order + customer outstanding) ──
-- Append-only — orders.extra_data.ccavenue / customer_outstanding.extra_data.ccavenue
-- still keep only the latest outcome (for the inline "current status" displays); this
-- table is the only place every attempt (Initiated, Success, Failure, Aborted) survives.

CREATE TABLE IF NOT EXISTS payment_log (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type    VARCHAR(10)  NOT NULL,   -- order | customer
    subject_id      UUID         NOT NULL,   -- orders.id or customers.id, depending on subject_type
    status          VARCHAR(20)  NOT NULL,   -- Initiated | Success | Failure | Aborted | Selected | Changed
    payment_method  VARCHAR(30),             -- pdc-delivery | online | payment-link | post-dated-cheque, set for Selected/Changed rows
    payment_mode    VARCHAR(30),
    tracking_id     VARCHAR(100),
    bank_ref_no     VARCHAR(100),
    failure_message TEXT,
    raw_response    JSONB,
    recorded_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_log_subject ON payment_log(subject_type, subject_id);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_customers_approval_status  ON customers(approval_status);
CREATE INDEX IF NOT EXISTS idx_customers_registered_by    ON customers(registered_by);
-- Partial (not a plain UNIQUE column) — composition-scheme registrations
-- store gst_number as '' (see POST /customers' `gst_number ?? null`), and a
-- plain UNIQUE column would reject a second such row as a duplicate blank.
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_gst_number
  ON customers(gst_number) WHERE gst_number IS NOT NULL AND gst_number != '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_drug_licence_number
  ON customers(drug_licence_number) WHERE drug_licence_number IS NOT NULL AND drug_licence_number != '';
CREATE INDEX IF NOT EXISTS idx_customer_documents_customer_id ON customer_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_outstanding_division ON customer_outstanding(division_code);
CREATE INDEX IF NOT EXISTS idx_orders_approval_status     ON orders(approval_status);
CREATE INDEX IF NOT EXISTS idx_orders_placed_by           ON orders(placed_by);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id       ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_product_schemes_product_id ON product_schemes(product_id);
CREATE INDEX IF NOT EXISTS idx_doctor_master_d2d_division  ON doctor_master_infinity(d2d_division_code);
CREATE INDEX IF NOT EXISTS idx_chemist_master_d2d_division ON chemist_master_infinity(d2d_division_code);
CREATE INDEX IF NOT EXISTS idx_field_structure_d2d_division ON field_structure_infinity(d2d_division_code);
CREATE INDEX IF NOT EXISTS idx_sync_history_type_division ON sync_history(sync_type, division_code);
