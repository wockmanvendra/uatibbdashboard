import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/jwt.js'

export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET)
    req.user = {
      id: payload.sub,
      usertype: payload.usertype,
      name: payload.name,
      mobileno: payload.mobileno,
      divisionCode: payload.divisionCode,
      sapCode: payload.sapCode,
      userLocation: payload.userLocation,
      empcode: payload.empcode,
      cfaCodes: payload.cfaCodes ?? null,
      cfaCode: payload.cfaCode ?? null,
    }
    next()
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token'
    res.status(401).json({ error: message })
  }
}

export function authorize(...allowedUsertypes) {
  return (req, res, next) => {
    if (!allowedUsertypes.includes(req.user?.usertype)) {
      return res.status(403).json({ error: 'Not authorized for this action' })
    }
    next()
  }
}
