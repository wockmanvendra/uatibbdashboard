import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET env var is required')
}

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '6h'

// Mirrors the plain identity object every login endpoint used to return —
// req.user downstream ends up with the same shape useAuth().user expects.
export function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      usertype: user.usertype,
      name: user.name,
      mobileno: user.mobileno,
      divisionCode: user.divisionCode ?? null,
      sapCode: user.sapCode ?? null,
      userLocation: user.userLocation ?? null,
      empcode: user.empcode ?? null,
      cfaCodes: user.cfaCodes ?? null,
      cfaCode: user.cfaCode ?? null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}
