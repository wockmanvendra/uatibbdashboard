import { Controller } from 'react-hook-form'
import RegistrationFormBase from '../components/RegistrationFormBase.jsx'
import AddressFields from '../components/AddressFields.jsx'
import { SapTerritoryCodeField } from '../components/SapCodeField.jsx'
import { EmailField, MobileField } from '../components/ContactFields.jsx'
import { buildDocumentsSection, documentDefaultValues } from '../components/buildDocumentsSection.jsx'
import { mapCustomerToFormValues } from '../mapCustomerToFormValues.js'
import { useDivisionConfig } from '../../context/DivisionConfigContext.jsx'
import { GENDER_OPTIONS } from '../mockData.js'
import { ageRule, required } from '../validation.js'

export const PATIENT_DEFAULT_VALUES = {
  fullName: '',
  age:      '',
  gender:   '',
  email:    '',
  mobile:   '',
  address:  '',
  pinCode:  '',
  city:     '',
  state:    '',
  cfaCode:  '',
  securityCheque: null,
}

const STATIC_SECTIONS = [
  {
    key:      'personal',
    label:    'Personal',
    icon:     null,
    title:    'Personal information',
    subtitle: 'Tell us who the patient is.',
    fields:   ['fullName', 'age', 'gender'],
    render: ({ register, control, errors, isAdminEditMode, editingCustomer, user }) => (
      <div className="reg-grid">
        {isAdminEditMode && editingCustomer?.customerCode && (
          <div className="reg-col reg-col--wide">
            <div className="reg-admin-locked-chip">DML Code: <span className="reg-admin-locked-chip__code">{editingCustomer.customerCode}</span> — locked</div>
          </div>
        )}
        <div className="reg-col">
          <div className="reg-field">
            <label>Full Name {isAdminEditMode ? <span className="reg-locked-badge">locked</span> : '*'}</label>
            <input className={`reg-input${isAdminEditMode ? ' reg-input--readonly' : ''}`} readOnly={isAdminEditMode} {...register('fullName', isAdminEditMode ? {} : required('Full name'))} />
            {errors.fullName && <span className="reg-err">{errors.fullName.message}</span>}
          </div>
        </div>
        <div className="reg-col">
          <SapTerritoryCodeField user={user} isAdminEditMode={isAdminEditMode} editingCustomer={editingCustomer} />
        </div>
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
                  {GENDER_OPTIONS.map((option) => (
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
      </div>
    ),
  },
  {
    key:      'contact',
    label:    'Contact',
    icon:     null,
    title:    'Contact information',
    subtitle: 'How should we reach the patient?',
    fields:   ['email', 'mobile'],
    render: ({ register, errors, isAdminEditMode, editingCustomerId }) => (
      <div className="reg-grid">
        <div className="reg-col">
          <EmailField register={register} errors={errors} editingCustomerId={editingCustomerId} />
        </div>
        <div className="reg-col">
          <MobileField register={register} errors={errors} editingCustomerId={editingCustomerId} isAdminEditMode={isAdminEditMode} />
        </div>
      </div>
    ),
  },
  {
    key:      'address',
    label:    'Address',
    icon:     null,
    title:    'Address information',
    subtitle: 'Used for deliveries and the assigned CFA.',
    fields:   ['address', 'pinCode', 'city', 'state', 'cfaCode'],
    render: ({ register, control, errors, setValue, clearErrors, divisionCode }) => (
      <AddressFields control={control} register={register} errors={errors} setValue={setValue} clearErrors={clearErrors} />
    ),
  },
]

function buildSummary(values) {
  return [
    { label: 'Full name',    value: values.fullName },
    { label: 'Age / Gender', value: [values.age, values.gender].filter(Boolean).join(' · ') },
    { label: 'Email',        value: values.email },
    { label: 'Mobile',       value: values.mobile },
    { label: 'City / State', value: [values.city, values.state].filter(Boolean).join(', ') },
    { label: 'CFA Code',     value: values.cfaCode },
  ]
}

function PatientForm({ isEditMode, isAdminEditMode, editingCustomer }) {
  const { rules } = useDivisionConfig()
  const documents = rules.documents.customer.patient
  const documentsSection = buildDocumentsSection(documents)
  const sections = documentsSection ? [...STATIC_SECTIONS, documentsSection] : STATIC_SECTIONS
  const defaultValues = (isEditMode || isAdminEditMode)
    ? mapCustomerToFormValues(editingCustomer)
    : { ...PATIENT_DEFAULT_VALUES, ...documentDefaultValues(documents) }

  return (
    <RegistrationFormBase
      customerType="patient"
      customerTypeLabel="Patient"
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

export default PatientForm
