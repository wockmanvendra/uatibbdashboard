import { Controller } from 'react-hook-form'
import RegistrationFormBase from '../components/RegistrationFormBase.jsx'
import AddressFields from '../components/AddressFields.jsx'
import DirectorySelect from '../components/DirectorySelect.jsx'
import { SapTerritoryCodeField } from '../components/SapCodeField.jsx'
import { PanNumberField, AadhaarNumberField } from '../components/KycFields.jsx'
import { EmailField, MobileField } from '../components/ContactFields.jsx'
import { buildDocumentsSection, documentDefaultValues } from '../components/buildDocumentsSection.jsx'
import { mapCustomerToFormValues } from '../mapCustomerToFormValues.js'
import { useDivisionConfig } from '../../context/DivisionConfigContext.jsx'
import { customersApi } from '../../lib/api.js'
import { useLiveCheck } from '../hooks/useLiveCheck.js'
import { GENDER_OPTIONS } from '../mockData.js'
import { ageRule, required } from '../validation.js'

// A doctor <-> pharmacy link is one-to-one, so this live-checks the number
// against BOTH customers.registration_number (other doctors) and
// customers.linked_doctor_registration_number (pharmacies already linked to
// a doctor with this number) as the user blurs the field, instead of only
// surfacing a duplicate at final submission — mirrors AddressFields' PIN-code
// lookup UX (.reg-input-wrap / .reg-spinner / .reg-input-icon--ok). Only
// registration_number has a DB UNIQUE constraint backing it, so the
// linked_doctor_registration_number half of this check is live-only (see
// ComplianceFields.jsx for a similar live-check-only case). A separate
// component (not inline in the section's render) because it needs
// useLiveCheck's internal useState, same reason AddressFields is its own
// component.
function DoctorRegistrationNumberField({ register, errors, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkRegistrationNumber(value, editingCustomerId),
    'This registration number is already registered or linked to a pharmacy',
  )

  return (
    <div className="reg-field">
      <label>Doctor Registration Number *</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          maxLength={20}
          {...register('registrationNumber', { ...required('Doctor registration number'), validate: check })}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.registrationNumber && <span className="reg-err">{errors.registrationNumber.message}</span>}
    </div>
  )
}

export const DOCTOR_DEFAULT_VALUES = {
  selectedDoctor:     null,
  doctorName:         '',
  age:                '',
  gender:             '',
  email:              '',
  mobile:             '',
  address:            '',
  pinCode:            '',
  city:               '',
  state:              '',
  cfaCode:            '',
  securityCheque:     null,
  registrationNumber: '',
  panNumber:          '',
  aadhaarNumber:      '',
}

function applyDoctorRecord(setValue, clearErrors, doctor) {
  const fieldMap = {
    doctorName: doctor.name,
    email:      doctor.email,
    mobile:     doctor.mobile,
    address:    doctor.address,
    pinCode:    doctor.pinCode,
    city:       doctor.city,
    state:      doctor.state,
  }
  Object.entries(fieldMap).forEach(([field, value]) => {
    setValue(field, value, { shouldValidate: true, shouldDirty: true })
  })
  clearErrors(Object.keys(fieldMap))
}

const STATIC_SECTIONS = [
  {
    key:    'intro',
    label:  'Details',
    icon:   null,
    title:  'Doctor details',
    subtitle: 'Find an existing doctor to auto-fill their details, or skip to enter them manually.',
    fields: ['age', 'gender', 'email', 'mobile'],
    render: ({ control, register, setValue, clearErrors, errors, editingCustomerId, editingCustomer, isAdminEditMode, user }) => (
      <div className="reg-grid">
        {isAdminEditMode && editingCustomer?.customerCode && (
          <div className="reg-col reg-col--wide">
            <div className="reg-admin-locked-chip">DML Code: <span className="reg-admin-locked-chip__code">{editingCustomer.customerCode}</span> — locked</div>
          </div>
        )}
        {isAdminEditMode ? (
          <div className="reg-col reg-col--wide">
            <div className="reg-field">
              <label>Doctor Name <span className="reg-locked-badge">locked</span></label>
              <input className="reg-input reg-input--readonly" readOnly {...register('doctorName')} />
            </div>
          </div>
        ) : (
          <div className="reg-col reg-col--wide">
            <DirectorySelect
              name="selectedDoctor"
              control={control}
              label="Search doctors by name"
              directoryType="doctor"
              labelKey="name"
              extraKeys={['address', 'city']}
              showRegistrationStatus
              isDisabled={(option) => option.isRegistered || option.isLinkedToPharmacy}
              excludeCustomerId={editingCustomerId}
              helperText="Selecting a doctor auto-fills the form below — every field stays editable."
              onSelect={(doctor) => applyDoctorRecord(setValue, clearErrors, doctor)}
            />
          </div>
        )}
        <div className="reg-col reg-col--sm">
          <div className="reg-field">
            <label>Age *</label>
            <input className="reg-input" type="number" min={0} max={120} {...register('age', { ...ageRule, valueAsNumber: true })} />
            {errors.age && <span className="reg-err">{errors.age.message}</span>}
          </div>
        </div>
        <div className="reg-col reg-col--sm">
          <Controller
            name="gender"
            control={control}
            rules={required('Gender')}
            render={({ field }) => (
              <fieldset className="reg-fieldset">
                <legend>Gender *</legend>
                <div className="reg-radio-group">
                  {GENDER_OPTIONS.filter((o) => o !== 'Other').map((option) => (
                    <label key={option} className="reg-radio-label">
                      <input type="radio" {...field} value={option} checked={field.value === option} onChange={() => field.onChange(option)} />
                      {option}
                    </label>
                  ))}
                </div>
                {errors.gender && <span className="reg-err">{errors.gender.message}</span>}
              </fieldset>
            )}
          />
        </div>
        <div className="reg-col">
          <EmailField register={register} errors={errors} editingCustomerId={editingCustomerId} />
        </div>
        <div className="reg-col">
          <MobileField register={register} errors={errors} editingCustomerId={editingCustomerId} isAdminEditMode={isAdminEditMode} />
        </div>
        <div className="reg-col">
          <SapTerritoryCodeField user={user} isAdminEditMode={isAdminEditMode} editingCustomer={editingCustomer} />
        </div>
      </div>
    ),
  },
  {
    key:    'address-pro',
    label:  'Address & Info',
    icon:   null,
    title:  'Address & professional information',
    fields: ['address', 'pinCode', 'city', 'state', 'cfaCode', 'registrationNumber'],
    render: ({ register, control, errors, setValue, clearErrors, divisionCode, editingCustomerId }) => (
      <div className="reg-grid">
        <AddressFields control={control} register={register} errors={errors} setValue={setValue} clearErrors={clearErrors} />
        <div className="reg-col">
          <DoctorRegistrationNumberField register={register} errors={errors} editingCustomerId={editingCustomerId} />
        </div>
      </div>
    ),
  },
  {
    key:    'kyc',
    label:  'KYC',
    icon:   null,
    title:  'KYC information',
    fields: ['panNumber', 'aadhaarNumber'],
    render: ({ register, errors, setValue, editingCustomerId }) => (
      <div className="reg-grid">
        <div className="reg-col">
          <PanNumberField register={register} errors={errors} editingCustomerId={editingCustomerId} />
        </div>
        <div className="reg-col">
          <AadhaarNumberField register={register} errors={errors} setValue={setValue} editingCustomerId={editingCustomerId} />
        </div>
      </div>
    ),
  },
]

function buildSummary(values) {
  return [
    { label: 'Doctor name',               value: values.doctorName },
    { label: 'Registration no.',           value: values.registrationNumber },
    { label: 'Email',                      value: values.email },
    { label: 'Mobile',                     value: values.mobile },
    { label: 'City / State',               value: [values.city, values.state].filter(Boolean).join(', ') },
    { label: 'CFA Code',                   value: values.cfaCode },
    { label: 'PAN',                        value: values.panNumber },
    { label: 'Aadhaar',                    value: values.aadhaarNumber },
    { label: 'Signed registration form',   value: values.signedRegistrationForm?.name },
  ]
}

function DoctorForm({ isEditMode, isAdminEditMode, editingCustomer }) {
  const { rules } = useDivisionConfig()
  const documents = rules.documents.customer.doctor
  const documentsSection = buildDocumentsSection(documents)
  const sections = documentsSection ? [...STATIC_SECTIONS, documentsSection] : STATIC_SECTIONS
  const defaultValues = (isEditMode || isAdminEditMode)
    ? mapCustomerToFormValues(editingCustomer)
    : { ...DOCTOR_DEFAULT_VALUES, ...documentDefaultValues(documents) }

  return (
    <RegistrationFormBase
      customerType="doctor"
      customerTypeLabel="Doctor"
      defaultValues={defaultValues}
      sections={sections}
      buildSummary={buildSummary}
      isEditMode={isEditMode}
      isAdminEditMode={isAdminEditMode}
      editingCustomerId={editingCustomer?.id}
      editingCustomer={editingCustomer}
    />
  )
}

export default DoctorForm
