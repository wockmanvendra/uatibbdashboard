import { useAuthStore } from '../auth/authStore';
import type { ScopeLevel, UserRole } from '../types/api';

const LEVEL_LABEL: Record<Exclude<ScopeLevel, 'ALL'>, string> = {
  DIVISION: 'Division',
  ZONE: 'Zone',
  REGION: 'Region',
  HQ: 'HQ',
};

const ROLE_LABEL: Record<UserRole, string> = {
  tm: 'Territory Manager',
  rm: 'Regional Manager',
  zsm: 'Zonal Sales Manager',
  nsm: 'National Sales Manager',
};

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  if (!user) return null;

  const { level, nodes } = user.effectiveScope;
  const scope = level === 'ALL' ? 'All divisions' : `${LEVEL_LABEL[level]} ${nodes.join(', ')}`;

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="text-[13px] font-medium text-ink">{user.name}</div>
        <div className="text-[11px] text-ink-3">
          {ROLE_LABEL[user.role]} · {scope}
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="rounded border border-rule px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        Sign out
      </button>
    </div>
  );
}
