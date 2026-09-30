// usertypes managed via the Admin User Management panel (POST/PATCH/DELETE
// /api/admin-user-details) — all password-login roles, same set as
// PASSWORD_TYPES in routes/auth.js. Used to scope that route's queries to
// admin-panel accounts only, now that it reads/writes `users` directly
// instead of a separate admin_user_details table.
export const ADMIN_MANAGED_USERTYPES = ['admin', 'bu-head', 'cfa', 'dm', 'mm', 'scm-admin', 'super-admin']
