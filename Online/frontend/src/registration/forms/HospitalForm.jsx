import { Controller } from 'react-hook-form'
import dayjs from 'dayjs'
import RegistrationFormBase from '../components/RegistrationFormBase.jsx'
import AddressFields from '../components/AddressFields.jsx'
import { SapTerritoryCodeField } from '../components/SapCodeField.jsx'
import { GstNumberField, DrugLicenceNumberField } from '../components/ComplianceFields.jsx'
import { PanNumberField, AadhaarNumberField } from '../components/KycFields.jsx'
import { EmailField, MobileField } from '../components/ContactFields.jsx'
import { buildDocumentsSection, documentDefaultValues } from '../components/buildDocumentsSection.jsx'
import { mapCustomerToFormValues } from '../mapCustomerToFormValues.js'
import { useDivisionConfig } from '../../context/DivisionConfigContext.jsx'
import { futureDateValidator, required } from '../validation.js'

export const HOSPITAL_DEFAULT_VALUES = {
  hospitalName:                '',
  email:                       '',
  mobile:                      '',
  address:                     '',
  pinCode:                     '',
  city:                        '',
  state:                       '',
  cfaCode:                     '',
  securityCheque:              null,
  gstNumber:                   '',
  compositionScheme:           false,
  hospitalRegistrationNumber:  '',
  drugLicenceNumber:           '',
  drugLicenceValidTill:        '',
  panNumber:                   '',
  aadhaarNumber:               '',
}

const STATIC_SECTIONS = [
  {
    key:    'hospital-contact-address',
    label:  'Hospital',
    icon:   null,
    title:  'Hospital, contact & address',
    fields: ['hospitalName', 'email', 'mobile', 'address', 'pinCode', 'city', 'state', 'cfaCode'],
    render: ({ register, control, errors, setValue, clearErrors, editingCustomerId, editingCustomer, isAdminEditMode, divisionCode, user }) => (
      <>
        {isAdminEditMode && editingCustomer?.customerCode && (
          <div className="reg-grid">
            <div className="reg-col reg-col--wide">
              <div className="reg-admin-locked-chip">DML Code: <span className="reg-admin-locked-chip__code">{editingCustomer.customerCode}</span> — locked</div>
            </div>
          </div>
        )}
        <div className="reg-grid">
          <div className="reg-col">
            <div className="reg-field">
              <label>Hospital Name {isAdminEditMode ? <span className="reg-locked-badge">locked</span> : '*'}</label>
              <input className={`reg-input${isAdminEditMode ? ' reg-input--readonly' : ''}`} readOnly={isAdminEditMode} {...register('hospitalName', isAdminEditMode ? {} : required('Hospital name'))} />
              {errors.hospitalName && <span className="reg-err">{errors.hospitalName.message}</span>}
            </div>
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
    key:        'compliance-reg-validity',
    label:      'Compliance',
    icon:       null,
    title:      'Compliance, registration & licence',
    subtitle:   'Provide a GSTIN or declare the composition scheme, then add registration and licence details.',
    fields:     ['gstNumber', 'hospitalRegistrationNumber', 'drugLicenceNumber', 'drugLicenceValidTill'],
    isComplete: (values) => {
      const gstOk = values?.compositionScheme || (values?.gstNumber && String(values.gstNumber).trim() !== '')
      return Boolean(
        gstOk &&
        values?.hospitalRegistrationNumber && String(values.hospitalRegistrationNumber).trim() !== '' &&
        values?.drugLicenceNumber && String(values.drugLicenceNumber).trim() !== '' &&
        values?.drugLicenceValidTill && String(values.drugLicenceValidTill).trim() !== '',
      )
    },
    render: ({ register, control, errors, watch, setValue, clearErrors, editingCustomerId }) => {
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
            <div className="reg-field">
              <label>Hospital Registration Number *</label>
              <input className="reg-input" maxLength={20} {...register('hospitalRegistrationNumber', required('Hospital registration number'))} />
              {errors.hospitalRegistrationNumber
                ? <span className="reg-err">{errors.hospitalRegistrationNumber.message}</span>
                : <span className="reg-hint">As shown on the hospital's statutory registration certificate</span>
              }
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
    { label: 'Hospital name',       value: values.hospitalName },
    { label: 'Email',               value: values.email },
    { label: 'Mobile',              value: values.mobile },
    { label: 'GSTIN / Composition', value: values.compositionScheme ? 'Composition scheme declared' : values.gstNumber },
    { label: 'Hospital reg. no.',   value: values.hospitalRegistrationNumber },
    { label: 'Drug licence no.',    value: values.drugLicenceNumber },
    { label: 'Licence valid till',  value: values.drugLicenceValidTill ? dayjs(values.drugLicenceValidTill).format('DD MMM YYYY') : '' },
    { label: 'PAN',                 value: values.panNumber },
    { label: 'Aadhaar',             value: values.aadhaarNumber },
  ]
}

function HospitalForm({ isEditMode, isAdminEditMode, editingCustomer }) {
  const { rules } = useDivisionConfig()
  const documents = rules.documents.customer.hospital
  const documentsSection = buildDocumentsSection(documents)
  const sections = documentsSection ? [...STATIC_SECTIONS, documentsSection] : STATIC_SECTIONS
  const defaultValues = (isEditMode || isAdminEditMode)
    ? mapCustomerToFormValues(editingCustomer)
    : { ...HOSPITAL_DEFAULT_VALUES, ...documentDefaultValues(documents) }

  return (
    <RegistrationFormBase
      customerType="hospital"
      customerTypeLabel="Hospital"
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

export default HospitalForm
