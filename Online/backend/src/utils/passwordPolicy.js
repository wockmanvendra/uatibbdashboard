// Returns a human-readable error string if the password is too weak, or null if valid.
// Rules: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character.
export function validatePasswordStrength(password) {
  if (!password || password.length < 8)  return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(password))           return 'Password must contain at least one uppercase letter.'
  if (!/[a-z]/.test(password))           return 'Password must contain at least one lowercase letter.'
  if (!/[0-9]/.test(password))           return 'Password must contain at least one number.'
  if (!/[^A-Za-z0-9]/.test(password))   return 'Password must contain at least one special character (e.g. @#$%).'
  return null
}
