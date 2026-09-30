// Reverse-maps a CustomersContext customer record (camelCase, from transformCustomer)
// back into the shape each registration form's defaultValues expects, for the
// "Edit & Resubmit" flow. Mirrors the forward mapping in CustomersContext's
// buildCustomerPayload — keep the two in sync if a field is added there.

function toDateInputValue(value) {
  return value ? String(value).slice(0, 10) : ''
}

export function mapCustomerToFormValues(customer) {
  if (!customer) return null

  const common = {
    email:   customer.email   ?? '',
    mobile:  customer.mobile  ?? '',
    address: customer.address ?? '',
    pinCode: customer.pinCode ?? '',
    city:    customer.city    ?? '',
    state:   customer.state   ?? '',
    cfaCode: customer.cfaCode ?? '',
    // existing uploaded documents — { url, name }; passes through unchanged
    // unless the TM picks a new file (see CustomersContext.buildCustomerPayload)
    ...(customer.documents ?? {}),
  }

  switch (customer.customerType) {
    case 'patient':
      return {
        ...common,
        fullName: customer.name ?? '',
        age:      customer.age ?? '',
        gender:   customer.gender ?? '',
      }

    case 'doctor':
      return {
        ...common,
        selectedDoctor: customer.selectedDoctorDmlCode ? {
          dmlCode:        customer.selectedDoctorDmlCode,
          name:           customer.selectedDoctorName,
          speciality:     customer.selectedDoctorSpeciality,
          classification: customer.selectedDoctorClassification,
        } : null,
        doctorName:         customer.name ?? '',
        age:                customer.age ?? '',
        gender:             customer.gender ?? '',
        registrationNumber: customer.registrationNumber ?? '',
        panNumber:          customer.panNumber ?? '',
        aadhaarNumber:      customer.aadhaarNumber ?? '',
      }

    case 'doctor-pharmacy':
      return {
        ...common,
        selectedPharmacy: customer.selectedPharmacyCmlCode ? {
          cmlCode: customer.selectedPharmacyCmlCode,
          name:    customer.selectedPharmacyName,
        } : null,
        linkedDoctor: customer.linkedDoctorDmlCode ? {
          dmlCode:    customer.linkedDoctorDmlCode,
          name:       customer.linkedDoctorName,
          speciality: customer.linkedDoctorSpeciality,
        } : null,
        linkedDoctorRegistrationNumber: customer.linkedDoctorRegistrationNumber ?? '',
        pharmacyName:         customer.name ?? '',
        gstNumber:            customer.gstNumber ?? '',
        compositionScheme:    customer.compositionScheme ?? false,
        drugLicenceNumber:    customer.drugLicenceNumber ?? '',
        drugLicenceValidTill: toDateInputValue(customer.drugLicenceValidTill),
        panNumber:            customer.panNumber ?? '',
        aadhaarNumber:        customer.aadhaarNumber ?? '',
      }

    case 'hospital':
      return {
        ...common,
        hospitalName:               customer.name ?? '',
        gstNumber:                  customer.gstNumber ?? '',
        compositionScheme:          customer.compositionScheme ?? false,
        hospitalRegistrationNumber: customer.hospitalRegistrationNumber ?? '',
        drugLicenceNumber:          customer.drugLicenceNumber ?? '',
        drugLicenceValidTill:       toDateInputValue(customer.drugLicenceValidTill),
        panNumber:                  customer.panNumber ?? '',
        aadhaarNumber:              customer.aadhaarNumber ?? '',
      }

    default:
      return common
  }
}
