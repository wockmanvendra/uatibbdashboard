/**
 * Who a signed-in person is, and what they may see — from the Central User
 * Service's token, in the shape the rest of the API uses (scopeFor()).
 *
 * The scope rules are the ones the dashboard has always used (the retired
 * vw_dashboard_users view), on the same Infinity field structure:
 *
 *   TM    → HQ      the SAP codes of the territories they hold
 *   RM    → REGION  the SAP codes of the regions they manage
 *   ZSM   → ZONE    the SAP codes of the zones they manage
 *   NSM, BU head, admin → DIVISION  their division
 *
 * A manager can hold more than one region or zone (4 RMs do today), so the
 * codes come from the service's hierarchy, one row per territory; the token's
 * own sap_code is the fallback. Mobiles in ALL_DIVISION_MOBILES, and the
 * service's own admins, see every division.
 *
 * A person may hold several roles (the token's `roles`): the session is in one of them, the
 * one the browser asks for (X-Dashboard-Role) if the token lists it, else the first.
 */
import type { ScopeLevel, UserRole } from '../types/api.js';
import { canonicalDivisionCode, config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { hierarchy, type CentralRole, type CentralUser, type HierarchyRow } from '../services/centralAuth.js';

export interface UserRecord {
  /** The service's user id (the token's `sub`). */
  id: string;
  usertype: UserRole;
  name: string;
  mobileno: string;
  email: string | null;
  scopeLevel: ScopeLevel;
  scopeNodes: string[];
  /** The person's own division code(s). */
  divisions: string[];
  /** Every role the person may view the dashboard as; one only for an all-divisions user. */
  roles: RoleOption[];
  /** The role this session is in. */
  roleKey: string;
}

export interface RoleOption {
  key: string;
  role: UserRole;
  division: string | null;
  divisionName: string | null;
  /** The role shows every division: the main role of a service admin or a listed mobile. */
  allDivisions: boolean;
}

export const NO_TERRITORY =
  'Your territory is not set in Infinity, so there is nothing to show you. Contact your administrator.';

/** Someone listed but with no territory would sign in to an empty dashboard. */
export const hasTerritory = (u: Pick<UserRecord, 'scopeLevel' | 'scopeNodes'>) =>
  u.scopeLevel === 'ALL' || u.scopeNodes.length > 0;

const ROLES: readonly UserRole[] = ['tm', 'rm', 'zsm', 'nsm', 'bu-head', 'admin'];

/** Field roles, and the hierarchy columns that name their people and their codes. */
const FIELD: Partial<Record<UserRole, { level: ScopeLevel; who: keyof HierarchyRow; code: keyof HierarchyRow }>> = {
  tm: { level: 'HQ', who: 'tm_empcode', code: 'tm_sapcode' },
  rm: { level: 'REGION', who: 'rm_empcode', code: 'rm_sapcode' },
  zsm: { level: 'ZONE', who: 'zsm_empcode', code: 'zsm_sapcode' },
};

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t === '' || t === '-' || t === '0' ? null : t;
};

/**
 * The SAP codes in one field. The service keeps a manager of two regions as a
 * single "WKI,WKC"; the sales data has WKI and WKC.
 */
const codes = (v: string | null | undefined): string[] =>
  (v ?? '').split(',').map(clean).filter((c): c is string => c !== null);

/** The person's roles this dashboard serves: the token's `roles`, or its own (an older service). */
export function rolesOf(u: CentralUser): CentralRole[] {
  const listed: CentralRole[] = u.roles?.length
    ? u.roles
    : [{ key: `${u.usertype}:${u.division_code ?? ''}`, usertype: u.usertype, division_code: u.division_code, division_name: u.division_name ?? null, sap_code: u.sap_code ?? null }];
  return listed.filter((r) => (ROLES as readonly string[]).includes(r.usertype));
}

const optionOf = (r: CentralRole, allDivisions: boolean): RoleOption => ({
  key: r.key,
  role: r.usertype as UserRole,
  division: clean(r.division_code),
  divisionName: r.division_name ?? null,
  allDivisions,
});

/** The session for one of the person's roles: `roleKey` when the token lists it, else the first. */
export async function sessionUser(u: CentralUser, roleKey?: string | null): Promise<UserRecord> {
  const roles = rolesOf(u);
  const active = roles.find((r) => r.key === roleKey) ?? roles[0];
  if (!active) {
    throw forbidden('Your account type cannot use this dashboard. Contact your administrator.');
  }
  const role = active.usertype as UserRole;
  // Service admins and listed mobiles see every division on their main role; an extra role
  // is that role's own view, so an admin can see what that TM or RM sees.
  const seesAll = config.ALL_DIVISION_MOBILES.has(u.mobileno.trim()) || u.is_service_admin === true;
  const mainKey = (roles.find((r) => r.main) ?? roles[0])!.key;
  const allOn = (r: CentralRole) => seesAll && r.key === mainKey;
  // The service's division code, which its hierarchy is read with; the scope
  // uses the dashboard's (RESEARCH's 84 is 02 — config DIVISION_ALIASES).
  const serviceDivision = clean(active.division_code);
  const division = serviceDivision && canonicalDivisionCode(serviceDivision);
  const base = {
    id: u.sub,
    usertype: role,
    name: u.name,
    mobileno: u.mobileno,
    email: u.email,
    divisions: division ? [division] : [],
    roles: roles.map((r) => optionOf(r, allOn(r))),
    roleKey: active.key,
  };

  if (allOn(active)) {
    return { ...base, scopeLevel: 'ALL', scopeNodes: [], divisions: [] };
  }

  const field = FIELD[role];
  if (!field) {
    return { ...base, scopeLevel: 'DIVISION', scopeNodes: division ? [division] : [] };
  }

  const empcode = clean(u.empcode);
  let nodes: string[] = [];
  if (serviceDivision && empcode) {
    const rows = await hierarchy(serviceDivision);
    nodes = [
      ...new Set(
        rows
          .filter((r) => clean(r[field.who] as string | null) === empcode)
          .flatMap((r) => codes(r[field.code] as string | null)),
      ),
    ].sort();
  }
  if (!nodes.length) nodes = [...new Set(codes(active.sap_code))].sort();
  return { ...base, scopeLevel: field.level, scopeNodes: nodes };
}
