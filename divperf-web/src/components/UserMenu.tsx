import { useState } from 'react';
import { useAuthStore } from '../auth/authStore';
import { useFilterStore } from '../store/filterStore';
import { fetchSession } from '../lib/api';
import { ROLE_LABEL, roleLabel } from '../lib/roles';
import type { ScopeLevel } from '../types/api';

const LEVEL_LABEL: Record<Exclude<ScopeLevel, 'ALL'>, string> = {
  DIVISION: 'Division',
  ZONE: 'Zone',
  REGION: 'Region',
  HQ: 'HQ',
};

/** `dark` sits on the blue title bar; `light` on a white surface. */
export function UserMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const signOut = useAuthStore((s) => s.signOut);
  const setUser = useAuthStore((s) => s.setUser);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  if (!user) return null;

  const roles = user.roles ?? [];
  const switchRole = async (roleKey: string) => {
    if (!token || roleKey === user.roleKey) return;
    setSwitching(true);
    setSwitchError('');
    try {
      const next = await fetchSession(token, roleKey);
      // The filters were chosen in the other role's scope and may not exist in this one.
      useFilterStore.getState().clearAll();
      setUser(next);
    } catch {
      setSwitchError('Could not switch role. Try again.');
    } finally {
      setSwitching(false);
    }
  };

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
      {roles.length > 1 && (
        <label className="flex flex-col gap-0.5">
          <span className="sr-only">Switch role</span>
          <select
            value={user.roleKey}
            onChange={(e) => void switchRole(e.target.value)}
            disabled={switching}
            title={switchError || 'Switch role'}
            aria-label="Switch role"
            className={`max-w-[220px] rounded-sm border px-1.5 py-1 text-[12px] font-semibold ${
              dark ? 'border-white/60 bg-transparent text-white [&>option]:text-ink' : 'border-rule bg-white text-ink-2'
            }`}
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          {switchError && (
            <span role="alert" className={`text-[11px] ${dark ? 'text-white' : 'text-bad'}`}>
              {switchError}
            </span>
          )}
        </label>
      )}
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
