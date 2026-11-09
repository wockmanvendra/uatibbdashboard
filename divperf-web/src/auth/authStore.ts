/**
 * The signed-in session: the API token and who it belongs to.
 *
 * Persisted so a page reload does not sign the user out. The API remains the
 * authority — an expired or revoked token comes back 401 and `api.ts` clears it.
 * `user.roleKey` is the role the person views the dashboard as; every request
 * carries it (X-Dashboard-Role).
 */
import { create } from 'zustand';
import type { LoginResponse, SessionUser } from '../types/api';

const SESSION_KEY = 'divperf.session';

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  signIn: (session: LoginResponse) => void;
  /** The same session in another of the person's roles. */
  setUser: (user: SessionUser) => void;
  signOut: () => void;
}

function loadSession(): LoginResponse | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as LoginResponse) : null;
  } catch {
    return null;
  }
}

const initial = loadSession();

function save(session: LoginResponse) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode): the session lasts until reload.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: initial?.token ?? null,
  user: initial?.user ?? null,

  signIn: ({ token, user }) => {
    save({ token, user });
    set({ token, user });
  },

  setUser: (user) =>
    set((s) => {
      if (s.token) save({ token: s.token, user });
      return { user };
    }),

  signOut: () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing persisted to remove.
    }
    set({ token: null, user: null });
  },
}));
