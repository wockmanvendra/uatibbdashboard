import { Router } from 'express'
import { getDivisionContact } from '../config/divisionContacts.js'

const router = Router()

// GET /app-config?division_code= — small set of config the frontend needs
// at runtime. adminContactMobile is the division's configured contact (falls
// back to the global ADMIN_CONTACT_MOBILE env var when the division has no
// division_contacts row) — shown on error modals.
router.get('/', async (req, res, next) => {
  try {
    const { adminMobile } = await getDivisionContact(req.query.division_code)
    res.json({ adminContactMobile: adminMobile })
  } catch (err) { next(err) }
})

export default router
