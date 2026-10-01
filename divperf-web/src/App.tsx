import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { FilterBar } from './components/filters/FilterBar';
import { TabStrip } from './components/TabStrip';
import { UserMenu } from './components/UserMenu';
import { TabPage } from './tabs/TabPage';
import { DEFAULT_TAB } from './tabs/registry';
import { useDataVersionSync } from './queries/useDataVersion';
import { useFilterStore } from './store/filterStore';
import { useAuthStore } from './auth/authStore';
import { LoginPage } from './auth/LoginPage';

export function App() {
  const signedIn = useAuthStore((s) => s.token !== null);

  if (!signedIn) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    );
  }
  return <Dashboard />;
}

/** Remembers where the user was headed, so sign-in lands them back there. */
function ToLogin() {
  const { pathname, search } = useLocation();
  return <Navigate to="/login" replace state={{ from: `${pathname}${search}` }} />;
}

function Dashboard() {
  // Poll the version token and invalidate only open-month queries. (§8.4)
  useDataVersionSync();

  const density = useFilterStore((s) => s.density);
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  return (
    <div className="xl min-h-screen">
      <a
        href="#main"
        className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-surface px-3 py-1.5 text-[12px]"
      >
        Skip to content
      </a>

      <header className="xl-titlebar flex items-center justify-between gap-4 px-5 py-2.5">
        <h1 className="text-[17px] font-bold uppercase tracking-[0.04em]">
          Division Performance: Sales Dashboard
        </h1>
        <UserMenu tone="dark" />
      </header>

      <FilterBar />
      <TabStrip />

      <main id="main">
        <Routes>
          <Route path="/" element={<Navigate to={`/${DEFAULT_TAB.path}`} replace />} />
          <Route path="/login" element={<Navigate to={`/${DEFAULT_TAB.path}`} replace />} />
          <Route path="/:tab" element={<TabPage />} />
          <Route path="*" element={<Navigate to={`/${DEFAULT_TAB.path}`} replace />} />
        </Routes>
      </main>
    </div>
  );
}
