function RegistrationStepper({ steps, activeIndex, completedKeys }) {
  return (
    <ol className="reg-stepper">
      {steps.map((step, index) => {
        const isActive    = index === activeIndex
        const isCompleted = completedKeys.includes(step.key)
        return (
          <li
            key={step.key}
            className={`reg-step${isActive ? ' reg-step--active' : ''}${isCompleted ? ' reg-step--completed' : ''}`}
          >
            <span className="reg-step__num">{isCompleted ? '✓' : index + 1}</span>
            <span className="reg-step__label">{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default RegistrationStepper
