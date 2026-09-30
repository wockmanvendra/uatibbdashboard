import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import RegistrationStepper from './RegistrationStepper.jsx'
import ConfirmSubmitDialog from './ConfirmSubmitDialog.jsx'
import OutcomeModal from '../../components/OutcomeModal.jsx'
import { getSectionProgress } from '../sectionProgress.js'
import { submitRegistration } from '../api.js'
import { buildSuccessOutcome } from '../../utils/outcomeMessages.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useCustomers } from '../../context/CustomersContext.jsx'

function RegistrationFormBase({ customerType, customerTypeLabel, defaultValues, sections, buildSummary, isEditMode, isAdminEditMode, editingCustomerId, editingCustomer }) {
  const { user } = useAuth()
  const customersCtx = useCustomers()
  const navigate = useNavigate()

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    clearErrors,
    reset,
    trigger,
    formState: { errors, isDirty },
  } = useForm({ defaultValues, mode: 'onBlur' })

  const [currentStep, setCurrentStep] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingValues, setPendingValues] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState({ open: false, severity: 'info', message: '' })
  const [outcome, setOutcome] = useState(null)
  const [pendingSuccessIsEdit, setPendingSuccessIsEdit] = useState(false)

  const values = watch()

  const notify = (severity, message) => setNotice({ open: true, severity, message })

  const handleReset = () => {
    if (isDirty && !window.confirm('Reset this form? Any unsaved changes will be lost.')) return
    reset(defaultValues)
    setCurrentStep(0)
    notify('info', 'Form reset to a blank registration.')
  }

  const onValid = (formValues) => {
    setPendingValues(formValues)
    setConfirmOpen(true)
  }

  const onInvalid = (formErrors) => {
    const erroredIndex = sections.findIndex((section) => (section.fields ?? []).some((field) => formErrors[field]))
    if (erroredIndex !== -1) setCurrentStep(erroredIndex)
    notify('error', 'Please review the highlighted fields before submitting.')
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      if (isAdminEditMode) {
        const updated = await customersCtx?.adminUpdateCustomer(editingCustomerId, pendingValues)
        setConfirmOpen(false)
        setPendingSuccessIsEdit(true)
        setOutcome({
          status: 'success',
          ...buildSuccessOutcome({ entity: 'customer', action: 'updated', identifier: updated?.customerCode }),
        })
      } else if (isEditMode) {
        const updated = await customersCtx?.resubmitCustomer(editingCustomerId, pendingValues)
        setConfirmOpen(false)
        setPendingSuccessIsEdit(true)
        setOutcome({
          status: 'success',
          ...buildSuccessOutcome({ entity: 'customer', action: 'resubmitted', identifier: updated?.customerCode }),
        })
      } else {
        await submitRegistration(customerType, pendingValues)
        const record = await customersCtx?.registerCustomer(customerType, pendingValues, {
          id: user?.id, name: user?.name, usertype: user?.usertype, divisionCode: user?.divisionCode,
        })
        setConfirmOpen(false)
        setPendingSuccessIsEdit(false)
        setOutcome({
          status: 'success',
          ...buildSuccessOutcome({ entity: 'customer', action: 'created', identifier: record?.customerCode }),
        })
      }
    } catch (err) {
      setConfirmOpen(false)
      setOutcome({
        status: 'error',
        title: isAdminEditMode ? "Couldn't save changes" : "Couldn't submit registration",
        message: err.message || 'Submission failed — please try again in a moment.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Resets/navigates only after the user dismisses the success modal.
  const handleOutcomeClose = () => {
    const wasSuccess = outcome?.status === 'success'
    setOutcome(null)
    if (!wasSuccess) return
    if (pendingSuccessIsEdit) {
      navigate('/dashboard')
    } else {
      reset(defaultValues)
      setCurrentStep(0)
    }
  }

  const { completedKeys } = getSectionProgress(sections, { errors, values })
  const steps = sections.map(({ key, label }) => ({ key, label }))
  // In admin-edit mode use the customer's divisionCode (super-admin has none);
  // in normal registration use the logged-in TM/registrant's divisionCode.
  const divisionCode = isAdminEditMode ? editingCustomer?.divisionCode : user?.divisionCode
  const fieldMethods = { control, register, watch, setValue, clearErrors, errors, editingCustomerId, editingCustomer, isAdminEditMode, divisionCode, user }

  const totalSteps    = sections.length
  const activeSection = sections[currentStep]
  const isFirstStep   = currentStep === 0
  const isLastStep    = currentStep === totalSteps - 1

  const handlePrevious = () => setCurrentStep((s) => Math.max(s - 1, 0))

  const handleNext = async () => {
    const fields = activeSection.fields ?? []
    const valid = fields.length === 0 || (await trigger(fields))
    if (valid) setCurrentStep((s) => Math.min(s + 1, totalSteps - 1))
  }

  return (
    <div>
      <form noValidate onSubmit={handleSubmit(onValid, onInvalid)}>
        <div className="reg-card">

          <div className="reg-form-header">
            <div>
              <h2 className="reg-form-title">{isAdminEditMode ? `Edit ${customerTypeLabel} record` : `${customerTypeLabel} registration`}</h2>
              <span className="reg-form-subtitle">{activeSection.title} · Step {currentStep + 1} of {totalSteps}</span>
            </div>
            <button type="button" className="reg-icon-btn" onClick={handleReset} title="Reset form">↺</button>
          </div>

          <div className="reg-stepper-wrap">
            <RegistrationStepper steps={steps} activeIndex={currentStep} completedKeys={completedKeys} />
          </div>

          <div className="reg-section-header">
            <h3 className="reg-section-title">{activeSection.title}</h3>
            {activeSection.subtitle && <p className="reg-section-subtitle">{activeSection.subtitle}</p>}
          </div>

          <div key={activeSection.key}>
            {activeSection.render(fieldMethods)}
          </div>

          <hr className="reg-divider" />

          <div className="reg-form-nav">
            <button
              type="button"
              className="reg-btn reg-btn--ghost"
              onClick={handlePrevious}
              disabled={isFirstStep}
            >
              ← Previous
            </button>
            {isLastStep ? (
              <button type="submit" className="reg-btn reg-btn--primary">
                {isAdminEditMode ? 'Save Changes' : 'Submit Registration'}
              </button>
            ) : (
              <button type="button" className="reg-btn reg-btn--primary" onClick={handleNext}>
                Next →
              </button>
            )}
          </div>

        </div>
      </form>

      <ConfirmSubmitDialog
        open={confirmOpen}
        onClose={() => (submitting ? null : setConfirmOpen(false))}
        onConfirm={handleConfirm}
        customerTypeLabel={customerTypeLabel}
        summary={pendingValues ? buildSummary(pendingValues) : []}
        submitting={submitting}
        isAdminEditMode={isAdminEditMode}
      />

      {notice.open && (
        <div className={`reg-notice reg-notice--${notice.severity}`} role="alert">
          <span>{notice.message}</span>
          <button
            type="button"
            className="reg-notice__close"
            onClick={() => setNotice((n) => ({ ...n, open: false }))}
          >
            ×
          </button>
        </div>
      )}

      {outcome && (
        <OutcomeModal
          status={outcome.status}
          title={outcome.title}
          message={outcome.message}
          onClose={handleOutcomeClose}
        />
      )}
    </div>
  )
}

export default RegistrationFormBase
