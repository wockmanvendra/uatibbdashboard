import { createContext, useContext, useEffect, useState } from 'react'
import { nextCustomerStatus } from '../data/workflow.js'
import { customersApi, uploadsApi } from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'
import { useDivisionConfig } from './DivisionConfigContext.jsx'

const CustomersContext = createContext(null)

const NAME_FIELD = {
  patient:           'fullName',
  doctor:            'doctorName',
  'doctor-pharmacy': 'pharmacyName',
  hospital:          'hospitalName',
}


export function CustomersProvider({ children }) {
  const { user } = useAuth()
  const { rules } = useDivisionConfig()
  const [customers, setCustomers] = useState([])
  const [customersError, setCustomersError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!user) return
    // dm has cross-division access (backend scope no longer restricts by
    // division for dm) — fetch every cfa-scoped customer and let the dm
    // dashboard's division picker narrow it down client-side.
    const params = (user.divisionCode && user.usertype !== 'dm') ? { division_code: user.divisionCode } : {}
    setCustomersError(null)
    customersApi.list(params).then(setCustomers).catch(err => {
      // Surfaced as customersError rather than left as a silently-empty
      // list — an empty array here is otherwise indistinguishable from
      // "this user genuinely has zero customers."
      console.error(err)
      setCustomersError(err.message || 'Failed to load customers.')
    })
  }, [user?.divisionCode, user?.usertype, reloadToken])

  const reloadCustomers = () => setReloadToken(t => t + 1)

  // Shared by registerCustomer and resubmitCustomer — uploads any File values,
  // flattens directory objects, and builds the snake_case payload. Values that
  // are already { url, blobName, originalName } (e.g. an unchanged document on
  // resubmit) pass through untouched since only `instanceof File` triggers a
  // re-upload. customerId nests uploaded documents under the owning customer's
  // own uuid in blob storage (see uploadsApi.upload's entityId) — for a brand
  // new registration this is generated client-side ahead of time, since the
  // customer row doesn't exist yet.
  const buildCustomerPayload = async (customerType, formData, registeredBy, customerId) => {
    const processed = { ...formData }
    await Promise.all(
      Object.entries(processed).map(async ([key, value]) => {
        if (value instanceof File) {
          try {
            processed[key] = await uploadsApi.upload(value, 'customers', customerId)
          } catch {
            throw new Error(`Failed to upload "${key}". Please check your file and try again.`)
          }
        }
      })
    )

    // Flatten directory objects into individual fields
    const sd  = processed.selectedDoctor  ?? {}
    const ld  = processed.linkedDoctor    ?? {}
    const sp  = processed.selectedPharmacy ?? {}

    // Collect uploaded documents — any value that resolved to { url } after the
    // upload step is a document, regardless of which division rule key named it.
    // The persisted `url` is blobName when available (the durable Azure blob
    // key, from a fresh upload or a passed-through unchanged document) —
    // falling back to `url` only covers pre-migration rows that never had one.
    const documents = Object.entries(processed)
      .filter(([, value]) => value != null && typeof value === 'object' && !Array.isArray(value) && (value.blobName || value.url))
      .map(([key, value]) => ({
        doc_type:      key,
        url:           value.blobName ?? value.url,
        original_name: value.originalName ?? value.name ?? null,
      }))

    return {
      id:             customerId,
      customer_type:  customerType,
      name:           formData[NAME_FIELD[customerType]] ?? 'Unknown',
      email:          processed.email    ?? null,
      mobile:         processed.mobile   ?? null,
      address:        processed.address  ?? null,
      pin_code:       processed.pinCode  ?? null,
      city:           processed.city     ?? null,
      state:          processed.state    ?? null,
      cfa_code:       processed.cfaCode  ?? null,
      division_code:  registeredBy?.divisionCode ?? processed.divisionCode ?? null,
      registered_by:  registeredBy?.id   ?? null,

      // scalar type-specific fields
      age:                          processed.age              ?? null,
      gender:                       processed.gender           ?? null,
      registration_number:          processed.registrationNumber ?? null,
      gst_number:                   processed.gstNumber        ?? null,
      composition_scheme:           processed.compositionScheme ?? null,
      drug_licence_number:          processed.drugLicenceNumber ?? null,
      drug_licence_valid_till:      processed.drugLicenceValidTill
                                      ? (processed.drugLicenceValidTill.format?.('YYYY-MM-DD') ?? processed.drugLicenceValidTill)
                                      : null,
      pan_number:                   processed.panNumber        ?? null,
      aadhaar_number:               processed.aadhaarNumber    ?? null,
      hospital_registration_number: processed.hospitalRegistrationNumber ?? null,

      // flattened directory objects
      selected_doctor_dml_code:        sd.dmlCode        ?? null,
      selected_doctor_name:            sd.name           ?? null,
      selected_doctor_speciality:      sd.speciality     ?? null,
      selected_doctor_classification:  sd.classification ?? null,
      linked_doctor_dml_code:          ld.dmlCode        ?? null,
      linked_doctor_name:              ld.name           ?? null,
      linked_doctor_speciality:        ld.speciality     ?? null,
      linked_doctor_registration_number: processed.linkedDoctorRegistrationNumber ?? null,
      selected_pharmacy_cml_code:      sp.cmlCode        ?? null,
      selected_pharmacy_name:          sp.name           ?? null,

      // sap_code intentionally omitted — the backend stamps it from the
      // registering user's own SAP territory code (req.user.sapCode),
      // never from client-submitted form state.

      // uploaded documents (one row per doc_type in customer_documents)
      documents,
    }
  }

  // registeredBy: { id, name, usertype, divisionCode }
  const registerCustomer = async (customerType, formData, registeredBy) => {
    // Generated up front so any documents uploaded during buildCustomerPayload
    // nest under this customer's own uuid in blob storage, and so it becomes
    // the row's actual id once created (see customers.js POST /).
    const customerId = crypto.randomUUID()
    const payload = await buildCustomerPayload(customerType, formData, registeredBy, customerId)
    const record = await customersApi.register(payload)
    setCustomers(curr => [record, ...curr])
    return record
  }

  // Edits a rejected customer's full contents (customer_type stays locked) and
  // restarts the approval chain.
  const resubmitCustomer = async (customerId, formData) => {
    const customer = customers.find(c => c.id === customerId)
    const payload = await buildCustomerPayload(customer?.customerType, formData, undefined, customerId)
    const updated = await customersApi.resubmit(customerId, payload)
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
    return updated
  }

  // Admin/super-admin edit of an approved customer — does not reset approval_status.
  // Name and mobile are locked server-side; omitted from payload here too.
  const adminUpdateCustomer = async (customerId, formData) => {
    const customer = customers.find(c => c.id === customerId)
    const payload = await buildCustomerPayload(customer?.customerType, formData, undefined, customerId)
    // Strip the identity fields that must not change
    delete payload.name
    delete payload.mobile
    const updated = await customersApi.adminUpdate(customerId, payload)
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
    return updated
  }

  const updateCustomer = async (customerId, fields) => {
    const updated = await customersApi.update(customerId, fields)
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
    return updated
  }

  const approveCustomer = async (customerId, approver) => {
    const customer = customers.find(c => c.id === customerId)
    if (!customer) return
    const nextStatus = nextCustomerStatus(rules.customerWorkflow, customer.approvalStatus)
    if (!nextStatus) return
    const updated = await customersApi.approve(customerId, {
      approvedBy:       approver.id,
      approvedByName:   approver.name,
      approverUsertype: approver.usertype,
    })
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
  }

  const rejectCustomer = async (customerId, approver, reason) => {
    const updated = await customersApi.reject(customerId, {
      approvedBy:       approver.id,
      approvedByName:   approver.name,
      approverUsertype: approver.usertype,
      reason,
    })
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
  }

  const refreshCustomer = async (customerId) => {
    const updated = await customersApi.get(customerId)
    setCustomers(curr => curr.map(c => c.id === customerId ? updated : c))
    return updated
  }

  return (
    <CustomersContext.Provider value={{ customers, customersError, reloadCustomers, registerCustomer, resubmitCustomer, adminUpdateCustomer, updateCustomer, approveCustomer, rejectCustomer, refreshCustomer }}>
      {children}
    </CustomersContext.Provider>
  )
}

export function useCustomers() {
  return useContext(CustomersContext)
}
