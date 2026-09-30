const ENTITY_LABEL = { order: 'Order', customer: 'Customer' }

// Success-result copy shown in OutcomeModal after place/resubmit/approve/reject
// completes. identifier is the order number or customer code.
export function buildSuccessOutcome({ entity, action, identifier }) {
  const label = ENTITY_LABEL[entity]
  switch (action) {
    case 'created':
      return { title: `${label} placed`, message: `${label} ${identifier} has been created and is awaiting approval.` }
    case 'resubmitted':
      return { title: `${label} resubmitted`, message: `${label} ${identifier} has been resubmitted and is awaiting approval.` }
    case 'approved':
      return { title: `${label} approved`, message: `${label} ${identifier} has been approved successfully.` }
    case 'rejected':
      return { title: `${label} rejected`, message: `${label} ${identifier} has been rejected.` }
    default:
      return { title: label, message: `${label} ${identifier} updated.` }
  }
}
