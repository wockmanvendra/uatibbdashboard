import {
  getApprovers,
  getCfaScopedApprovers,
  getUserContact,
  getCfaEmail,
  getCustomerEmail,
  STEP1_APPROVER_ROLES,
  CUSTOMER_FINAL_CC_ROLES,
  ORDER_FINAL_CC_ROLES,
} from './approvalRecipients.js'
import { getDivisionContact } from '../config/divisionContacts.js'
import {
  sendCustomerApprovalRequestEmail,
  sendCustomerApprovedEmail,
  sendCustomerRejectedEmail,
  sendCustomerFinalApprovalRequestEmail,
  sendOrderApprovalRequestEmail,
  sendOrderApprovedEmail,
  sendOrderRejectedEmail,
  sendOrderFinalApprovalRequestEmail,
  sendPaymentOutcomeEmail,
  sendCustomerWelcomeEmail,
} from './emailService.js'

export async function notifyCustomerSubmitted(customer) {
  try {
    const [approvers, requester, { ccEmails }] = await Promise.all([
      getApprovers(customer.registered_by, customer.division_code, STEP1_APPROVER_ROLES),
      getUserContact(customer.registered_by),
      getDivisionContact(customer.division_code),
    ])

    await sendCustomerApprovalRequestEmail({
      to: approvers.map(a => a.email),
      cc: [...(requester?.email ? [requester.email] : []), ...ccEmails],
      customerId: customer.id,
      customerCode: customer.customer_code,
      customerName: customer.name,
      customerType: customer.customer_type,
      requestedBy: requester?.name ?? customer.registered_by ?? 'Unknown',
      createdDate: customer.registered_at,
    })
  } catch (err) {
    console.error('[email] notifyCustomerSubmitted failed:', err)
  }
}

export async function notifyCustomerAwaitingFinalApproval(customer, step1ApprovedByName, step1ApprovedAt) {
  try {
    const [finalApprovers, requester, { ccEmails }] = await Promise.all([
      getCfaScopedApprovers(customer.division_code, customer.cfa_code, 'dm'),
      getUserContact(customer.registered_by),
      getDivisionContact(customer.division_code),
    ])
    if (!finalApprovers.length) {
      console.warn(`[email] notifyCustomerAwaitingFinalApproval: no dm assigned to cfa_code=${customer.cfa_code} in division=${customer.division_code} for customer ${customer.customer_code}`)
    }

    await sendCustomerFinalApprovalRequestEmail({
      to: finalApprovers.map(a => a.email),
      cc: [...(requester?.email ? [requester.email] : []), ...ccEmails],
      customerId: customer.id,
      customerCode: customer.customer_code,
      customerName: customer.name,
      customerType: customer.customer_type,
      step1ApprovedBy: step1ApprovedByName,
      step1ApprovedDate: step1ApprovedAt,
    })
  } catch (err) {
    console.error('[email] notifyCustomerAwaitingFinalApproval failed:', err)
  }
}

export async function notifyCustomerApproved(customer, approvedByName, approvedAt) {
  try {
    const [requester, approvers, { ccEmails }] = await Promise.all([
      getUserContact(customer.registered_by),
      getApprovers(customer.registered_by, customer.division_code, CUSTOMER_FINAL_CC_ROLES),
      getDivisionContact(customer.division_code),
    ])

    await sendCustomerApprovedEmail({
      to: requester?.email ? [requester.email] : [],
      cc: [...approvers.map(a => a.email), ...ccEmails],
      customerId: customer.id,
      customerCode: customer.customer_code,
      customerName: customer.name,
      customerType: customer.customer_type,
      approvedBy: approvedByName,
      approvedDate: approvedAt,
    })
  } catch (err) {
    console.error('[email] notifyCustomerApproved failed:', err)
  }
}

// Customer-facing welcome email, fired alongside notifyCustomerApproved when
// a customer clears final approval — the internal email above goes to the
// TM; this one goes to the customer themselves, so it has its own CC list
// (TM + RM/ZSM/NSM, no DM — DM only matters to the internal approval chain).
export async function notifyCustomerWelcome(customer) {
  try {
    const [tm, contacts, { ccEmails }] = await Promise.all([
      getUserContact(customer.registered_by),
      getApprovers(customer.registered_by, customer.division_code, STEP1_APPROVER_ROLES),
      getDivisionContact(customer.division_code),
    ])
    const byRole = Object.fromEntries(contacts.map(c => [c.role, c]))

    await sendCustomerWelcomeEmail({
      to: customer.email ? [customer.email] : [],
      cc: [...(tm?.email ? [tm.email] : []), ...contacts.map(c => c.email), ...ccEmails],
      customerName: customer.name,
      customerAddress: customer.address,
      customerCity: customer.city,
      customerState: customer.state,
      customerPinCode: customer.pin_code,
      customerEmail: customer.email,
      customerMobile: customer.mobile,
      tmName: tm?.name,
      tmMobile: tm?.mobile,
      rmName: byRole.rm?.name,
      rmMobile: byRole.rm?.mobile,
      zsmName: byRole.zsm?.name,
      zsmMobile: byRole.zsm?.mobile,
      nsmName: byRole.nsm?.name,
      nsmMobile: byRole.nsm?.mobile,
    })
  } catch (err) {
    console.error('[email] notifyCustomerWelcome failed:', err)
  }
}

export async function notifyCustomerRejected(customer, rejectedByName, rejectedAt, reason) {
  try {
    const [requester, approvers, { ccEmails }] = await Promise.all([
      getUserContact(customer.registered_by),
      getApprovers(customer.registered_by, customer.division_code, CUSTOMER_FINAL_CC_ROLES),
      getDivisionContact(customer.division_code),
    ])

    await sendCustomerRejectedEmail({
      to: requester?.email ? [requester.email] : [],
      cc: [...approvers.map(a => a.email), ...ccEmails],
      customerId: customer.id,
      customerCode: customer.customer_code,
      customerName: customer.name,
      customerType: customer.customer_type,
      rejectedBy: rejectedByName,
      rejectedDate: rejectedAt,
      reason,
    })
  } catch (err) {
    console.error('[email] notifyCustomerRejected failed:', err)
  }
}

export async function notifyOrderSubmitted(order) {
  try {
    const [approvers, requester, { ccEmails }] = await Promise.all([
      getApprovers(order.placed_by, order.division_code, STEP1_APPROVER_ROLES),
      getUserContact(order.placed_by),
      getDivisionContact(order.division_code),
    ])

    await sendOrderApprovalRequestEmail({
      to: approvers.map(a => a.email),
      cc: [...(requester?.email ? [requester.email] : []), ...ccEmails],
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.ordering_for_name,
      orderAmount: order.total_payable,
      requestedBy: requester?.name ?? order.placed_by_name ?? 'Unknown',
      orderDate: order.placed_at,
    })
  } catch (err) {
    console.error('[email] notifyOrderSubmitted failed:', err)
  }
}

export async function notifyOrderAwaitingFinalApproval(order, step1ApprovedByName, step1ApprovedAt) {
  try {
    const [finalApprovers, requester, { ccEmails }] = await Promise.all([
      getCfaScopedApprovers(order.division_code, order.cfa_code, 'mm'),
      getUserContact(order.placed_by),
      getDivisionContact(order.division_code),
    ])
    if (!finalApprovers.length) {
      console.warn(`[email] notifyOrderAwaitingFinalApproval: no mm assigned to cfa_code=${order.cfa_code} in division=${order.division_code} for order ${order.order_number}`)
    }

    await sendOrderFinalApprovalRequestEmail({
      to: finalApprovers.map(a => a.email),
      cc: [...(requester?.email ? [requester.email] : []), ...ccEmails],
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.ordering_for_name,
      orderAmount: order.total_payable,
      step1ApprovedBy: step1ApprovedByName,
      step1ApprovedDate: step1ApprovedAt,
    })
  } catch (err) {
    console.error('[email] notifyOrderAwaitingFinalApproval failed:', err)
  }
}

export async function notifyOrderApproved(order, approvedByName, approvedAt) {
  try {
    const [requester, customerEmail, approvers, { ccEmails }] = await Promise.all([
      getUserContact(order.placed_by),
      getCustomerEmail(order.ordering_for_id),
      getApprovers(order.placed_by, order.division_code, ORDER_FINAL_CC_ROLES),
      getDivisionContact(order.division_code),
    ])

    await sendOrderApprovedEmail({
      to: [...(requester?.email ? [requester.email] : []), ...(customerEmail ? [customerEmail] : [])],
      cc: [...approvers.map(a => a.email), ...ccEmails],
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.ordering_for_name,
      orderAmount: order.total_payable,
      approvedBy: approvedByName,
      approvedDate: approvedAt,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      totalDiscount: order.total_discount,
      paymentReceivedDate: order.payment_received_date,
      paymentReceivedAmount: order.payment_received_amount,
    })
  } catch (err) {
    console.error('[email] notifyOrderApproved failed:', err)
  }
}

export async function notifyOrderRejected(order, rejectedByName, rejectedAt, reason) {
  try {
    const [requester, approvers, { ccEmails }] = await Promise.all([
      getUserContact(order.placed_by),
      getApprovers(order.placed_by, order.division_code, ORDER_FINAL_CC_ROLES),
      getDivisionContact(order.division_code),
    ])

    await sendOrderRejectedEmail({
      to: requester?.email ? [requester.email] : [],
      cc: [...approvers.map(a => a.email), ...ccEmails],
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.ordering_for_name,
      orderAmount: order.total_payable,
      rejectedBy: rejectedByName,
      rejectedDate: rejectedAt,
      reason,
    })
  } catch (err) {
    console.error('[email] notifyOrderRejected failed:', err)
  }
}

// order: full row from ORDER_WITH_BILLING_BY_ID_SQL (has order_number, division_code,
// cfa_code, placed_by, ordering_for_name, total_payable, payment_method, customer_email).
export async function notifyOrderPaymentOutcome(order, outcome) {
  try {
    const [requester, rmContacts, cfaEmail, { ccEmails }] = await Promise.all([
      getUserContact(order.placed_by),
      getApprovers(order.placed_by, order.division_code, ['rm']),
      getCfaEmail(order.cfa_code),
      getDivisionContact(order.division_code),
    ])

    await sendPaymentOutcomeEmail({
      to: order.customer_email ? [order.customer_email] : [],
      cc: [
        ...(requester?.email ? [requester.email] : []),
        ...rmContacts.map(a => a.email),
        ...(cfaEmail ? [cfaEmail] : []),
        ...ccEmails,
      ],
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.ordering_for_name,
      amount: order.total_payable,
      paymentMethod: order.payment_method,
      status: outcome.status,
      failureMessage: outcome.failureMessage,
    })
  } catch (err) {
    console.error('[email] notifyOrderPaymentOutcome failed:', err)
  }
}

// row: full row from CUSTOMER_OUTSTANDING_BY_ID_SQL (has customerid, registered_by,
// customer_code, customer_name, division_code, cfa_code, customer_email), plus
// amountPaid — the pre-payment outstanding balance, captured by the caller before
// outstanding_amount is zeroed on success.
export async function notifyCustomerOutstandingPaymentOutcome(row, outcome, amountPaid) {
  try {
    const [requester, rmContacts, cfaEmail, { ccEmails }] = await Promise.all([
      getUserContact(row.registered_by),
      getApprovers(row.registered_by, row.division_code, ['rm']),
      getCfaEmail(row.cfa_code),
      getDivisionContact(row.division_code),
    ])

    await sendPaymentOutcomeEmail({
      to: row.customer_email ? [row.customer_email] : [],
      cc: [
        ...(requester?.email ? [requester.email] : []),
        ...rmContacts.map(a => a.email),
        ...(cfaEmail ? [cfaEmail] : []),
        ...ccEmails,
      ],
      customerId: row.customerid,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      amount: amountPaid,
      status: outcome.status,
      failureMessage: outcome.failureMessage,
    })
  } catch (err) {
    console.error('[email] notifyCustomerOutstandingPaymentOutcome failed:', err)
  }
}
