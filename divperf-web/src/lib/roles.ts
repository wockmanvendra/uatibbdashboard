/** How a user's role reads on screen — the user menu and the role picker. */
import type { SessionRole, UserRole } from '../types/api';

export const ROLE_LABEL: Record<UserRole, string> = {
  tm: 'Territory Manager',
  rm: 'Regional Manager',
  zsm: 'Zonal Sales Manager',
  nsm: 'National Sales Manager',
  'bu-head': 'BU Head',
  admin: 'Admin',
};

/** "BU Head · AESTHETICS (A8)", or "BU Head · All divisions". */
export function roleLabel(r: SessionRole): string {
  if (r.allDivisions) return `${ROLE_LABEL[r.role]} · All divisions`;
  const division = r.divisionName ? `${r.divisionName} (${r.division})` : r.division;
  return division ? `${ROLE_LABEL[r.role]} · ${division}` : ROLE_LABEL[r.role];
}
