// ── Approval workflow helpers ────────────────────────────────────────────────
//
// Workflow shapes (`{ initialStatus, steps: [{ step, label, approverRoles,
// fromStatus, toStatus }] }`) now come from the backend's per-division rules
// (`GET /divisions/:code/config`, see DivisionConfigContext) so that
// approval steps/roles can vary by division. These helpers operate on
// whichever workflow object (`rules.orderWorkflow` / `rules.customerWorkflow`)
// is passed in — they hold no workflow data themselves.
// pending-l1 → approved-l1 → approved  (or rejected at any step), by default.

export const STATUS_LABELS = {
  'pending-l1':  'Awaiting L1 Approval',
  'approved-l1': 'Awaiting Final Approval',
  'approved':    'Approved',
  'rejected':    'Rejected',
}

// Full set of roles that can appear as approvers in any division's workflow —
// a role taxonomy used to pick dashboard variants, not a division-specific value.
export const ALL_APPROVER_ROLES = ['rm', 'zsm', 'nsm', 'mm', 'dm', 'bu-head']

/** Returns the workflow step the given role is responsible for, or null. */
export function getOrderStep(workflow, usertype) {
  return workflow.steps.find(s => s.approverRoles.includes(usertype)) ?? null
}

/** Returns the workflow step the given role is responsible for, or null. */
export function getCustomerStep(workflow, usertype) {
  return workflow.steps.find(s => s.approverRoles.includes(usertype)) ?? null
}

/** Returns the workflow step currently awaiting action for the given status, or null. */
export function getOrderStepForStatus(workflow, status) {
  return workflow.steps.find(s => s.fromStatus === status) ?? null
}

/** Returns the workflow step currently awaiting action for the given status, or null. */
export function getCustomerStepForStatus(workflow, status) {
  return workflow.steps.find(s => s.fromStatus === status) ?? null
}

// Short, user-facing group names for a step's approver roles
const ROLE_GROUP_LABELS = {
  rm: 'Business', zsm: 'Business', nsm: 'Business',
  mm: 'Marketing Manager',
  dm: 'Distribution Manager',
  'bu-head': 'BU Head',
}

/** Returns a short group label (e.g. "Business", "Marketing Manager") for a workflow step, or null. */
export function getStepGroupLabel(step) {
  if (!step) return null
  return ROLE_GROUP_LABELS[step.approverRoles[0]] ?? step.label
}

/** Next status in the given workflow given the current status (or null if terminal). */
export function nextOrderStatus(workflow, currentStatus) {
  return workflow.steps.find(s => s.fromStatus === currentStatus)?.toStatus ?? null
}

/** Next status in the given workflow given the current status (or null if terminal). */
export function nextCustomerStatus(workflow, currentStatus) {
  return workflow.steps.find(s => s.fromStatus === currentStatus)?.toStatus ?? null
}
