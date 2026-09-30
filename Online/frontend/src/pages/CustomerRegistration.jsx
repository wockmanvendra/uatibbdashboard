import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CUSTOMER_TYPES } from '../registration/mockData.js'
import PatientForm from '../registration/forms/PatientForm.jsx'
import DoctorForm from '../registration/forms/DoctorForm.jsx'
import PharmacyForm from '../registration/forms/PharmacyForm.jsx'
import HospitalForm from '../registration/forms/HospitalForm.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useCustomers } from '../context/CustomersContext.jsx'
import { useDivisionConfig } from '../context/DivisionConfigContext.jsx'
import { mastersApi } from '../lib/api.js'
import './CustomerRegistration.css'

const FORM_COMPONENTS = {
  patient:           PatientForm,
  doctor:            DoctorForm,
  'doctor-pharmacy': PharmacyForm,
  hospital:          HospitalForm,
}

const TYPE_DESCRIPTIONS = {
  patient:           'Individual placing orders for personal or family use.',
  doctor:            'Practitioner onboarding with registration & document checks.',
  'doctor-pharmacy': 'Retail pharmacy linked to a prescribing doctor, with GST/KYC compliance.',
  hospital:          'Institutional account with statutory registration & licensing.',
}

function CustomerRegistration() {
  const { state } = useLocation()
  const resubmitCustomerId  = state?.resubmitCustomerId  ?? null
  const adminEditCustomerId = state?.adminEditCustomerId ?? null

  const { user } = useAuth()
  const { customers } = useCustomers()
  const { rules } = useDivisionConfig()
  const allowedCustomerTypes = rules?.allowedCustomerTypes ?? CUSTOMER_TYPES.map(t => t.value)
  const editingCustomer = (resubmitCustomerId || adminEditCustomerId)
    ? customers.find(c => c.id === (resubmitCustomerId ?? adminEditCustomerId)) ?? null
    : null

  const isAdminEditMode = !!adminEditCustomerId

  const [selectedType, setSelectedType] = useState('')
  const customerType = (resubmitCustomerId || adminEditCustomerId) ? (editingCustomer?.customerType ?? '') : selectedType
  const ActiveForm = customerType ? FORM_COMPONENTS[customerType] : null

  const [directoryCounts, setDirectoryCounts] = useState({ doctorsAvailable: 0, chemistsAvailable: 0 })

  const isTm = user?.usertype === 'tm'

  useEffect(() => {
    if (!isTm || !user?.userLocation) return
    mastersApi.getDirectoryCounts(user.userLocation, user.divisionCode)
      .then(setDirectoryCounts)
      .catch(console.error)
  }, [isTm, user?.userLocation, user?.divisionCode])

  const doctorsRegistered  = customers.filter(c => c.customerType === 'doctor'            && c.registeredBy?.id === user?.id).length
  const chemistsRegistered = customers.filter(c => c.customerType === 'doctor-pharmacy'   && c.registeredBy?.id === user?.id).length

  const REGISTERED_COUNTS = { doctor: doctorsRegistered, 'doctor-pharmacy': chemistsRegistered }
  const AVAILABLE_COUNTS  = { doctor: directoryCounts.doctorsAvailable, 'doctor-pharmacy': directoryCounts.chemistsAvailable }

  const optionLabel = (type) => {
    if (!isTm || !(type.value in REGISTERED_COUNTS)) return type.label
    return `${type.label} — ${REGISTERED_COUNTS[type.value]} registered / ${AVAILABLE_COUNTS[type.value]} available`
  }

  return (
    <div className="reg-container">
      <div className="reg-card">
        <div className="reg-field">
          <label htmlFor="customer-type-select">Customer Type</label>
          <select
            id="customer-type-select"
            className="reg-select"
            value={customerType}
            onChange={(e) => setSelectedType(e.target.value)}
            disabled={!!(resubmitCustomerId || adminEditCustomerId)}
          >
            <option value="">Select customer type…</option>
            {CUSTOMER_TYPES.filter(type => allowedCustomerTypes.includes(type.value)).map((type) => (
              <option key={type.value} value={type.value}>{optionLabel(type)}</option>
            ))}
          </select>
          {resubmitCustomerId
            ? <span className="reg-hint">Editing a rejected registration — customer type can't be changed.</span>
            : adminEditCustomerId
              ? <span className="reg-hint">Admin edit — customer type is locked. Name, DML code, and mobile cannot be changed.</span>
              : customerType && <span className="reg-hint">{TYPE_DESCRIPTIONS[customerType]}</span>}
        </div>
      </div>

      {ActiveForm ? (
        <ActiveForm key={customerType} isEditMode={!!resubmitCustomerId} isAdminEditMode={isAdminEditMode} editingCustomer={editingCustomer} />
      ) : (
        <div className="reg-card reg-card--placeholder">
          <p>Select a customer type above to begin registration.</p>
        </div>
      )}
    </div>
  )
}

export default CustomerRegistration
