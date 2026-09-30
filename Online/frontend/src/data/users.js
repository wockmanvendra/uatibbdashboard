// USER module — mock user registry.
// In production, replace findOtpUser / findPasswordUser with authenticated API calls.
// OTP values here are fixed mock values for dev/testing only.

export const USERS = [
  // ── OTP authentication — /login ──────────────────────────────────────────────
  // Customer types
  { id: 'USR-C001', usertype: 'patient',         name: 'Priya Sharma test',                    mobileno: '9876543210', password: null, otp: '123456' },
  { id: 'USR-C002', usertype: 'patient',         name: 'Rahul Mehta',                     mobileno: '9812345678', password: null, otp: '123456' },
  { id: 'USR-C003', usertype: 'doctor',          name: 'Dr. Anjali Mehta',                mobileno: '9821044556', password: null, otp: '123456' },
  { id: 'USR-C004', usertype: 'doctor',          name: 'Dr. Rohan Kapoor',                mobileno: '9845011223', password: null, otp: '123456' },
  { id: 'USR-C005', usertype: 'doctor-pharmacy', name: 'Wellness Plus Pharmacy',          mobileno: '9823456710', password: null, otp: '123456' },
  { id: 'USR-C006', usertype: 'hospital',        name: 'Sunrise Multispecialty Hospital', mobileno: '9822110099', password: null, otp: '123456' },
  // Field staff — OTP login
  { id: 'USR-S002', usertype: 'tm',  name: 'Amit Verma',    mobileno: '9000000002', password: null, otp: '123456' }, // TM1
  { id: 'USR-S009', usertype: 'tm',  name: 'Vikram Patil',  mobileno: '9000000009', password: null, otp: '123456' }, // TM2
  { id: 'USR-S010', usertype: 'tm',  name: 'Neha Joshi',    mobileno: '9000000010', password: null, otp: '123456' }, // TM3
  { id: 'USR-S003', usertype: 'rm',  name: 'Sunita Rao',    mobileno: '9000000003', password: null, otp: '123456' }, // RM1
  { id: 'USR-S011', usertype: 'rm',  name: 'Kavita Singh',  mobileno: '9000000011', password: null, otp: '123456' }, // RM2
  { id: 'USR-S004', usertype: 'zsm', name: 'Deepak Khanna', mobileno: '9000000004', password: null, otp: '123456' }, // ZSM1
  { id: 'USR-S012', usertype: 'zsm', name: 'Mohan Reddy',   mobileno: '9000000012', password: null, otp: '123456' }, // ZSM2
  { id: 'USR-S005', usertype: 'nsm', name: 'Rajeev Sinha',  mobileno: '9000000005', password: null, otp: '123456' }, // NSM1
  // ── Password authentication — /admin ─────────────────────────────────────────
  { id: 'USR-S001', usertype: 'admin', name: 'System Admin',    mobileno: '9000000001', password: 'Admin@123', otp: null },
  { id: 'USR-S006', usertype: 'cfa',   name: 'CFA Chennai',     mobileno: '9444556677', password: 'CFApass@1', otp: null },
  { id: 'USR-S007', usertype: 'mm',    name: 'Pooja Agarwal',   mobileno: '9000000006', password: 'MMpass@1',  otp: null }, // MM1
  { id: 'USR-S013', usertype: 'mm',    name: 'Ritu Sharma',     mobileno: '9000000013', password: 'MMpass@2',  otp: null }, // MM2
  { id: 'USR-S008', usertype: 'dm',    name: 'Suresh Pillai',   mobileno: '9000000007', password: 'DMpass@1',  otp: null }, // DM1
  { id: 'USR-S014', usertype: 'dm',    name: 'Anand Nair',      mobileno: '9000000014', password: 'DMpass@2',  otp: null }, // DM2
]

// ── Approval hierarchy — TM → RM → ZSM → NSM → MM/DM ───────────────────────
// Each TM maps to the specific approvers who must sign off their submissions in order.
export const TM_HIERARCHY = {
  'USR-S002': { rmId: 'USR-S003', zsmId: 'USR-S004', nsmId: 'USR-S005', mmId: 'USR-S007', dmId: 'USR-S008' }, // TM1
  'USR-S009': { rmId: 'USR-S003', zsmId: 'USR-S004', nsmId: 'USR-S005', mmId: 'USR-S007', dmId: 'USR-S008' }, // TM2
  'USR-S010': { rmId: 'USR-S011', zsmId: 'USR-S012', nsmId: 'USR-S005', mmId: 'USR-S013', dmId: 'USR-S014' }, // TM3
}

const OTP_TYPES      = new Set(['patient', 'doctor', 'doctor-pharmacy', 'hospital', 'tm', 'rm', 'zsm', 'nsm'])
const PASSWORD_TYPES = new Set(['admin', 'cfa', 'mm', 'dm'])

export function findOtpUser(mobileno) {
  return USERS.find(u => u.mobileno === mobileno && OTP_TYPES.has(u.usertype)) ?? null
}

export function findPasswordUser(mobileno) {
  return USERS.find(u => u.mobileno === mobileno && PASSWORD_TYPES.has(u.usertype)) ?? null
}
