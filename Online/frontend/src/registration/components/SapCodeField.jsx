// Shared by all 4 registration forms (Doctor/Pharmacy/Hospital/Patient) —
// customers.sap_code is the registering field rep's own SAP territory code
// (users.sap_code, synced from vw_tm_hierarchy via vw_infinity_users), not
// something the TM picks or types. The backend stamps it from req.user on
// save; this is a read-only display so the TM can see what will be saved.
// In admin-edit mode it shows the customer's already-saved value instead,
// since admin-edit doesn't touch sap_code at all.
export function SapTerritoryCodeField({ user, isAdminEditMode, editingCustomer }) {
  const value = isAdminEditMode ? (editingCustomer?.sapCode ?? '') : (user?.sapCode ?? '')

  return (
    <div className="reg-field">
      <label>SAP Territory Code</label>
      <input className="reg-input reg-input--readonly" readOnly disabled value={value} />
      {!value && (
        <span className="reg-hint reg-hint--error">
          Your account has no SAP territory code — contact your administrator
        </span>
      )}
    </div>
  )
}
