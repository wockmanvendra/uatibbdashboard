import { fmtDateOnly } from '../utils/format.js'

export function Field({ label, value, mono }) {
  if (value == null || value === '') return null
  return (
    <div className="customer-detail__field">
      <p className="customer-detail__field-label">{label}</p>
      <p className={`customer-detail__field-value${mono ? ' customer-detail__field-value--mono' : ''}`}>{value}</p>
    </div>
  )
}

export function IdentitySection({ customer }) {
  return (
    <section className="customer-detail__card">
      <p className="customer-detail__card-title">Identity &amp; contact</p>
      <div className="customer-detail__field-grid">
        <Field label="Full name" value={customer.name} />
        {customer.age   != null && <Field label="Age"    value={customer.age} />}
        {customer.gender       && <Field label="Gender"  value={customer.gender} />}
        <Field label="Mobile" value={customer.mobile} />
        <Field label="Email"  value={customer.email} />
      </div>
    </section>
  )
}

// Read-only Address block. CustomerDetailPage renders its own editable
// version instead of this (only approvers may edit a customer's address).
export function AddressSection({ customer }) {
  return (
    <section className="customer-detail__card">
      <p className="customer-detail__card-title">Address</p>
      <div className="customer-detail__field-grid customer-detail__field-grid--2">
        <Field label="Address"  value={customer.address} />
        <Field label="PIN code" value={customer.pinCode} />
        <Field label="City"     value={customer.city} />
        <Field label="State"    value={customer.state} />
      </div>
    </section>
  )
}

export function DistributionSection({ customer }) {
  return (
    <section className="customer-detail__card">
      <p className="customer-detail__card-title">Distribution</p>
      <div className="customer-detail__field-grid customer-detail__field-grid--2">
        <Field label="CFA"      value={customer.cfaName ? `${customer.cfaName} (${customer.cfaCode})` : customer.cfaCode} mono />
        <Field label="Division" value={customer.divisionName ? `${customer.divisionName} (${customer.divisionCode})` : customer.divisionCode} mono />
      </div>
    </section>
  )
}

export function TypeSpecificSections({ customer }) {
  return (
    <>
      {customer.customerType === 'doctor' && (
        <section className="customer-detail__card">
          <p className="customer-detail__card-title">Medical registration</p>
          <div className="customer-detail__field-grid">
            <Field label="Registration no." value={customer.registrationNumber} mono />
            {customer.selectedDoctorSpeciality     && <Field label="Speciality"     value={customer.selectedDoctorSpeciality} />}
            {customer.selectedDoctorDmlCode        && <Field label="DML code"       value={customer.selectedDoctorDmlCode} mono />}
            {customer.selectedDoctorClassification && <Field label="Classification" value={customer.selectedDoctorClassification} />}
            <Field label="PAN"              value={customer.panNumber} mono />
            <Field label="Aadhaar (last 4)" value={customer.aadhaarNumber ? `····  ····  ${String(customer.aadhaarNumber).slice(-4)}` : null} mono />
          </div>
        </section>
      )}

      {customer.customerType === 'doctor-pharmacy' && (
        <>
          <section className="customer-detail__card">
            <p className="customer-detail__card-title">Linked doctor</p>
            <div className="customer-detail__field-grid">
              <Field label="Doctor name"  value={customer.linkedDoctorName} />
              {customer.linkedDoctorDmlCode    && <Field label="DML code"   value={customer.linkedDoctorDmlCode} mono />}
              {customer.linkedDoctorSpeciality && <Field label="Speciality" value={customer.linkedDoctorSpeciality} />}
            </div>
          </section>
          <section className="customer-detail__card">
            <p className="customer-detail__card-title">Pharmacy compliance</p>
            <div className="customer-detail__field-grid">
              <Field label="GST number"         value={customer.gstNumber} mono />
              <Field label="Composition scheme" value={customer.compositionScheme === true ? 'Yes' : customer.compositionScheme === false ? 'No' : null} />
              <Field label="Drug licence no."   value={customer.drugLicenceNumber} mono />
              <Field label="Licence valid till" value={customer.drugLicenceValidTill ? fmtDateOnly(customer.drugLicenceValidTill) : null} />
              <Field label="PAN"                value={customer.panNumber} mono />
              <Field label="Aadhaar (last 4)"   value={customer.aadhaarNumber ? `····  ····  ${String(customer.aadhaarNumber).slice(-4)}` : null} mono />
            </div>
          </section>
        </>
      )}

      {customer.customerType === 'hospital' && (
        <>
          <section className="customer-detail__card">
            <p className="customer-detail__card-title">Hospital registration</p>
            <div className="customer-detail__field-grid">
              <Field label="Hospital reg. no."  value={customer.hospitalRegistrationNumber} mono />
            </div>
          </section>
          <section className="customer-detail__card">
            <p className="customer-detail__card-title">Compliance</p>
            <div className="customer-detail__field-grid">
              <Field label="GST number"         value={customer.gstNumber} mono />
              <Field label="Composition scheme" value={customer.compositionScheme === true ? 'Yes' : customer.compositionScheme === false ? 'No' : null} />
              <Field label="Drug licence no."   value={customer.drugLicenceNumber} mono />
              <Field label="Licence valid till" value={customer.drugLicenceValidTill ? fmtDateOnly(customer.drugLicenceValidTill) : null} />
              <Field label="PAN"                value={customer.panNumber} mono />
              <Field label="Aadhaar (last 4)"   value={customer.aadhaarNumber ? `····  ····  ${String(customer.aadhaarNumber).slice(-4)}` : null} mono />
            </div>
          </section>
        </>
      )}
    </>
  )
}

export function DocumentsSection({ customer, rules }) {
  const docConfig = rules.documents.customer[customer.customerType] ?? []
  if (docConfig.length === 0) return null

  return (
    <section className="customer-detail__card">
      <p className="customer-detail__card-title">Documents</p>
      <ul className="customer-detail__docs">
        {docConfig.map((doc) => {
          const entry = customer.documents?.[doc.key] ?? {}
          const url   = entry.url ?? null
          const name  = entry.name ?? null
          const unavailable = entry.unavailable === true
          const submitted = url != null || name != null || unavailable
          const isGstDoc  = /gst/i.test(doc.key) || /gst/i.test(doc.label ?? '')
          const isRequired = doc.required && !(customer.compositionScheme && isGstDoc)
          return (
            <li key={doc.key} className="customer-detail__docs-row">
              <svg viewBox="0 0 16 20" width="13" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 1 L9 6 L14 6 M9 1 L2 1 Q1 1 1 2 L1 18 Q1 19 2 19 L14 19 Q15 19 15 18 L15 6 Z" />
                <path d="M4 10 L12 10 M4 13 L10 13" />
              </svg>
              <span className="customer-detail__docs-name">{doc.label}</span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="customer-detail__docs-link"
                  title="View document"
                >
                  View
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{ marginLeft: '0.3em', flexShrink: 0 }}>
                    <path d="M7 2H2Q1 2 1 3V14Q1 15 2 15H13Q14 15 14 14V9M10 1H15M15 1V6M15 1L7 9" />
                  </svg>
                </a>
              ) : unavailable ? (
                <span
                  className="customer-detail__docs-status customer-detail__docs-status--error"
                  title="The document is on file but couldn't be retrieved right now — please try again shortly"
                >
                  Unavailable — try again shortly
                </span>
              ) : (
                <span className={`customer-detail__docs-status customer-detail__docs-status--${submitted ? 'ok' : 'missing'}`}>
                  {submitted ? 'Submitted' : 'Not submitted'}
                  {isRequired && !submitted && ' (required)'}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Full read-only profile — Identity, Address, Distribution, customer-type-specific
// sections, and Documents — for contexts with no editing/approval chrome at all
// (e.g. CustomerOverviewDashboard's profile section). CustomerDetailPage renders
// the individual sections itself instead, so it can keep its own editable Address block.
function CustomerProfileFields({ customer, rules }) {
  return (
    <>
      <IdentitySection customer={customer} />
      <AddressSection customer={customer} />
      <DistributionSection customer={customer} />
      <TypeSpecificSections customer={customer} />
      <DocumentsSection customer={customer} rules={rules} />
    </>
  )
}

export default CustomerProfileFields
