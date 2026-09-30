import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import pool from '../db/pool.js'
import { authorize } from '../middleware/auth.js'
import { ADMIN_MANAGED_USERTYPES } from '../config/adminUsertypes.js'

const router = Router()

const INFINITY_BASE_URL = (process.env.INFINITY_BASE_URL || 'https://infinityplus.wockhardt.com/plus/reports').replace(/\/+$/, '')
const INFINITY_REPORT_BASE_URL = (process.env.INFINITY_REPORT_BASE_URL || 'https://infinityplus.wockhardt.com/plus/report').replace(/\/+$/, '')

// Optional auth header for the Infinity API — set both INFINITY_API_HEADER_NAME
// and INFINITY_API_TOKEN in .env to send it; omitted entirely otherwise.
function infinityHeaders() {
  const headerName = process.env.INFINITY_API_HEADER_NAME
  const token = process.env.INFINITY_API_TOKEN
  return headerName && token ? { [headerName]: token } : {}
}

export async function getInfinityDivisionCode(divisionCode) {
  const { rows } = await pool.query(
    `SELECT infinity_division_code FROM division_mapping
     WHERE division_code = $1 AND infinity_division_code IS NOT NULL
     LIMIT 1`,
    [divisionCode]
  )
  return rows[0]?.infinity_division_code ?? null
}

// Records one row per sync job run (success or failure) for the "View Sync
// History" panel. Never throws — a logging failure must not mask the real
// sync result or break the route's next(err) error-handling contract.
export async function recordSyncHistory(pool, { syncType, divisionCode, status, recordCount, skippedCount, deactivatedCount, errorMessage, runBy, runByName }) {
  try {
    await pool.query(
      `INSERT INTO sync_history
         (sync_type, division_code, status, record_count, skipped_count, deactivated_count, error_message, run_by, run_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [syncType, divisionCode ?? null, status, recordCount ?? null, skippedCount ?? null, deactivatedCount ?? null, errorMessage ?? null, runBy ?? null, runByName ?? null]
    )
  } catch (e) {
    console.error('Failed to record sync history:', e)
  }
}

// GET /masters/doctors  — search doctor_master_infinity; supports q (name search), division_code, sap_code, location
// Returns all matching doctors; is_registered=true when a 'doctor' customer record already
// exists for that doctor+division; is_linked_to_pharmacy=true when a 'doctor-pharmacy'
// customer already lists them as its linked doctor — a doctor can be one or the other,
// never both (see DoctorForm.jsx / PharmacyForm.jsx, which disable on either flag).
// exclude_customer_id excludes one customer row from both checks — used when editing/
// resubmitting a registration so it doesn't see its own self-registration or link as taken.
router.get('/doctors', authorize('tm', 'rm', 'zsm', 'nsm', 'admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const { q, division_code, sap_code, location, exclude_customer_id } = req.query
    const conditions = []
    const params = []

    if (q)             { conditions.push(`d.doctor_name ILIKE $${params.length + 1}`);      params.push(`%${q}%`) }
    if (division_code) { conditions.push(`d.d2d_division_code = $${params.length + 1}`);    params.push(division_code) }
    if (sap_code)      { conditions.push(`d.sap_code = $${params.length + 1}`);             params.push(sap_code) }
    if (location)      { conditions.push(`TRIM(d.location) = TRIM($${params.length + 1})`); params.push(location) }

    let excludeC1 = ''
    let excludeC2 = ''
    if (exclude_customer_id) {
      params.push(exclude_customer_id)
      excludeC1 = `AND c1.id != $${params.length}`
      excludeC2 = `AND c2.id != $${params.length}`
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT d.*,
              (c1.id IS NOT NULL) AS is_registered,
              (c2.id IS NOT NULL) AS is_linked_to_pharmacy
       FROM doctor_master_infinity d
       LEFT JOIN customers c1
         ON  c1.selected_doctor_dml_code = d.doctor_code
         AND c1.division_code             = d.division_code
         AND c1.customer_type             = 'doctor'
         ${excludeC1}
       LEFT JOIN customers c2
         ON  c2.linked_doctor_dml_code = d.doctor_code
         AND c2.division_code          = d.division_code
         AND c2.customer_type          = 'doctor-pharmacy'
         ${excludeC2}
       ${where}
       ORDER BY d.doctor_name
       LIMIT 20`,
      params
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /masters/chemists  — search chemist_master_infinity; supports q (name search), division_code, sap_code, location
// Returns all matching chemists; is_registered=true when a customer record already exists for that chemist+division.
router.get('/chemists', authorize('tm', 'rm', 'zsm', 'nsm', 'admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const { q, division_code, sap_code, location } = req.query
    const conditions = []
    const params = []

    if (q)             { conditions.push(`c2.chemist_name ILIKE $${params.length + 1}`);      params.push(`%${q}%`) }
    if (division_code) { conditions.push(`c2.d2d_division_code = $${params.length + 1}`);     params.push(division_code) }
    if (sap_code)      { conditions.push(`c2.sap_code = $${params.length + 1}`);              params.push(sap_code) }
    if (location)      { conditions.push(`TRIM(c2.location) = TRIM($${params.length + 1})`);  params.push(location) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT c2.*, (cu.id IS NOT NULL) AS is_registered
       FROM chemist_master_infinity c2
       LEFT JOIN customers cu
         ON  cu.selected_pharmacy_cml_code = c2.chemist_code
         AND cu.division_code               = c2.division_code
         AND cu.customer_type               = 'doctor-pharmacy'
       ${where}
       ORDER BY c2.chemist_name
       LIMIT 20`,
      params
    )
    res.json(rows)
  } catch (err) { next(err) }
})

const BROWSE_PAGE_SIZE_DEFAULT = 20

// Resolves the generic `code`/`name`/`type`/`location`/`mobile`/`email` sort key each
// browse endpoint's frontend uses (see mastersApi.browseDoctors/browseChemists/
// browseFieldStructure in frontend/src/lib/api.js) to that endpoint's real DB column,
// via a safelist — never interpolate req.query.sort_by directly into SQL.
function resolveBrowseSort(safelist, query, defaultColumn) {
  const column = safelist[query.sort_by] ?? defaultColumn
  const dir = query.sort_dir === 'desc' ? 'DESC' : 'ASC'
  return { column, dir }
}

// GET /masters/doctors/browse?division_code=&q=&page=&pageSize=&sort_by=&sort_dir=  —
// admin-only paginated browse of doctor_master_infinity (unlike GET /doctors above,
// this has no LIMIT 20 cap and is meant for the "View Records" admin screen, not the
// registration-time autocomplete).
router.get('/doctors/browse', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const { q } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.max(1, Number(req.query.pageSize) || BROWSE_PAGE_SIZE_DEFAULT)
    const { column: sortColumn, dir: sortDir } = resolveBrowseSort(
      { code: 'doctor_code', name: 'doctor_name', type: 'doctor_speciality', location: 'location', mobile: 'mobile', email: 'email_id' },
      req.query, 'doctor_name'
    )

    const conditions = []
    const params = []
    if (division_code) { conditions.push(`d2d_division_code = $${params.length + 1}`); params.push(division_code) }
    if (q) {
      conditions.push(`(doctor_name ILIKE $${params.length + 1} OR doctor_code ILIKE $${params.length + 1} OR location ILIKE $${params.length + 1})`)
      params.push(`%${q}%`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM doctor_master_infinity ${where}`, params)
    const { rows } = await pool.query(
      `SELECT doctor_code, doctor_name, doctor_speciality, location, mobile, email_id
       FROM doctor_master_infinity ${where}
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ rows, total: Number(countRows[0].count) })
  } catch (err) { next(err) }
})

// GET /masters/chemists/browse?division_code=&q=&page=&pageSize=&sort_by=&sort_dir=  —
// same as doctors/browse, for chemist_master_infinity.
router.get('/chemists/browse', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const { q } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.max(1, Number(req.query.pageSize) || BROWSE_PAGE_SIZE_DEFAULT)
    const { column: sortColumn, dir: sortDir } = resolveBrowseSort(
      { code: 'chemist_code', name: 'chemist_name', type: 'chemist_classification', location: 'location', mobile: 'mobile', email: 'email_id' },
      req.query, 'chemist_name'
    )

    const conditions = []
    const params = []
    if (division_code) { conditions.push(`d2d_division_code = $${params.length + 1}`); params.push(division_code) }
    if (q) {
      conditions.push(`(chemist_name ILIKE $${params.length + 1} OR chemist_code ILIKE $${params.length + 1} OR location ILIKE $${params.length + 1})`)
      params.push(`%${q}%`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM chemist_master_infinity ${where}`, params)
    const { rows } = await pool.query(
      `SELECT chemist_code, chemist_name, chemist_classification, location, mobile, email_id
       FROM chemist_master_infinity ${where}
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ rows, total: Number(countRows[0].count) })
  } catch (err) { next(err) }
})

// GET /masters/field-structure/browse?division_code=&q=&page=&pageSize=&sort_by=&sort_dir=
// — same as doctors/browse, for field_structure_infinity. Note this table's contact
// columns are `mobile`/`email`, not `mobile_no`/`email_id` like the master tables above.
router.get('/field-structure/browse', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const { q } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.max(1, Number(req.query.pageSize) || BROWSE_PAGE_SIZE_DEFAULT)
    const { column: sortColumn, dir: sortDir } = resolveBrowseSort(
      { code: 'emp_code', name: 'emp_name', type: 'emp_location_type', location: 'emp_location', mobile: 'mobile', email: 'email' },
      req.query, 'emp_name'
    )

    const conditions = []
    const params = []
    if (division_code) { conditions.push(`d2d_division_code = $${params.length + 1}`); params.push(division_code) }
    if (q) {
      conditions.push(`(emp_name ILIKE $${params.length + 1} OR emp_code ILIKE $${params.length + 1} OR emp_location ILIKE $${params.length + 1})`)
      params.push(`%${q}%`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM field_structure_infinity ${where}`, params)
    const { rows } = await pool.query(
      `SELECT emp_code, emp_name, emp_location_type, emp_location, mobile, email
       FROM field_structure_infinity ${where}
       ORDER BY ${sortColumn} ${sortDir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ rows, total: Number(countRows[0].count) })
  } catch (err) { next(err) }
})

// POST /masters/sync/doctors  { division_code }  — pulls the Doctor Master List
// from Infinity for the division and upserts it into doctor_master_infinity.
// Columns map 1:1 to the Infinity DML API field names (camelCase -> snake_case);
// d2d_division_code is the only column not present in the API response.
router.post('/sync/doctors', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  const { division_code } = req.body
  const run_by = req.user.id
  const run_by_name = req.user.name
  try {
    if (!division_code) {
      await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'error', errorMessage: 'division_code is required', runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: 'division_code is required' })
    }

    const infinityDivisionCode = await getInfinityDivisionCode(division_code)
    if (!infinityDivisionCode) {
      const errorMessage = `No Infinity division mapping configured for ${division_code}`
      await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const response = await fetch(`${INFINITY_BASE_URL}/customer/dml/${infinityDivisionCode}`, { headers: infinityHeaders() })
    if (!response.ok) {
      const errorMessage = `Infinity DML API responded ${response.status}`
      await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }
    const records = await response.json()
    if (!Array.isArray(records)) {
      const errorMessage = 'Infinity DML API returned an unexpected response'
      await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }

    // Clear out this division's existing rows first so a re-sync doesn't leave
    // stale records behind for doctors no longer returned by the API.
    await pool.query('DELETE FROM doctor_master_infinity WHERE d2d_division_code = $1', [division_code])

    const skippedRows = []
    let count = 0
    for (const r of records) {
      try {
        await pool.query(
          `INSERT INTO doctor_master_infinity
             (doctor_id, division_code, division, zone, region, location_id, location,
              employee_code, employee_name, doctor_uid, doctor_code, doctor_name,
              doctor_speciality, doctor_classification, address_line1, address_line2,
              state, town, beat, email_id, mobile, created_on, dispensing, town_type,
              activities, employee_date_of_joining, sap_code, sap_name, pin_code, fees,
              follow_up_fees, practising_days, call_days, call_place, call_time, mirror_hq,
              req_visit_frequency, profile_update_status, dispensing_type, pbrands, d2d_division_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
                   $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)
           ON CONFLICT (doctor_id) DO UPDATE SET
             division_code = EXCLUDED.division_code, division = EXCLUDED.division, zone = EXCLUDED.zone,
             region = EXCLUDED.region, location_id = EXCLUDED.location_id, location = EXCLUDED.location,
             employee_code = EXCLUDED.employee_code, employee_name = EXCLUDED.employee_name,
             doctor_uid = EXCLUDED.doctor_uid, doctor_code = EXCLUDED.doctor_code, doctor_name = EXCLUDED.doctor_name,
             doctor_speciality = EXCLUDED.doctor_speciality, doctor_classification = EXCLUDED.doctor_classification,
             address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
             state = EXCLUDED.state, town = EXCLUDED.town, beat = EXCLUDED.beat, email_id = EXCLUDED.email_id,
             mobile = EXCLUDED.mobile, created_on = EXCLUDED.created_on, dispensing = EXCLUDED.dispensing,
             town_type = EXCLUDED.town_type, activities = EXCLUDED.activities,
             employee_date_of_joining = EXCLUDED.employee_date_of_joining, sap_code = EXCLUDED.sap_code,
             sap_name = EXCLUDED.sap_name, pin_code = EXCLUDED.pin_code, fees = EXCLUDED.fees,
             follow_up_fees = EXCLUDED.follow_up_fees, practising_days = EXCLUDED.practising_days,
             call_days = EXCLUDED.call_days, call_place = EXCLUDED.call_place, call_time = EXCLUDED.call_time,
             mirror_hq = EXCLUDED.mirror_hq, req_visit_frequency = EXCLUDED.req_visit_frequency,
             profile_update_status = EXCLUDED.profile_update_status, dispensing_type = EXCLUDED.dispensing_type,
             pbrands = EXCLUDED.pbrands, d2d_division_code = EXCLUDED.d2d_division_code`,
          [
            r.doctorId, r.divisionCode, r.division, r.zone, r.region, r.locationId, r.location,
            r.employeeCode, r.employeeName, r.doctorUid, r.doctorCode, r.doctorName,
            r.doctorSpeciality, r.doctorClassification, r.addressLine1 || null, r.addressLine2 || null,
            r.state, r.town, r.beat, r.emailId || null, r.mobile || null, r.createdOn,
            r.dispensing || null, r.townType, r.activities ?? null, r.employeeDateOfJoining,
            r.sapCode, r.sapName, r.pinCode, r.fees, r.followUpFees, r.practisingDays ?? null,
            r.callDays || null, r.callPlace, r.callTime, r.mirrorHq, r.reqVisitFrequency,
            r.profileUpdateStatus, r.dispensingType, r.pbrands ?? null, division_code,
          ]
        )
        count++
      } catch (err) {
        skippedRows.push({ doctorId: r.doctorId ?? null, name: r.doctorName ?? null, reason: err.message })
      }
    }

    await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'success', recordCount: count, skippedCount: skippedRows.length, runBy: run_by, runByName: run_by_name })
    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) {
    await recordSyncHistory(pool, { syncType: 'doctors', divisionCode: division_code, status: 'error', errorMessage: err.message, runBy: run_by, runByName: run_by_name })
    next(err)
  }
})

// POST /masters/sync/chemists  { division_code }  — pulls the Chemist Master List
// from Infinity for the division and upserts it into chemist_master_infinity.
// Columns map 1:1 to the Infinity CML API field names (camelCase -> snake_case);
// d2d_division_code is the only column not present in the API response.
router.post('/sync/chemists', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  const { division_code } = req.body
  const run_by = req.user.id
  const run_by_name = req.user.name
  try {
    if (!division_code) {
      await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'error', errorMessage: 'division_code is required', runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: 'division_code is required' })
    }

    const infinityDivisionCode = await getInfinityDivisionCode(division_code)
    if (!infinityDivisionCode) {
      const errorMessage = `No Infinity division mapping configured for ${division_code}`
      await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const response = await fetch(`${INFINITY_BASE_URL}/customer/cml/${infinityDivisionCode}`, { headers: infinityHeaders() })
    if (!response.ok) {
      const errorMessage = `Infinity CML API responded ${response.status}`
      await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }
    const records = await response.json()
    if (!Array.isArray(records)) {
      const errorMessage = 'Infinity CML API returned an unexpected response'
      await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }

    // Clear out this division's existing rows first so a re-sync doesn't leave
    // stale records behind for chemists no longer returned by the API.
    await pool.query('DELETE FROM chemist_master_infinity WHERE d2d_division_code = $1', [division_code])

    const skippedRows = []
    let count = 0
    for (const r of records) {
      try {
        await pool.query(
          `INSERT INTO chemist_master_infinity
             (chemist_id, division_code, division, zone, region, location, sap_code, sap_name,
              employee_code, employee_name, chemist_code, chemist_name, chemist_classification,
              address_line1, address_line2, state, town, beat, email_id, mobile, town_type,
              date_of_shop_opening, date_of_anniversary, creation_date, customer_type, date_of_birth,
              d2d_division_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
           ON CONFLICT (chemist_id) DO UPDATE SET
             division_code = EXCLUDED.division_code, division = EXCLUDED.division, zone = EXCLUDED.zone,
             region = EXCLUDED.region, location = EXCLUDED.location, sap_code = EXCLUDED.sap_code,
             sap_name = EXCLUDED.sap_name, employee_code = EXCLUDED.employee_code,
             employee_name = EXCLUDED.employee_name, chemist_code = EXCLUDED.chemist_code,
             chemist_name = EXCLUDED.chemist_name, chemist_classification = EXCLUDED.chemist_classification,
             address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
             state = EXCLUDED.state, town = EXCLUDED.town, beat = EXCLUDED.beat, email_id = EXCLUDED.email_id,
             mobile = EXCLUDED.mobile, town_type = EXCLUDED.town_type,
             date_of_shop_opening = EXCLUDED.date_of_shop_opening, date_of_anniversary = EXCLUDED.date_of_anniversary,
             creation_date = EXCLUDED.creation_date, customer_type = EXCLUDED.customer_type,
             date_of_birth = EXCLUDED.date_of_birth, d2d_division_code = EXCLUDED.d2d_division_code`,
          [
            r.chemistId, r.divisionCode, r.division, r.zone, r.region, r.location, r.sapCode, r.sapName,
            r.employeeCode, r.employeeName, r.chemistCode, r.chemistName, r.chemistClassification,
            r.addressLine1 || null, r.addressLine2 || null, r.state, r.town, r.beat,
            r.emailId || null, r.mobile || null, r.townType,
            r.dateOfShopOpening || null, r.dateOfAnniversary || null, r.creationDate,
            r.customerType, r.dateOfBirth || null, division_code,
          ]
        )
        count++
      } catch (err) {
        skippedRows.push({ chemistId: r.chemistId ?? null, name: r.chemistName ?? null, reason: err.message })
      }
    }

    await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'success', recordCount: count, skippedCount: skippedRows.length, runBy: run_by, runByName: run_by_name })
    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) {
    await recordSyncHistory(pool, { syncType: 'chemists', divisionCode: division_code, status: 'error', errorMessage: err.message, runBy: run_by, runByName: run_by_name })
    next(err)
  }
})

// POST /masters/sync/field-structure  { division_code }  — pulls the Field
// Structure report from Infinity for the division and upserts it into
// field_structure_infinity. Columns map 1:1 to the Infinity field-structure API
// field names (camelCase -> snake_case); d2d_division_code is the only column
// not present in the API response.
router.post('/sync/field-structure', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  const { division_code } = req.body
  const run_by = req.user.id
  const run_by_name = req.user.name
  try {
    if (!division_code) {
      await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'error', errorMessage: 'division_code is required', runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: 'division_code is required' })
    }

    const infinityDivisionCode = await getInfinityDivisionCode(division_code)
    if (!infinityDivisionCode) {
      const errorMessage = `No Infinity division mapping configured for ${division_code}`
      await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: errorMessage })
    }

    const response = await fetch(`${INFINITY_REPORT_BASE_URL}/filed-structure/${infinityDivisionCode}`, { headers: infinityHeaders() })
    if (!response.ok) {
      const errorMessage = `Infinity field-structure API responded ${response.status}`
      await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }
    const records = await response.json()
    if (!Array.isArray(records)) {
      const errorMessage = 'Infinity field-structure API returned an unexpected response'
      await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'error', errorMessage, runBy: run_by, runByName: run_by_name })
      return res.status(502).json({ error: errorMessage })
    }

    // Clear out this division's existing rows first so a re-sync doesn't leave
    // stale records behind for field locations no longer returned by the API.
    await pool.query('DELETE FROM field_structure_infinity WHERE d2d_division_code = $1', [division_code])

    const skippedRows = []
    let count = 0
    for (const r of records) {
      try {
        await pool.query(
          `INSERT INTO field_structure_infinity
             (tm_location_id, division, division_code, manager1_code, manager1_name, manager1_location_id,
              manager1_location, manager1_location_type, manager1_sap_code, manager1_sap_name,
              manager2_code, manager2_name, manager2_location_id, manager2_location, manager2_location_type,
              manager2_sap_code, manager2_sap_name, emp_code, emp_name, emp_location, emp_location_type,
              sap_code, sap_name, mirror_hq, emp_job_role, job_role_id, emp_doj, emp_dob, active_from,
              active_to, email, mobile, corporate_mobile, emp_id, town, state, whatsapp_consent_detail,
              d2d_division_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
                   $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
           ON CONFLICT (tm_location_id) DO UPDATE SET
             division = EXCLUDED.division, division_code = EXCLUDED.division_code,
             manager1_code = EXCLUDED.manager1_code, manager1_name = EXCLUDED.manager1_name,
             manager1_location_id = EXCLUDED.manager1_location_id, manager1_location = EXCLUDED.manager1_location,
             manager1_location_type = EXCLUDED.manager1_location_type, manager1_sap_code = EXCLUDED.manager1_sap_code,
             manager1_sap_name = EXCLUDED.manager1_sap_name, manager2_code = EXCLUDED.manager2_code,
             manager2_name = EXCLUDED.manager2_name, manager2_location_id = EXCLUDED.manager2_location_id,
             manager2_location = EXCLUDED.manager2_location, manager2_location_type = EXCLUDED.manager2_location_type,
             manager2_sap_code = EXCLUDED.manager2_sap_code, manager2_sap_name = EXCLUDED.manager2_sap_name,
             emp_code = EXCLUDED.emp_code, emp_name = EXCLUDED.emp_name, emp_location = EXCLUDED.emp_location,
             emp_location_type = EXCLUDED.emp_location_type, sap_code = EXCLUDED.sap_code, sap_name = EXCLUDED.sap_name,
             mirror_hq = EXCLUDED.mirror_hq, emp_job_role = EXCLUDED.emp_job_role, job_role_id = EXCLUDED.job_role_id,
             emp_doj = EXCLUDED.emp_doj, emp_dob = EXCLUDED.emp_dob, active_from = EXCLUDED.active_from,
             active_to = EXCLUDED.active_to, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
             corporate_mobile = EXCLUDED.corporate_mobile, emp_id = EXCLUDED.emp_id, town = EXCLUDED.town,
             state = EXCLUDED.state, whatsapp_consent_detail = EXCLUDED.whatsapp_consent_detail,
             d2d_division_code = EXCLUDED.d2d_division_code`,
          [
            r.tmLocationId, r.division, r.divisionCode, r.manager1Code, r.manager1Name, r.manager1LocationId,
            r.manager1Location, r.manager1LocationType, r.manager1SapCode, r.manager1SapName,
            r.manager2Code, r.manager2Name, r.manager2LocationId, r.manager2Location, r.manager2LocationType,
            r.manager2SapCode, r.manager2SapName, r.empCode, r.empName, r.empLocation, r.empLocationType,
            r.sapCode, r.sapName, r.mirrorHq, r.empJobRole, r.jobRoleId, r.empDOJ, r.empDOB, r.activeFrom || null,
            r.activeTo || null, r.email || null, r.mobile || null, r.corporateMobile || null, r.empId, r.town,
            r.state, r.whatsappConsentDetail, division_code,
          ]
        )
        count++
      } catch (err) {
        skippedRows.push({ empCode: r.empCode ?? null, name: r.empName ?? null, reason: err.message })
      }
    }

    await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'success', recordCount: count, skippedCount: skippedRows.length, runBy: run_by, runByName: run_by_name })
    res.json({ success: true, count, skipped: skippedRows.length, skippedRows })
  } catch (err) {
    await recordSyncHistory(pool, { syncType: 'field-structure', divisionCode: division_code, status: 'error', errorMessage: err.message, runBy: run_by, runByName: run_by_name })
    next(err)
  }
})

// POST /masters/sync/users  { division_code }  — provisions/updates TM/RM/ZSM/NSM
// login accounts in `users` from vw_infinity_users (derived from vw_tm_hierarchy, which
// resolves each employee's mobile/email via vw_emp_email_mobile — sourced directly from
// field_structure_infinity, not field_user_details). Each view row becomes one
// users row, keyed by empcode; OTP login defaults to the dev fixed OTP.
// mm/dm authenticate via password (POST /auth/password), not OTP — see
// backend/src/routes/auth.js PASSWORD_TYPES. admin/cfa never appear in
// vw_infinity_users so aren't handled here.
const SYNC_SALT_ROUNDS = 10
const PASSWORD_TYPES = new Set(['mm', 'dm'])
// Dev default password for synced mm/dm accounts, mirroring the fixed dev
// OTP '123456' used for other synced roles.
const SYNC_DEFAULT_PASSWORD = 'Wockhardt@123'

router.post('/sync/users', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  const { division_code } = req.body
  const run_by = req.user.id
  const run_by_name = req.user.name
  try {
    if (!division_code) {
      await recordSyncHistory(pool, { syncType: 'users', divisionCode: division_code, status: 'error', errorMessage: 'division_code is required', runBy: run_by, runByName: run_by_name })
      return res.status(400).json({ error: 'division_code is required' })
    }

    const { rows } = await pool.query(
      'SELECT * FROM vw_infinity_users WHERE division_code = $1',
      [division_code]
    )

    const defaultPasswordHash = await bcrypt.hash(SYNC_DEFAULT_PASSWORD, SYNC_SALT_ROUNDS)

    let count = 0
    const skippedRows = []
    for (const r of rows) {
      if (!r.empcode || !r.mobile_no) {
        skippedRows.push({ empCode: r.empcode ?? null, name: r.user_name ?? null, reason: 'Missing empcode or mobile number' })
        continue
      }
      try {
        const usertype = r.user_type.toLowerCase()
        const isPasswordType = PASSWORD_TYPES.has(usertype)
        const otp = isPasswordType ? null : '123456'
        const passwordHash = isPasswordType ? defaultPasswordHash : null

        const { rows: existing } = await pool.query('SELECT id FROM users WHERE empcode = $1', [r.empcode])
        const id = existing.length ? existing[0].id : crypto.randomUUID()

        await pool.query(
          `INSERT INTO users (id, usertype, name, mobileno, otp, password_hash, division_code, email, sap_code, empcode, user_location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (empcode) DO UPDATE SET
             usertype = EXCLUDED.usertype, name = EXCLUDED.name,
             mobileno = EXCLUDED.mobileno, otp = EXCLUDED.otp,
             password_hash = EXCLUDED.password_hash, division_code = EXCLUDED.division_code,
             email = EXCLUDED.email, sap_code = EXCLUDED.sap_code, user_location = EXCLUDED.user_location,
             is_active = TRUE`,
          [id, usertype, r.user_name, r.mobile_no, otp, passwordHash, r.division_code, r.email_id || null, r.sapcode || null, r.empcode, r.user_location || null]
        )
        count++
      } catch (err) {
        skippedRows.push({ empCode: r.empcode ?? null, name: r.user_name ?? null, reason: err.message })
      }
    }

    // Anyone who previously got an account from this sync but has since dropped
    // out of vw_infinity_users (left, transferred, restructured in Infinity) is
    // deactivated rather than deleted — login is blocked via the is_active check
    // in auth.js, but the account/history stays intact in case they reappear,
    // in which case the upsert above reactivates them automatically.
    const { rows: deactivatedRows } = await pool.query(
      `UPDATE users
       SET is_active = FALSE
       WHERE usertype IN ('tm', 'rm', 'zsm', 'nsm')
         AND division_code = $1
         AND is_active = TRUE
         AND empcode IS NOT NULL
         AND empcode NOT IN (SELECT empcode FROM vw_infinity_users WHERE division_code = $1 AND empcode IS NOT NULL)
       RETURNING empcode`,
      [division_code]
    )
    const deactivated = deactivatedRows.length

    await recordSyncHistory(pool, { syncType: 'users', divisionCode: division_code, status: 'success', recordCount: count, skippedCount: skippedRows.length, deactivatedCount: deactivated, runBy: run_by, runByName: run_by_name })
    res.json({ success: true, count, skipped: skippedRows.length, deactivated, skippedRows })
  } catch (err) {
    await recordSyncHistory(pool, { syncType: 'users', divisionCode: division_code, status: 'error', errorMessage: err.message, runBy: run_by, runByName: run_by_name })
    next(err)
  }
})

// GET /masters/counts?division_code=...  — record counts for each
// Infinity Master Sync card on the admin dashboard. admin/bu-head are confined
// to their own division; only super-admin can omit division_code for an
// all-divisions total.
router.get('/counts', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const divisionParams = division_code ? [division_code] : []
    const masterFilter = division_code ? 'WHERE d2d_division_code = $1' : ''
    const divisionCodeFilter = division_code ? 'WHERE division_code = $1' : ''
    const [doctors, chemists, fieldStructure, users, adminUsers, customerOutstanding] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM doctor_master_infinity ${masterFilter}`, divisionParams),
      pool.query(`SELECT COUNT(*) FROM chemist_master_infinity ${masterFilter}`, divisionParams),
      pool.query(`SELECT COUNT(*) FROM field_structure_infinity ${masterFilter}`, divisionParams),
      pool.query(
        `SELECT COUNT(*) FROM users WHERE usertype IN ('tm','rm','zsm','nsm') AND is_active = TRUE${division_code ? ' AND division_code = $1' : ''}`,
        divisionParams
      ),
      pool.query(
        `SELECT COUNT(*) FROM users WHERE usertype = ANY($1)${division_code ? ' AND division_code = $2' : ''}`,
        division_code ? [ADMIN_MANAGED_USERTYPES, division_code] : [ADMIN_MANAGED_USERTYPES]
      ),
      pool.query(`SELECT COUNT(*) FROM customer_outstanding ${divisionCodeFilter}`, divisionParams),
    ])
    res.json({
      doctors: Number(doctors.rows[0].count),
      chemists: Number(chemists.rows[0].count),
      fieldStructure: Number(fieldStructure.rows[0].count),
      users: Number(users.rows[0].count),
      adminUsers: Number(adminUsers.rows[0].count),
      customerOutstanding: Number(customerOutstanding.rows[0].count),
    })
  } catch (err) { next(err) }
})

// GET /masters/directory-counts?location=...&division_code=...  — how many
// doctors/chemists are available in a TM's location (and division), for the
// "registered vs available" summary on the registration page.
router.get('/directory-counts', authorize('tm', 'rm', 'zsm', 'nsm', 'admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const { location, division_code } = req.query
    if (!location) return res.json({ doctorsAvailable: 0, chemistsAvailable: 0 })

    const conditions = ['TRIM(location) = TRIM($1)']
    const params = [location]
    if (division_code) { conditions.push(`d2d_division_code = $${params.length + 1}`); params.push(division_code) }
    const where = `WHERE ${conditions.join(' AND ')}`

    const [doctors, chemists] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM doctor_master_infinity ${where}`, params),
      pool.query(`SELECT COUNT(*) FROM chemist_master_infinity ${where}`, params),
    ])
    res.json({
      doctorsAvailable: Number(doctors.rows[0].count),
      chemistsAvailable: Number(chemists.rows[0].count),
    })
  } catch (err) { next(err) }
})

// GET /masters/sync-history?division_code=&sync_type=&limit=  — audit
// trail of Infinity Master Sync job runs for the "View Sync History" panel.
// admin/bu-head are confined to their own division; only super-admin can omit
// division_code for an all-divisions view.
router.get('/sync-history', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const { sync_type, limit } = req.query
    const conditions = []
    const params = []
    if (division_code) { conditions.push(`division_code = $${params.length + 1}`); params.push(division_code) }
    if (sync_type)      { conditions.push(`sync_type = $${params.length + 1}`);     params.push(sync_type) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const cappedLimit = Math.min(Number(limit) || 100, 500)
    const { rows } = await pool.query(
      `SELECT * FROM sync_history ${where} ORDER BY run_at DESC LIMIT $${params.length + 1}`,
      [...params, cappedLimit]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

// GET /masters/login-history?division_code=&status=&login_method=&limit=
// — audit trail of login attempts (success and failed) for the "Login History" panel.
router.get('/login-history', authorize('admin', 'bu-head', 'super-admin'), async (req, res, next) => {
  try {
    const division_code = req.user.usertype === 'super-admin' ? req.query.division_code : req.user.divisionCode
    const { status, login_method, limit } = req.query
    const conditions = []
    const params = []
    if (division_code) { conditions.push(`division_code = $${params.length + 1}`); params.push(division_code) }
    if (status)        { conditions.push(`status = $${params.length + 1}`);        params.push(status) }
    if (login_method)  { conditions.push(`login_method = $${params.length + 1}`);  params.push(login_method) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const cappedLimit = Math.min(Number(limit) || 100, 500)
    const { rows } = await pool.query(
      `SELECT * FROM login_history ${where} ORDER BY logged_in_at DESC LIMIT $${params.length + 1}`,
      [...params, cappedLimit]
    )
    res.json(rows)
  } catch (err) { next(err) }
})

export default router
