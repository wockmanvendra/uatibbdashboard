import { Controller } from 'react-hook-form'
import dayjs from 'dayjs'
import RegistrationFormBase from '../components/RegistrationFormBase.jsx'
import AddressFields from '../components/AddressFields.jsx'
import DirectorySelect from '../components/DirectorySelect.jsx'
import { SapTerritoryCodeField } from '../components/SapCodeField.jsx'
import { GstNumberField, DrugLicenceNumberField } from '../components/ComplianceFields.jsx'
import { PanNumberField, AadhaarNumberField } from '../components/KycFields.jsx'
import { EmailField, MobileField } from '../components/ContactFields.jsx'
import { buildDocumentsSection, documentDefaultValues } from '../components/buildDocumentsSection.jsx'
import { mapCustomerToFormValues } from '../mapCustomerToFormValues.js'
import { useDivisionConfig } from '../../context/DivisionConfigContext.jsx'
import { customersApi } from '../../lib/api.js'
import { useLiveCheck } from '../hooks/useLiveCheck.js'
import { futureDateValidator, required } from '../validation.js'

// A doctor <-> pharmacy link is one-to-one, so this live-checks the number
// against BOTH customers.registration_number (doctors) and
// customers.linked_doctor_registration_number (other pharmacies already
// linked to a doctor with this number) — same backend endpoint and
// uniqueness semantics as Doctor Registration Number's own check
// (DoctorForm.jsx), just called from the pharmacy side. Mirrors
// AddressFields' PIN-code lookup UX (.reg-input-wrap / .reg-spinner /
// .reg-input-icon--ok).
function LinkedDoctorRegistrationNumberField({ register, errors, editingCustomerId }) {
  const { status, check } = useLiveCheck(
    (value) => customersApi.checkRegistrationNumber(value, editingCustomerId),
    'This registration number is already registered to a doctor or another pharmacy',
  )

  return (
    <div className="reg-field">
      <label>Doctor's Registration Number *</label>
      <div className="reg-input-wrap">
        <input
          className="reg-input"
          maxLength={20}
          {...register('linkedDoctorRegistrationNumber', { ...required("Doctor's registration number"), validate: check })}
        />
        {status.state === 'loading' && <span className="reg-spinner" />}
        {status.state === 'success' && <span className="reg-input-icon reg-input-icon--ok">✓</span>}
      </div>
      {errors.linkedDoctorRegistrationNumber && <span className="reg-err">{errors.linkedDoctorRegistrationNumber.message}</span>}
    </div>
  )
}

export const PHARMACY_DEFAULT_VALUES = {
  selectedPharmacy:     null,
  pharmacyName:         '',
  linkedDoctor:         null,
  linkedDoctorRegistrationNumber: '',
  email:                '',
  mobile:               '',
  address:              '',
  pinCode:              '',
  city:                 '',
  state:                '',
  cfaCode:              '',
  securityCheque:       null,
  gstNumber:            '',
  compositionScheme:    false,
  drugLicenceNumber:    '',
  drugLicenceValidTill: '',
  panNumber:            '',
  aadhaarNumber:        '',
}

function applyPharmacyRecord(setValue, clearErrors, pharmacy) {
  const fieldMap = {
    pharmacyName: pharmacy.name,
    email:        pharmacy.email,
    mobile:       pharmacy.mobile,
    address:      pharmacy.address,
    pinCode:      pharmacy.pinCode,
    city:         pharmacy.city,
    state:        pharmacy.state,
  }
  Object.entries(fieldMap).forEach(([field, value]) => {
    setValue(field, value, { shouldValidate: true, shouldDirty: true })
  })
  clearErrors(Object.keys(fieldMap))
}

const STATIC_SECTIONS = [
  {
    key:      'pharmacy-contact-address',
    label:    'Pharmacy',
    icon:     null,
    title:    'Pharmacy, contact & address',
    subtitle: 'Pick an existing pharmacy to auto-fill its details — every value can still be edited.',
    fields:   ['linkedDoctor', 'linkedDoctorRegistrationNumber', 'email', 'mobile', 'address', 'pinCode', 'city', 'state', 'cfaCode'],
    render: ({ control, register, errors, setValue, clearErrors, editingCustomerId, editingCustomer, isAdminEditMode, divisionCode, user }) => (
      <>
        {isAdminEditMode && editingCustomer?.customerCode && (
          <div className="reg-grid">
            <div className="reg-col reg-col--wide">
              <div className="reg-admin-locked-chip">DML Code: <span className="reg-admin-locked-chip__code">{editingCustomer.customerCode}</span> — locked</div>
            </div>
          </div>
        )}
        <div className="reg-grid">
          {isAdminEditMode ? (
            <div className="reg-col reg-col--wide">
              <div className="reg-field">
                <label>Pharmacy Name <span className="reg-locked-badge">locked</span></label>
                <input className="reg-input reg-input--readonly" readOnly {...register('pharmacyName')} />
              </div>
            </div>
          ) : (
            <div className="reg-col reg-col--wide">
              <DirectorySelect
                name="selectedPharmacy"
                control={control}
                label="Search pharmacies by name"
                directoryType="doctor-pharmacy"
                labelKey="name"
                extraKeys={['address', 'city']}
                showRegistrationStatus
                helperText="Selecting a pharmacy auto-fills the form below."
                onSelect={(pharmacy) => applyPharmacyRecord(setValue, clearErrors, pharmacy)}
              />
            </div>
          )}
          <div className="reg-col reg-col--wide">
            <DirectorySelect
              name="linkedDoctor"
              control={control}
              label="Search doctors by name"
              required
              directoryType="doctor"
              labelKey="name"
              extraKeys={['address', 'city']}
              showRegistrationStatus
              isDisabled={(option) => option.isRegistered || option.isLinkedToPharmacy}
              excludeCustomerId={editingCustomerId}
              helperText="The selected doctor will be linked to this pharmacy record."
            />
          </div>
          <div className="reg-col reg-col--wide">
            <LinkedDoctorRegistrationNumberField register={register} errors={errors} editingCustomerId={editingCustomerId} />
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
        <AddressFields control={control} register={register} errors={errors} setValue={setValue} clearErrors={clearErrors} />
      </>
    ),
  },
  {
    key:        'compliance-license',
    label:      'Compliance',
    icon:       null,
    title:      'Compliance & licence',
    subtitle:   'Provide a GSTIN or declare the composition scheme, then add your drug licence details.',
    fields:     ['gstNumber', 'drugLicenceNumber', 'drugLicenceValidTill'],
    isComplete: (values) => {
      const gstOk = values?.compositionScheme || (values?.gstNumber && String(values.gstNumber).trim() !== '')
      return Boolean(
        gstOk &&
        values?.drugLicenceNumber && String(values.drugLicenceNumber).trim() !== '' &&
        values?.drugLicenceValidTill && String(values.drugLicenceValidTill).trim() !== '',
      )
    },
    render: ({ control, register, errors, watch, setValue, clearErrors, editingCustomerId }) => {
      const compositionScheme = watch('compositionScheme')
      return (
        <div className="reg-grid">
          <div className="reg-col reg-col--wide">
            <div className="reg-stack">
              <GstNumberField register={register} errors={errors} compositionScheme={compositionScheme} editingCustomerId={editingCustomerId} />
              <Controller
                name="compositionScheme"
                control={control}
                render={({ field: { value, onChange, ...field } }) => (
                  <label className="reg-checkbox-label">
                    <input
                      type="checkbox"
                      {...field}
                      checked={Boolean(value)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        onChange(checked)
                        if (checked) {
                          setValue('gstNumber', '', { shouldValidate: true })
                          clearErrors('gstNumber')
                        }
                      }}
                    />
                    <span>
                      Declaration under Composition Scheme (no GSTIN held)
                      <span className="reg-tooltip" title="Composition-scheme dealers are not issued a standard GSTIN. Checking this exempts the GST Number field and records a compliance declaration instead."> ⓘ</span>
                    </span>
                  </label>
                )}
              />
            </div>
          </div>
          <div className="reg-col">
            <DrugLicenceNumberField register={register} errors={errors} editingCustomerId={editingCustomerId} />
          </div>
          <div className="reg-col">
            <div className="reg-field">
              <label>Drug Licence Valid Till *</label>
              <input className="reg-input" type="date" min={new Date().toISOString().split('T')[0]} {...register('drugLicenceValidTill', { validate: futureDateValidator })} />
              {errors.drugLicenceValidTill
                ? <span className="reg-err">{errors.drugLicenceValidTill.message}</span>
                : <span className="reg-hint">Future dates only</span>
              }
            </div>
          </div>
        </div>
      )
    },
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
    { label: 'Pharmacy name',        value: values.pharmacyName },
    { label: 'Linked doctor',        value: values.linkedDoctor?.name },
    { label: "Doctor's registration number", value: values.linkedDoctorRegistrationNumber },
    { label: 'Email',                value: values.email },
    { label: 'Mobile',               value: values.mobile },
    { label: 'GSTIN / Composition',  value: values.compositionScheme ? 'Composition scheme declared' : values.gstNumber },
    { label: 'Drug licence no.',     value: values.drugLicenceNumber },
    { label: 'Licence valid till',   value: values.drugLicenceValidTill ? dayjs(values.drugLicenceValidTill).format('DD MMM YYYY') : '' },
    { label: 'PAN',                  value: values.panNumber },
    { label: 'Aadhaar',              value: values.aadhaarNumber },
  ]
}

function PharmacyForm({ isEditMode, isAdminEditMode, editingCustomer }) {
  const { rules } = useDivisionConfig()
  const documents = rules.documents.customer['doctor-pharmacy']
  const documentsSection = buildDocumentsSection(documents)
  const sections = documentsSection ? [...STATIC_SECTIONS, documentsSection] : STATIC_SECTIONS
  const defaultValues = (isEditMode || isAdminEditMode)
    ? mapCustomerToFormValues(editingCustomer)
    : { ...PHARMACY_DEFAULT_VALUES, ...documentDefaultValues(documents) }

  return (
    <RegistrationFormBase
      customerType="doctor-pharmacy"
      customerTypeLabel="Doctor Pharmacy"
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

export default PharmacyForm
