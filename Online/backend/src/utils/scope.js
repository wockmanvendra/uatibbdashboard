import pool from '../db/pool.js'

const NEVER_MATCH_UUID = '00000000-0000-0000-0000-000000000000'

const SUBORDINATE_EMPCODE_COLUMNS = {
  rm:  ['tm_empcode'],
  zsm: ['tm_empcode', 'rm_empcode'],
  nsm: ['tm_empcode', 'rm_empcode', 'zsm_empcode'],
}

// Resolves which users.id values a tm/rm/zsm/nsm is allowed to see data
// "entered by" (registered_by / placed_by) — always includes the caller's own
// id. rm/zsm/nsm are resolved via vw_tm_hierarchy, scoped to both their own
// empcode column AND their own division_code — a hierarchy row from another
// division must never widen this user's visibility.
export async function resolveHierarchyUserIds(user) {
  if (user.usertype === 'tm') return [user.id]

  const empcodeColumn = { rm: 'rm_empcode', zsm: 'zsm_empcode', nsm: 'nsm_empcode' }[user.usertype]
  if (!empcodeColumn) return [user.id]
  if (!user.empcode || !user.divisionCode) return [user.id]

  const subordinateColumns = SUBORDINATE_EMPCODE_COLUMNS[user.usertype]
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id
     FROM vw_tm_hierarchy v
     JOIN users u ON u.empcode = ANY(ARRAY[${subordinateColumns.map(c => `v.${c}`).join(', ')}])
     WHERE v.${empcodeColumn} = $1 AND v.division_code = $2`,
    [user.empcode, user.divisionCode]
  )

  const ids = rows.map(r => r.id)
  if (!ids.includes(user.id)) ids.push(user.id)
  return ids
}

async function resolveOwnCustomerId(user) {
  if (!user.mobileno) return NEVER_MATCH_UUID
  const { rows } = await pool.query('SELECT id FROM customers WHERE mobile = $1', [user.mobileno])
  return rows[0]?.id ?? NEVER_MATCH_UUID
}

// Resolves the row-level access scope for the logged-in user against
// customers/orders. Returns:
//   - whereSql(alias, params): appends any bind values to `params` and returns
//     a SQL condition string to AND into the caller's WHERE clause (or ''
//     if the user has unrestricted/global access).
//   - allows(row): true if an already-fetched row (must include the columns
//     referenced below — division_code, cfa_code, registered_by/placed_by,
//     ordering_for_id as applicable) is within this user's scope.
// Client-supplied filters (division_code, registered_by, etc.) must always be
// ANDed with this scope, never substituted for it.
export async function getScope(user, { subjectType }) {
  const ownerColumn = subjectType === 'customer' ? 'registered_by' : 'placed_by'

  if (user.usertype === 'super-admin') {
    return { whereSql: () => '', allows: () => true }
  }

  if (user.usertype === 'admin' || user.usertype === 'bu-head') {
    const divisionCode = user.divisionCode ?? null
    return {
      whereSql(alias, params) {
        params.push(divisionCode)
        return `${alias}.division_code = $${params.length}`
      },
      allows: row => row.division_code === divisionCode,
    }
  }

  if (user.usertype === 'mm') {
    const divisionCode = user.divisionCode ?? null
    const cfaCodes = user.cfaCodes ?? []
    return {
      whereSql(alias, params) {
        params.push(divisionCode, cfaCodes)
        return `${alias}.division_code = $${params.length - 1} AND ${alias}.cfa_code = ANY($${params.length})`
      },
      allows: row => row.division_code === divisionCode && cfaCodes.includes(row.cfa_code),
    }
  }

  // dm has cross-division access (unlike mm) — restricted only by assigned
  // CFAs, same as super-admin minus the division boundary.
  if (user.usertype === 'dm') {
    const cfaCodes = user.cfaCodes ?? []
    return {
      whereSql(alias, params) {
        params.push(cfaCodes)
        return `${alias}.cfa_code = ANY($${params.length})`
      },
      allows: row => cfaCodes.includes(row.cfa_code),
    }
  }

  if (user.usertype === 'cfa') {
    const cfaCode = user.cfaCode ?? null
    return {
      whereSql(alias, params) {
        params.push(cfaCode)
        return `${alias}.cfa_code = $${params.length}`
      },
      allows: row => row.cfa_code === cfaCode,
    }
  }

  if (['tm', 'rm', 'zsm', 'nsm'].includes(user.usertype)) {
    const ids = await resolveHierarchyUserIds(user)
    const divisionCode = user.divisionCode ?? null
    return {
      whereSql(alias, params) {
        params.push(ids, divisionCode)
        return `${alias}.${ownerColumn} = ANY($${params.length - 1}) AND ${alias}.division_code = $${params.length}`
      },
      allows: row => ids.includes(row[ownerColumn]) && row.division_code === divisionCode,
    }
  }

  if (['patient', 'doctor', 'hospital', 'doctor-pharmacy'].includes(user.usertype)) {
    const ownCustomerId = await resolveOwnCustomerId(user)
    if (subjectType === 'customer') {
      return {
        whereSql(alias, params) {
          params.push(ownCustomerId)
          return `${alias}.id = $${params.length}`
        },
        allows: row => row.id === ownCustomerId,
      }
    }
    return {
      whereSql(alias, params) {
        params.push(ownCustomerId, user.id)
        return `(${alias}.ordering_for_id = $${params.length - 1} OR ${alias}.placed_by = $${params.length})`
      },
      allows: row => row.ordering_for_id === ownCustomerId || row.placed_by === user.id,
    }
  }

  // Unrecognized usertype — fail closed, not open.
  return { whereSql: () => '1 = 0', allows: () => false }
}
