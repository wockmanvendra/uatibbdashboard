// Central API client — all fetch calls go through here.
// Transforms snake_case DB responses to the camelCase shapes the components expect.

const BASE = import.meta.env.VITE_API_URL ?? ''

let authToken = null
let onUnauthorized = () => {}

export function setAuthToken(token) { authToken = token }
export function setUnauthorizedHandler(handler) { onUnauthorized = handler }

// Uploaded-file URLs (product images, customer documents, dispatch POD, …)
// come back from the API as host-relative paths (e.g. `/uploads/xxx.pdf`),
// which only resolve correctly if the frontend and API share an origin.
// Since they may not, resolve them against the API's own origin instead.
function resolveFileUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return url
  return `${BASE}${url}`
}

// Order `extra_data` is a freeform JSON blob that can carry uploaded-file
// metadata (compliance documents, security cheque photo, …) at arbitrary
// nesting — walk it and resolve any `url` property found along the way.
function resolveUrlsDeep(value) {
  if (Array.isArray(value)) return value.map(resolveUrlsDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = key === 'url' && typeof v === 'string' ? resolveFileUrl(v) : resolveUrlsDeep(v)
    }
    return out
  }
  return value
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    ...options,
  })
  if (res.status === 401) onUnauthorized()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Transforms ────────────────────────────────────────────────────────────────

function transformScheme(s) {
  return {
    id:        s.id,
    productId: s.product_id,
    label:     s.label,
    type:      s.scheme_type === 'gift' ? 'gift' : undefined,
    buyQty:    s.buy_qty,
    freeQty:   s.free_qty,
    minQty:    s.min_qty,
    giftName:  s.gift_name,
    giftValue: s.gift_value != null ? Number(s.gift_value) : undefined,
  }
}

export function transformProduct(p) {
  return {
    id:           p.id,
    name:         p.name,
    brand:        p.brand,
    materialCode: p.material_code,
    divisionCode: p.division_code,
    price:        Number(p.price),
    description:  p.description,
    minOrderQty:  p.min_order_qty,
    initMinOrderQty: p.init_min_order_qty,
    maxOrderQty:  p.max_order_qty,
    accent:       p.accent,
    image:        resolveFileUrl(p.image_url),
    // durable Azure blob key — reused when re-saving a product without
    // changing its image, so the DB doesn't end up storing an expiring SAS link
    imageBlobName: p.image_blob_name ?? null,
    unit:         p.unit,
    unitDescription: p.unit_description,
    isActive:     p.is_active,
    schemes:      (p.schemes || []).map(transformScheme),
  }
}

const CUSTOMER_TYPE_LABELS = {
  patient:           'Patient',
  doctor:            'Doctor',
  'doctor-pharmacy': 'Doctor Pharmacy',
  hospital:          'Hospital',
}

export function transformCustomer(c) {
  return {
    id:             c.id,
    customerType:   c.customer_type,
    customerCode:   c.customer_code,
    name:           c.name,
    email:          c.email,
    mobile:         c.mobile,
    address:        c.address,
    pinCode:        c.pin_code,
    city:           c.city,
    state:          c.state,
    cfaCode:        c.cfa_code,
    cfaName:        c.cfa_name ?? null,
    divisionCode:   c.division_code,
    divisionName:   c.division_name ?? null,
    approvalStatus: c.approval_status,
    rejectionReason: c.rejection_reason ?? null,
    registeredAt:   c.registered_at,
    registeredBy:   c.registered_by ? {
      id:       c.registered_by,
      name:     c.registered_by_name,
      usertype: c.registered_by_usertype,
    } : null,
    outstandingAmount:   c.outstanding_amount != null ? Number(c.outstanding_amount) : 0,
    outstandingSince:    c.outstanding_since ?? null,
    // Business formula: outstanding = approved-but-unpaid orders + the SAP
    // ledger above. Aging comes only from these orders' approval date, never
    // from outstandingSince or an order's placedAt.
    outstandingOrdersTotal:          c.outstanding_orders_total != null ? Number(c.outstanding_orders_total) : 0,
    outstandingOrdersOldestApprovedAt: c.outstanding_orders_oldest_approved_at ?? null,
    pendingOrdersTotal:  c.pending_orders_total != null ? Number(c.pending_orders_total) : 0,
    sapCustomerCode:   c.sap_customer_code ?? null,
    sapCode:           c.sap_code ?? null,
    // used by the customer picker modal
    type: CUSTOMER_TYPE_LABELS[c.customer_type] ?? c.customer_type,
    // type-specific flat columns (formerly extra_data JSONB)
    age:                          c.age != null ? Number(c.age) : null,
    gender:                       c.gender ?? null,
    registrationNumber:           c.registration_number ?? null,
    selectedDoctorDmlCode:        c.selected_doctor_dml_code ?? null,
    selectedDoctorName:           c.selected_doctor_name ?? null,
    selectedDoctorSpeciality:     c.selected_doctor_speciality ?? null,
    selectedDoctorClassification: c.selected_doctor_classification ?? null,
    gstNumber:                    c.gst_number ?? null,
    compositionScheme:            c.composition_scheme ?? null,
    drugLicenceNumber:            c.drug_licence_number ?? null,
    drugLicenceValidTill:         c.drug_licence_valid_till ?? null,
    panNumber:                    c.pan_number ?? null,
    aadhaarNumber:                c.aadhaar_number ?? null,
    linkedDoctorDmlCode:          c.linked_doctor_dml_code ?? null,
    linkedDoctorName:             c.linked_doctor_name ?? null,
    linkedDoctorSpeciality:       c.linked_doctor_speciality ?? null,
    linkedDoctorRegistrationNumber: c.linked_doctor_registration_number ?? null,
    selectedPharmacyCmlCode:      c.selected_pharmacy_cml_code ?? null,
    selectedPharmacyName:         c.selected_pharmacy_name ?? null,
    hospitalRegistrationNumber:   c.hospital_registration_number ?? null,
    // uploaded documents, keyed by doc_type (signedRegistrationForm, gstCertificate, …)
    // blobName is the durable Azure blob key — carried through so an unchanged
    // document (not re-uploaded) can round-trip into a later resubmit/edit even
    // after its `url` (a short-lived SAS link) has expired.
    documents: (c.documents || []).reduce((acc, d) => {
      acc[d.doc_type] = {
        url: resolveFileUrl(d.url ?? null),
        blobName: d.blob_name ?? null,
        name: d.original_name ?? null,
        // set when the backend had a document but couldn't mint a view link
        // (e.g. an Azure Blob outage) — distinct from "never uploaded"
        unavailable: d.urlUnavailable === true,
      }
      return acc
    }, {}),
    // additional saved delivery addresses, beyond the primary address above
    addresses: (c.addresses || []).map(a => ({
      id:      a.id,
      label:   a.label ?? null,
      address: a.address,
      pinCode: a.pin_code,
      city:    a.city,
      state:   a.state,
    })),
  }
}

function transformOrderItem(item) {
  return {
    id:            item.id,
    cartItemId:    `oi-${item.id}`,   // stable React key
    productId:     item.product_id,
    productName:   item.product_name,
    materialCode:  item.material_code,
    orderedQty:    item.quantity,     // DB uses quantity; components expect orderedQty
    freeQty:       item.free_qty,
    unitPrice:     item.unit_price != null ? Number(item.unit_price) : null,
    schemeLabel:   item.scheme_label,
    discountValue: item.discount_value != null ? Number(item.discount_value) : 0,
    lineTotal:     item.line_total != null ? Number(item.line_total) : null,
  }
}

export function transformOrder(o) {
  return {
    id:             o.id,
    orderNumber:    o.order_number,
    placedAt:       o.placed_at,
    approvedAt:     o.approved_at ?? null,
    status:         o.status,
    approvalStatus: o.approval_status,
    rejectionReason: o.rejection_reason ?? null,
    divisionCode:   o.division_code,
    placedBy: o.placed_by ? {
      id:       o.placed_by,
      name:     o.placed_by_name,
      usertype: o.placed_by_usertype,
    } : null,
    orderingFor: o.ordering_for_id ? {
      id:           o.ordering_for_id,
      name:         o.ordering_for_name,
      type:         o.ordering_for_type,
      customerCode: o.ordering_for_code,
    } : null,
    itemCount:     o.item_count,
    totalUnits:    Number(o.total_units),
    totalPayable:  Number(o.total_payable),
    totalDiscount: Number(o.total_discount),
    items:         (o.items || []).map(transformOrderItem),
    extraData:     resolveUrlsDeep(o.extra_data),
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    deliveryAddress: o.delivery_address ? {
      address: o.delivery_address,
      pinCode: o.delivery_pin_code,
      city:    o.delivery_city,
      stateCode: o.delivery_state_code,
    } : null,
    cfaCode: o.cfa_code,
    cfaName: o.cfa_name ?? null,
    lrNumber: o.lr_number ?? null,
    lrDate: o.lr_date ?? null,
    sapOrderNumber: o.sap_order_number ?? null,
    podUrl: resolveFileUrl(o.pod_url ?? null),
    // durable Azure blob key — reused when re-dispatching without a new POD
    // file, so the DB doesn't end up storing an expiring SAS link
    podBlobName: o.pod_blob_name ?? null,
    podOriginalName: o.pod_original_name ?? null,
    paymentReceivedDate: o.payment_received_date ?? null,
    paymentReceivedAmount: o.payment_received_amount != null ? Number(o.payment_received_amount) : null,
  }
}

// approve | reject | resubmit row from order_approvals / customer_approvals
function transformApproval(row) {
  return {
    id:         row.id,
    step:       row.step,
    action:     row.action,
    reason:     row.reason ?? null,
    approvedAt: row.approved_at,
    approver: row.approved_by ? {
      id:       row.approved_by,
      name:     row.approved_by_name,
      usertype: row.approver_usertype,
    } : null,
  }
}

// row from payment_log — one entry per CCAvenue attempt (order or customer outstanding)
function transformPaymentLogEntry(row) {
  return {
    id:             row.id,
    status:         row.status,
    paymentMethod:  row.payment_method,
    paymentMode:    row.payment_mode,
    trackingId:     row.tracking_id,
    bankRefNo:      row.bank_ref_no,
    failureMessage: row.failure_message,
    recordedAt:     row.recorded_at,
  }
}

// ── File uploads ─────────────────────────────────────────────────────────────

export const uploadsApi = {
  upload: async (file, category, entityId) => {
    const form = new FormData()
    form.append('file', file)
    if (category) form.append('category', category)
    if (entityId) form.append('entityId', entityId)
    const res = await fetch(`${BASE}/uploads`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { url, blobName, originalName, size } — persist blobName, url is a short-lived preview link
  },
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  requestOtp:          (mobileno)               => request('/auth/otp/request',          { method: 'POST', body: JSON.stringify({ mobileno }) }),
  verifyOtp:           (mobileno, otp)          => request('/auth/otp/verify',           { method: 'POST', body: JSON.stringify({ mobileno, otp }) }),
  loginPassword:       (mobileno, password)     => request('/auth/password',             { method: 'POST', body: JSON.stringify({ mobileno, password }) }),
  changePassword:      (changeToken, newPassword) => request('/auth/change-password',    { method: 'POST', body: JSON.stringify({ changeToken, newPassword }) }),
  forgotPassword:      (mobileno)               => request('/auth/forgot-password',      { method: 'POST', body: JSON.stringify({ mobileno }) }),
  forgotPasswordVerify:(mobileno, otp)          => request('/auth/forgot-password/verify',{ method: 'POST', body: JSON.stringify({ mobileno, otp }) }),
}

export const lockedUsersApi = {
  list:   (divisionCode) => request(`/admin/locked-users${divisionCode ? `?division=${divisionCode}` : ''}`),
  unlock: (userId)       => request(`/admin/unlock-user/${userId}`, { method: 'POST' }),
}

export const overviewApi = {
  get: (divisionCode, months) => {
    const params = new URLSearchParams({ division_code: divisionCode })
    if (months && months.length > 0) params.set('months', months.join(','))
    return request(`/admin/overview?${params}`)
  },
  territories: ()             => request('/overview/territories'),
  regions:     ()             => request('/overview/regions'),
  zones:       (divisionCode) => request(divisionCode ? `/overview/zones?division_code=${encodeURIComponent(divisionCode)}` : '/overview/zones'),
}

export const emailTestApi = {
  send: (to) => request('/admin/test-email', { method: 'POST', body: JSON.stringify({ to }) }),
}

// ── Products ──────────────────────────────────────────────────────────────────

export const productsApi = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const data = await request(`/products${qs ? `?${qs}` : ''}`)
    return data.map(transformProduct)
  },

  create: async (payload) => {
    const data = await request('/products', { method: 'POST', body: JSON.stringify(payload) })
    return transformProduct(data)
  },

  update: async (id, payload) => {
    const data = await request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return transformProduct(data)
  },

  bulkUpload: async (file, divisionCode) => {
    const form = new FormData()
    form.append('file', file)
    if (divisionCode) form.append('division_code', divisionCode)
    const res = await fetch(`${BASE}/products/upload`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { success, count, skipped, skippedRows }
  },

  downloadBulkUploadTemplate: async () => {
    const res = await fetch(`${BASE}/products/upload/template`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },
}

// ── Customers ─────────────────────────────────────────────────────────────────

export const customersApi = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const data = await request(`/customers${qs ? `?${qs}` : ''}`)
    return data.map(transformCustomer)
  },

  get: async (id) => {
    const data = await request(`/customers/${id}`)
    return transformCustomer(data)
  },

  checkRegistrationNumber: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-registration-number?${params}`)
  },

  checkGstNumber: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-gst-number?${params}`)
  },

  checkDrugLicenceNumber: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-drug-licence-number?${params}`)
  },

  checkPanNumber: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-pan-number?${params}`)
  },

  checkAadhaarNumber: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-aadhaar-number?${params}`)
  },

  checkEmail: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-email?${params}`)
  },

  checkMobile: async (value, excludeCustomerId) => {
    const params = new URLSearchParams({ value })
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    return request(`/customers/check-mobile?${params}`)
  },

  register: async (payload) => {
    const data = await request('/customers', { method: 'POST', body: JSON.stringify(payload) })
    return transformCustomer(data)
  },

  update: async (id, fields) => {
    const data = await request(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
    return transformCustomer(data)
  },

  approve: async (id, { approvedBy, approvedByName, approverUsertype }) => {
    const data = await request(`/customers/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ approved_by: approvedBy, approved_by_name: approvedByName, approved_by_usertype: approverUsertype }),
    })
    return transformCustomer(data)
  },

  reject: async (id, { approvedBy, approvedByName, approverUsertype, reason }) => {
    const data = await request(`/customers/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ approved_by: approvedBy, approved_by_name: approvedByName, approved_by_usertype: approverUsertype, reason }),
    })
    return transformCustomer(data)
  },

  resubmit: async (id, payload) => {
    const data = await request(`/customers/${id}/resubmit`, { method: 'PUT', body: JSON.stringify(payload) })
    return transformCustomer(data)
  },

  adminUpdate: async (id, payload) => {
    const data = await request(`/customers/${id}/admin-edit`, { method: 'PUT', body: JSON.stringify(payload) })
    return transformCustomer(data)
  },

  getApprovals: async (id) => {
    const data = await request(`/customers/${id}/approvals`)
    return data.map(transformApproval)
  },

  getPaymentLog: async (id) => {
    const data = await request(`/customers/${id}/payment-log`)
    return data.map(transformPaymentLogEntry)
  },

  addAddress: async (customerId, { label, address, pinCode, city, state }) => {
    const data = await request(`/customers/${customerId}/addresses`, {
      method: 'POST',
      body: JSON.stringify({ label, address, pin_code: pinCode, city, state }),
    })
    return { id: data.id, label: data.label ?? null, address: data.address, pinCode: data.pin_code, city: data.city, state: data.state }
  },

  bulkUpload: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/customers/upload`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { success, count, skipped, skippedRows }
  },

  downloadBulkUploadTemplate: async () => {
    const res = await fetch(`${BASE}/customers/upload/template`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },

  downloadCsv: async (id) => {
    const res = await fetch(`${BASE}/customers/${id}/csv`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },
}

// ── Orders ────────────────────────────────────────────────────────────────────

export const ordersApi = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const data = await request(`/orders${qs ? `?${qs}` : ''}`)
    return data.map(transformOrder)
  },

  get: async (id) => {
    const data = await request(`/orders/${id}`)
    return transformOrder(data)
  },

  place: async (payload) => {
    const data = await request('/orders', { method: 'POST', body: JSON.stringify(payload) })
    return transformOrder(data)
  },

  approve: async (id, { approvedBy, approvedByName, approverUsertype }) => {
    const data = await request(`/orders/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ approved_by: approvedBy, approved_by_name: approvedByName, approved_by_usertype: approverUsertype }),
    })
    return transformOrder(data)
  },

  reject: async (id, { approvedBy, approvedByName, approverUsertype, reason }) => {
    const data = await request(`/orders/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ approved_by: approvedBy, approved_by_name: approvedByName, approved_by_usertype: approverUsertype, reason }),
    })
    return transformOrder(data)
  },

  resubmit: async (id, payload) => {
    const data = await request(`/orders/${id}/resubmit`, { method: 'PUT', body: JSON.stringify(payload) })
    return transformOrder(data)
  },

  getApprovals: async (id) => {
    const data = await request(`/orders/${id}/approvals`)
    return data.map(transformApproval)
  },

  getPaymentLog: async (id) => {
    const data = await request(`/orders/${id}/payment-log`)
    return data.map(transformPaymentLogEntry)
  },

  // CFA-only: record LR Number/LR Date/SAP order number/POD/remarks on an approved order.
  updateDispatch: async (id, { lrNumber, lrDate, sapOrderNumber, podUrl, podOriginalName, remarks } = {}) => {
    const data = await request(`/orders/${id}/dispatch`, {
      method: 'PATCH',
      body: JSON.stringify({
        lr_number: lrNumber, lr_date: lrDate, sap_order_number: sapOrderNumber,
        pod_url: podUrl, pod_original_name: podOriginalName, remarks,
      }),
    })
    return transformOrder(data)
  },

  bulkUploadDispatch: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/orders/dispatch/upload`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { success, count, skipped, skippedRows }
  },

  downloadDispatchUploadTemplate: async () => {
    const res = await fetch(`${BASE}/orders/dispatch/upload/template`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },

  // CFA-only: manually confirm payment received on a non-online, approved order.
  updatePayment: async (id, { paymentReceivedDate, paymentReceivedAmount } = {}) => {
    const data = await request(`/orders/${id}/payment`, {
      method: 'PATCH',
      body: JSON.stringify({
        payment_received_date: paymentReceivedDate, payment_received_amount: paymentReceivedAmount,
      }),
    })
    return transformOrder(data)
  },

  // CFA-only: record cheque bank/number/date/photo for a 'pdc-delivery' order once
  // the customer hands over the physical cheque at delivery.
  updateCheque: async (id, { bankName, chequeNumber, chequeDate, chequePhotoUrl, chequePhotoOriginalName } = {}) => {
    const data = await request(`/orders/${id}/cheque`, {
      method: 'PATCH',
      body: JSON.stringify({
        bank_name: bankName, cheque_number: chequeNumber, cheque_date: chequeDate,
        cheque_photo_url: chequePhotoUrl, cheque_photo_original_name: chequePhotoOriginalName,
      }),
    })
    return transformOrder(data)
  },

  bulkUploadPayment: async (file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/orders/payment/upload`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { success, count, skipped, skippedRows }
  },

  downloadPaymentUploadTemplate: async () => {
    const res = await fetch(`${BASE}/orders/payment/upload/template`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },

  downloadCsv: async (id) => {
    const res = await fetch(`${BASE}/orders/${id}/csv`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },
}

// ── Users / hierarchy ─────────────────────────────────────────────────────────

function transformPerson(h, idKey, nameKey, usertypeKey) {
  return h[idKey] ? { id: h[idKey], name: h[nameKey], usertype: h[usertypeKey] } : null
}

function transformHierarchy(h) {
  return {
    rm:  transformPerson(h, 'rm_id',  'rm_name',  'rm_usertype'),
    zsm: transformPerson(h, 'zsm_id', 'zsm_name', 'zsm_usertype'),
    nsm: transformPerson(h, 'nsm_id', 'nsm_name', 'nsm_usertype'),
    mm:  transformPerson(h, 'mm_id',  'mm_name',  'mm_usertype'),
    dm:  transformPerson(h, 'dm_id',  'dm_name',  'dm_usertype'),
  }
}

export const usersApi = {
  getHierarchy: async (id) => {
    const data = await request(`/users/${id}/hierarchy`)
    return transformHierarchy(data)
  },
}

// ── CFA locations ─────────────────────────────────────────────────────────────

const transformCfa = c => ({ cfaCode: c.cfa_code, cfaName: c.cfa_name, mobile: c.mobile, email: c.email })

export const cfaApi = {
  list: async () => {
    const data = await request('/cfa-locations')
    return data.map(transformCfa)
  },

  create: async (payload) => {
    const data = await request('/cfa-locations', { method: 'POST', body: JSON.stringify(payload) })
    return transformCfa(data)
  },

  update: async (cfaCode, payload) => {
    const data = await request(`/cfa-locations/${cfaCode}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return transformCfa(data)
  },

  remove: (cfaCode) => request(`/cfa-locations/${cfaCode}`, { method: 'DELETE' }),

  // Looks up the CFA assigned to a state via cfa_state_master; returns null
  // when no mapping is configured (caller should show a "contact admin" hint
  // rather than letting the user pick one).
  resolveByState: async (state) => {
    const qs = new URLSearchParams({ state: state ?? '' }).toString()
    try {
      const data = await request(`/cfa-state-master/resolve?${qs}`)
      return { cfaCode: data.cfa_code, cfaName: data.cfa_name }
    } catch {
      return null
    }
  },
}

// ── CFA state master (admin-only: full state -> CFA mapping list, used to
// build the "assign CFAs to this dm/mm" picker) ──────────────────────────────

const transformCfaStateMaster = r => ({
  id:        r.id,
  stateCode: r.state_code,
  stateName: r.state_name,
  cfaCode:   r.cfa_code,
  cfaName:   r.cfa_name,
})

export const cfaStateMasterApi = {
  list: async () => {
    const data = await request('/cfa-state-master')
    return data.map(transformCfaStateMaster)
  },

  create: async (payload) => {
    const data = await request('/cfa-state-master', { method: 'POST', body: JSON.stringify(payload) })
    return data
  },

  update: (id, payload) => request(`/cfa-state-master/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  remove: (id) => request(`/cfa-state-master/${id}`, { method: 'DELETE' }),
}

// ── State master (statecode/statename reference list) ─────────────────────────

export const stateMasterApi = {
  list: async () => {
    const data = await request('/state-master')
    return data.map(s => ({ stateCode: s.state_code, stateName: s.state_name }))
  },
}

// ── Division rules (per-division approval workflow / order-entry / document config) ──

export const divisionsApi = {
  getConfig: (divisionCode) => request(`/divisions/${divisionCode}/config`),
  list: async () => {
    const data = await request('/divisions')
    return data.map(d => ({ code: d.division_code, name: d.division_name }))
  },
}

export const appConfigApi = {
  get: async (divisionCode) => {
    const qs = divisionCode ? `?${new URLSearchParams({ division_code: divisionCode })}` : ''
    const data = await request(`/app-config${qs}`)
    return { adminContactMobile: data.adminContactMobile }
  },
}

// ── Division rules (admin-managed CRUD over the per-division config above) ────

function transformDivisionRule(d) {
  return {
    divisionCode:          d.division_code,
    orderWorkflow:         d.order_workflow,
    customerWorkflow:      d.customer_workflow,
    orderEntry:            d.order_entry,
    documents:             d.documents,
    allowedCustomerTypes:  d.allowed_customer_types ?? ['patient', 'doctor', 'doctor-pharmacy', 'hospital'],
    allowedLoginCustomerTypes: d.allowed_login_customer_types ?? ['patient', 'doctor', 'doctor-pharmacy', 'hospital'],
    updatedAt:             d.updated_at,
  }
}

export const divisionRulesApi = {
  list: async () => {
    const data = await request('/division-rules')
    return data.map(transformDivisionRule)
  },

  get: async (divisionCode) => {
    const data = await request(`/division-rules/${divisionCode}`)
    return transformDivisionRule(data)
  },

  create: async (payload) => {
    const data = await request('/division-rules', { method: 'POST', body: JSON.stringify(payload) })
    return transformDivisionRule(data)
  },

  update: async (divisionCode, payload) => {
    const data = await request(`/division-rules/${divisionCode}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return transformDivisionRule(data)
  },

  remove: (divisionCode) => request(`/division-rules/${divisionCode}`, { method: 'DELETE' }),
}

// ── Bank master (shared, growable list of bank names for cheque payments) ─────

export const bankMasterApi = {
  list: () => request('/bank-master'),
  add: async (bankName) => {
    const data = await request('/bank-master', { method: 'POST', body: JSON.stringify({ bank_name: bankName }) })
    return data.bankName
  },
}

// ── Master data (Doctor / Chemist directories synced from Infinity) ───────────

function joinAddress(line1, line2) {
  return [line1, line2].map(s => s?.trim()).filter(Boolean).join(', ') || null
}

function transformDoctorMaster(d) {
  return {
    doctorId:       d.doctor_id,
    dmlCode:        d.doctor_code,
    uid:            d.doctor_uid,
    name:           d.doctor_name,
    speciality:     d.doctor_speciality,
    classification: d.doctor_classification,
    email:          d.email_id,
    mobile:         d.mobile,
    address:        joinAddress(d.address_line1, d.address_line2),
    pinCode:        d.pin_code,
    city:           d.town,
    state:          d.state,
    divisionCode:   d.d2d_division_code,
    location:       d.location,
    employeeCode:   d.employee_code,
    employeeName:   d.employee_name,
    sapcode:        d.sap_code,
    isRegistered:   d.is_registered === true,
    isLinkedToPharmacy: d.is_linked_to_pharmacy === true,
  }
}

function transformChemistMaster(c) {
  return {
    chemistId:      c.chemist_id,
    cmlCode:        c.chemist_code,
    name:           c.chemist_name,
    classification: c.chemist_classification,
    email:          c.email_id,
    mobile:         c.mobile,
    address:        joinAddress(c.address_line1, c.address_line2),
    pinCode:        c.pin_code,
    city:           c.town,
    state:          c.state,
    divisionCode:   c.d2d_division_code,
    location:       c.location,
    employeeCode:   c.employee_code,
    employeeName:   c.employee_name,
    sapcode:        c.sap_code,
    isRegistered:   c.is_registered === true,
  }
}

function transformSyncHistory(h) {
  return {
    id:            h.id,
    syncType:      h.sync_type,
    divisionCode:  h.division_code,
    status:        h.status,
    recordCount:   h.record_count,
    skippedCount:  h.skipped_count,
    deactivatedCount: h.deactivated_count,
    errorMessage:  h.error_message,
    runBy:         h.run_by,
    runByName:     h.run_by_name,
    runAt:         h.run_at,
  }
}

function transformLoginHistory(h) {
  return {
    id:            h.id,
    userId:        h.user_id,
    name:          h.name,
    mobileno:      h.mobileno,
    usertype:      h.usertype,
    loginMethod:   h.login_method,
    status:        h.status,
    failureReason: h.failure_reason,
    divisionCode:  h.division_code,
    loggedInAt:    h.logged_in_at,
  }
}

function syncBody(divisionCode, runBy) {
  return JSON.stringify({ division_code: divisionCode, run_by: runBy?.id, run_by_name: runBy?.name })
}

export const mastersApi = {
  searchDoctors: async (q, divisionCode, sapCode, location, excludeCustomerId) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (divisionCode) params.set('division_code', divisionCode)
    if (sapCode) params.set('sap_code', sapCode)
    if (location) params.set('location', location)
    if (excludeCustomerId) params.set('exclude_customer_id', excludeCustomerId)
    const qs = params.toString()
    const data = await request(`/masters/doctors${qs ? `?${qs}` : ''}`)
    return data.map(transformDoctorMaster)
  },
  searchChemists: async (q, divisionCode, sapCode, location) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (divisionCode) params.set('division_code', divisionCode)
    if (sapCode) params.set('sap_code', sapCode)
    if (location) params.set('location', location)
    const qs = params.toString()
    const data = await request(`/masters/chemists${qs ? `?${qs}` : ''}`)
    return data.map(transformChemistMaster)
  },

  syncDoctors:  (divisionCode, runBy) => request('/masters/sync/doctors',  { method: 'POST', body: syncBody(divisionCode, runBy) }),
  syncChemists: (divisionCode, runBy) => request('/masters/sync/chemists', { method: 'POST', body: syncBody(divisionCode, runBy) }),
  syncFieldStructure: (divisionCode, runBy) => request('/masters/sync/field-structure', { method: 'POST', body: syncBody(divisionCode, runBy) }),
  syncUsers: (divisionCode, runBy) => request('/masters/sync/users', { method: 'POST', body: syncBody(divisionCode, runBy) }),

  // Paginated admin "View Records" browse — unlike searchDoctors/searchChemists above
  // (LIMIT-20 autocomplete for registration), these page through the full dataset.
  browseDoctors: async ({ divisionCode, q, page, pageSize, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams()
    if (divisionCode) params.set('division_code', divisionCode)
    if (q) params.set('q', q)
    if (page) params.set('page', page)
    if (pageSize) params.set('pageSize', pageSize)
    if (sortBy) params.set('sort_by', sortBy)
    if (sortDir) params.set('sort_dir', sortDir)
    const data = await request(`/masters/doctors/browse?${params.toString()}`)
    return {
      total: data.total,
      rows: data.rows.map(r => ({ code: r.doctor_code, name: r.doctor_name, type: r.doctor_speciality, location: r.location, mobile: r.mobile, email: r.email_id })),
    }
  },

  browseChemists: async ({ divisionCode, q, page, pageSize, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams()
    if (divisionCode) params.set('division_code', divisionCode)
    if (q) params.set('q', q)
    if (page) params.set('page', page)
    if (pageSize) params.set('pageSize', pageSize)
    if (sortBy) params.set('sort_by', sortBy)
    if (sortDir) params.set('sort_dir', sortDir)
    const data = await request(`/masters/chemists/browse?${params.toString()}`)
    return {
      total: data.total,
      rows: data.rows.map(r => ({ code: r.chemist_code, name: r.chemist_name, type: r.chemist_classification, location: r.location, mobile: r.mobile, email: r.email_id })),
    }
  },

  browseFieldStructure: async ({ divisionCode, q, page, pageSize, sortBy, sortDir } = {}) => {
    const params = new URLSearchParams()
    if (divisionCode) params.set('division_code', divisionCode)
    if (q) params.set('q', q)
    if (page) params.set('page', page)
    if (pageSize) params.set('pageSize', pageSize)
    if (sortBy) params.set('sort_by', sortBy)
    if (sortDir) params.set('sort_dir', sortDir)
    const data = await request(`/masters/field-structure/browse?${params.toString()}`)
    return {
      total: data.total,
      rows: data.rows.map(r => ({ code: r.emp_code, name: r.emp_name, type: r.emp_location_type, location: r.emp_location, mobile: r.mobile, email: r.email })),
    }
  },

  getCounts: (divisionCode) => {
    const params = new URLSearchParams()
    if (divisionCode) params.set('division_code', divisionCode)
    const qs = params.toString()
    return request(`/masters/counts${qs ? `?${qs}` : ''}`)
  },

  getDirectoryCounts: (location, divisionCode) => {
    const params = new URLSearchParams()
    if (location) params.set('location', location)
    if (divisionCode) params.set('division_code', divisionCode)
    const qs = params.toString()
    return request(`/masters/directory-counts${qs ? `?${qs}` : ''}`)
  },

  getSyncHistory: async (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    const qs = new URLSearchParams(filtered).toString()
    const data = await request(`/masters/sync-history${qs ? `?${qs}` : ''}`)
    return data.map(transformSyncHistory)
  },

  getLoginHistory: async (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    const qs = new URLSearchParams(filtered).toString()
    const data = await request(`/masters/login-history${qs ? `?${qs}` : ''}`)
    return data.map(transformLoginHistory)
  },
}

// ── Admin user details (login accounts for admin / cfa / mm / dm) ──────────────

function transformAdminUserDetail(u) {
  return {
    id:                 u.id,
    usertype:           u.usertype,
    name:               u.name,
    mobileno:           u.mobileno,
    email:              u.email,
    empCode:            u.emp_code,
    divisionCode:       u.division_code,
    infinityDivisionId: u.infinity_division_id,
    isActive:           u.is_active,
    cfaCodes:           u.cfa_codes ?? [],
    cfaCode:            u.cfa_code ?? null,
  }
}

export const adminUserDetailsApi = {
  list: async (params = {}) => {
    const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
    const qs = new URLSearchParams(entries).toString()
    const data = await request(`/admin-user-details${qs ? `?${qs}` : ''}`)
    return data.map(transformAdminUserDetail)
  },

  create: async (payload) => {
    const data = await request('/admin-user-details', { method: 'POST', body: JSON.stringify(payload) })
    return transformAdminUserDetail(data)
  },

  update: async (id, payload) => {
    const data = await request(`/admin-user-details/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return transformAdminUserDetail(data)
  },

  remove: (id) => request(`/admin-user-details/${id}`, { method: 'DELETE' }),
}

// ── Customer outstanding (SAP balance per customer, Excel-uploaded by admin) ───

function transformCustomerOutstanding(co) {
  return {
    customerId:        co.customerid,
    customerCode:      co.customer_code,
    customerName:      co.customer_name,
    customerType:      co.customer_type,
    divisionCode:      co.division_code,
    sapCustomerCode:   co.sap_customer_code,
    outstandingAmount: Number(co.outstanding_amount),
    outstandingSince:  co.outstanding_since ?? null,
  }
}

export const customerOutstandingApi = {
  list: async (params = {}) => {
    const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
    const qs = new URLSearchParams(entries).toString()
    const data = await request(`/customer-outstanding${qs ? `?${qs}` : ''}`)
    return data.map(transformCustomerOutstanding)
  },

  upload: async (file, divisionCode) => {
    const form = new FormData()
    form.append('file', file)
    if (divisionCode) form.append('division_code', divisionCode)
    const res = await fetch(`${BASE}/customer-outstanding/upload`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    return res.json() // { success, count, skipped }
  },

  downloadTemplate: async () => {
    const res = await fetch(`${BASE}/customer-outstanding/template`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.status === 401) onUnauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.blob()
  },
}

// ── CCAvenue payment gateway ─────────────────────────────────────────────────

export const ccavenueApi = {
  initiate:     (orderId) => request('/payment/initiate', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }),
  createLink:   (orderId) => request('/payment/create-link', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }),
  mockCallback: (orderId, status) => request('/ccavenue/mock-callback', { method: 'POST', body: JSON.stringify({ order_id: orderId, status }) }),
  getLink:      (token) => request(`/ccavenue/link/${encodeURIComponent(token)}`),

  initiateCustomer:   (customerId) => request('/payment/initiate-customer', { method: 'POST', body: JSON.stringify({ customer_id: customerId }) }),
  createLinkCustomer: (customerId) => request('/payment/create-link-customer', { method: 'POST', body: JSON.stringify({ customer_id: customerId }) }),
}
