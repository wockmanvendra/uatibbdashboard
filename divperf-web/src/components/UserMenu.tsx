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

/** `dark` sits on the blue title bar; `light` on a white surface. */
export function UserMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  if (!user) return null;

  const { level, nodes } = user.effectiveScope;
  const scope = level === 'ALL' ? 'All divisions' : `${LEVEL_LABEL[level]} ${nodes.join(', ')}`;

  const dark = tone === 'dark';

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className={`text-[13px] font-semibold ${dark ? 'text-white' : 'text-ink'}`}>{user.name}</div>
        <div className={`text-[11px] ${dark ? 'text-white/80' : 'text-ink-3'}`}>
          {ROLE_LABEL[user.role]} · {scope}
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className={`rounded-sm border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
          dark
            ? 'border-white/60 text-white hover:bg-white hover:text-[var(--xl-title)]'
            : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
        }`}
      >
        Sign out
      </button>
    </div>
  );
}
