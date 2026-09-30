// Password strength rules — mirrors backend/src/utils/passwordPolicy.js exactly.
// Returns a string error message if weak, null if valid.
export function validatePasswordStrength(password) {
  if (!password || password.length < 8)  return 'At least 8 characters required.'
  if (!/[A-Z]/.test(password))           return 'Must include an uppercase letter.'
  if (!/[a-z]/.test(password))           return 'Must include a lowercase letter.'
  if (!/[0-9]/.test(password))           return 'Must include a number.'
  if (!/[^A-Za-z0-9]/.test(password))   return 'Must include a special character (e.g. @#$%).'
  return null
}

// Returns an array of { label, ok } rule objects for displaying a strength checklist.
export function getPasswordRules(password) {
  return [
    { label: 'At least 8 characters',      ok: password.length >= 8 },
    { label: 'One uppercase letter (A–Z)',  ok: /[A-Z]/.test(password) },
    { label: 'One lowercase letter (a–z)',  ok: /[a-z]/.test(password) },
    { label: 'One number (0–9)',            ok: /[0-9]/.test(password) },
    { label: 'One special character (@#$%…)', ok: /[^A-Za-z0-9]/.test(password) },
  ]
}
