// Derives "is this section done?" purely from current form state, so the
// progress indicator stays in sync without any scroll-tracking machinery.
// It's a visual aid, not a submit gate — react-hook-form's own validation
// is what actually blocks submission.

function hasValue(value) {
  if (value instanceof File) return true
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'boolean') return true
  return value !== undefined && value !== null && String(value).trim() !== ''
}

export function computeSectionStatus(section, { errors, values }) {
  const fields = section.fields ?? []
  if (fields.length === 0) return 'complete'

  const hasError = fields.some((field) => Boolean(errors?.[field]))
  if (hasError) return 'error'

  const complete = section.isComplete
    ? section.isComplete(values)
    : fields.every((field) => hasValue(values?.[field]))
  return complete ? 'complete' : 'pending'
}

/** Returns { activeIndex, completedKeys } for the stepper. */
export function getSectionProgress(sections, formState) {
  const statuses = sections.map((section) => computeSectionStatus(section, formState))
  const completedKeys = sections.filter((_, index) => statuses[index] === 'complete').map((s) => s.key)
  let activeIndex = statuses.findIndex((status) => status !== 'complete')
  if (activeIndex === -1) activeIndex = sections.length - 1
  return { activeIndex, completedKeys }
}
