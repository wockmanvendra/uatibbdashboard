import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import './Navbar.css'

const PROJECT_NAME = 'Direct to Customer'
const MANIFEST_TAG = 'PORTAL · FILE NO. 04829-C'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Home', end: true },
]

const USERTYPE_LABELS = {
  patient:           'Patient',
  doctor:            'Doctor',
  'doctor-pharmacy': 'Doctor Pharmacy',
  hospital:          'Hospital',
  admin:             'Admin',
  'super-admin':     'Super Admin',
  'scm-admin':       'SCM Admin',
  tm:                'TM',
  rm:                'RM',
  zsm:               'ZSM',
  nsm:               'NSM',
  cfa:               'CFA',
  mm:                'Marketing Mgr',
  dm:                'Distribution Mgr',
}

function Navbar() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="navbar">
      <div className="navbar__hazard" aria-hidden="true" />
      <div className="navbar__row">
        <div className="navbar__brand">
          {/* <span className="navbar__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
              <path d="M16 1 L16 8 M16 24 L16 31 M1 16 L8 16 M24 16 L31 16" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </span> */}
          <img src="/wing_white.png" alt="" className="navbar__mark-img" />
          <span className="navbar__type">
            <span className="navbar__title">{PROJECT_NAME}</span>
            {/* <span className="navbar__tag">{MANIFEST_TAG}</span> */}
          </span>
        </div>

        <div className="navbar__actions">
          {user && (
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) =>
                `navbar__home-btn${isActive ? ' navbar__home-btn--active' : ''}`
              }
              title="Home"
              aria-label="Home"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11L12 3l9 8" />
                <path d="M5 9v10a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1V9" />
              </svg>
            </NavLink>
          )}
          {user ? (
            <div className="navbar__user">
              <span className="navbar__dot" aria-hidden="true" />
              <span className="navbar__user-name">{user.name}</span>
              <span className="navbar__user-type">
                {USERTYPE_LABELS[user.usertype] ?? user.usertype}
              </span>
            </div>
          ) : (
            <span className="navbar__status">
              <span className="navbar__dot" aria-hidden="true" />
              SESSION ACTIVE
            </span>
          )}
          <button type="button" className="navbar__logout" onClick={handleLogout}>
            <span className="navbar__logout-label">LOG OUT</span>
            <span className="navbar__logout-arrow" aria-hidden="true">&rarr;</span>
          </button>
        </div>
      </div>
    </header>
  )
}

export default Navbar
