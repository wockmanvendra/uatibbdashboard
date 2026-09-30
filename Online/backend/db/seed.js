// ============================================================
//  D2D Portal — Database Seed
//  Usage:  node db/seed.js
//  Prereq: database + schema must exist (run schema.sql first)
// ============================================================

import 'dotenv/config'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { DEFAULT_RULES } from '../src/config/divisionRules.js'
import { ADMIN_MANAGED_USERTYPES } from '../src/config/adminUsertypes.js'

const { Pool } = pg
const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'd2d_portal',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
})

// ── Helper ────────────────────────────────────────────────────────────────────

async function run(label, fn) {
  process.stdout.write(`  ${label}... `)
  try {
    const result = await fn()
    console.log(`done${result ? ` (${result})` : ''}`)
  } catch (err) {
    console.log('FAILED')
    throw err
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 10

// `id` below (e.g. 'T000002') is a JS-only lookup label, not sent to the
// database — users.id is now a DB-generated UUID (see schema.sql).
const USERS_RAW = [
  // OTP users
  { id: 'P000001',  usertype: 'patient',         name: 'Priya Sharma',                    mobileno: '9876543210', password: null, otp: '123456', division_code: 'DIV-PCA', email: 'priya.sharma@d2cpharma.in' },
  { id: 'P000002',  usertype: 'patient',         name: 'Rahul Mehta',                     mobileno: '9812345678', password: null, otp: '123456', division_code: 'DIV-GRO', email: 'rahul.mehta@d2cpharma.in' },
  { id: 'D000001',  usertype: 'doctor',          name: 'Dr. Anjali Mehta',                mobileno: '9821044556', password: null, otp: '123456', email: 'anjali.mehta@d2cpharma.in' },
  { id: 'D000002',  usertype: 'doctor',          name: 'Dr. Rohan Kapoor',                mobileno: '9845011223', password: null, otp: '123456', email: 'rohan.kapoor@d2cpharma.in' },
  { id: 'DP000001', usertype: 'doctor-pharmacy', name: 'Wellness Plus Pharmacy',          mobileno: '9823456710', password: null, otp: '123456', email: 'wellness.plus@d2cpharma.in' },
  { id: 'H000001',  usertype: 'hospital',        name: 'Sunrise Multispecialty Hospital', mobileno: '9822110099', password: null, otp: '123456', email: 'sunrise.hospital@d2cpharma.in' },

  // Territory Managers
  { id: 'T000001', usertype: 'tm',  name: 'Amit Verma',    mobileno: '9000000002', password: null, otp: '123456', division_code: 'DIV-HCA', email: 'amit.verma@d2cpharma.in' },
  { id: 'T000002', usertype: 'tm',  name: 'Vikram Patil',  mobileno: '9000000009', password: null, otp: '123456', division_code: 'DIV-GRO', email: 'vikram.patil@d2cpharma.in' },
  { id: 'T000003', usertype: 'tm',  name: 'Neha Joshi',    mobileno: '9000000010', password: null, otp: '123456', division_code: 'DIV-BEV', email: 'neha.joshi@d2cpharma.in' },
  { id: 'T000004', usertype: 'tm',  name: 'Rohit Saxena',  mobileno: '9000000021', password: null, otp: '123456', division_code: 'DIV-PCA', email: 'rohit.saxena@d2cpharma.in' },

  // Regional Managers
  { id: 'R000001', usertype: 'rm',  name: 'Sunita Rao',     mobileno: '9000000003', password: null, otp: '123456', division_code: 'DIV-HCA', email: 'sunita.rao@d2cpharma.in' },
  { id: 'R000002', usertype: 'rm',  name: 'Kavita Singh',   mobileno: '9000000011', password: null, otp: '123456', division_code: 'DIV-BEV', email: 'kavita.singh@d2cpharma.in' },
  { id: 'R000003', usertype: 'rm',  name: 'Arjun Malhotra', mobileno: '9000000015', password: null, otp: '123456', division_code: 'DIV-GRO', email: 'arjun.malhotra@d2cpharma.in' },
  { id: 'R000004', usertype: 'rm',  name: 'Meera Iyer',     mobileno: '9000000022', password: null, otp: '123456', division_code: 'DIV-PCA', email: 'meera.iyer@d2cpharma.in' },

  // Zonal Sales Managers
  { id: 'Z000001', usertype: 'zsm', name: 'Deepak Khanna',  mobileno: '9000000004', password: null, otp: '123456', division_code: 'DIV-HCA', email: 'deepak.khanna@d2cpharma.in' },
  { id: 'Z000002', usertype: 'zsm', name: 'Mohan Reddy',    mobileno: '9000000012', password: null, otp: '123456', division_code: 'DIV-BEV', email: 'mohan.reddy@d2cpharma.in' },
  { id: 'Z000003', usertype: 'zsm', name: 'Sneha Kulkarni', mobileno: '9000000016', password: null, otp: '123456', division_code: 'DIV-GRO', email: 'sneha.kulkarni@d2cpharma.in' },
  { id: 'Z000004', usertype: 'zsm', name: 'Sanjay Gupta',   mobileno: '9000000023', password: null, otp: '123456', division_code: 'DIV-PCA', email: 'sanjay.gupta@d2cpharma.in' },

  // National Sales Managers
  { id: 'N000001', usertype: 'nsm', name: 'Rajeev Sinha',    mobileno: '9000000005', password: null, otp: '123456', division_code: 'DIV-HCA', email: 'rajeev.sinha@d2cpharma.in' },
  { id: 'N000002', usertype: 'nsm', name: 'Anita Desai',     mobileno: '9000000020', password: null, otp: '123456', division_code: 'DIV-BEV', email: 'anita.desai@d2cpharma.in' },
  { id: 'N000003', usertype: 'nsm', name: 'Vivek Choudhary', mobileno: '9000000017', password: null, otp: '123456', division_code: 'DIV-GRO', email: 'vivek.choudhary@d2cpharma.in' },
  { id: 'N000004', usertype: 'nsm', name: 'Divya Menon',     mobileno: '9000000024', password: null, otp: '123456', division_code: 'DIV-PCA', email: 'divya.menon@d2cpharma.in' },

  // Password users — Admins (one per division). admin is division-specific —
  // an admin account with no division_code cannot log in (see auth.js).
  // infinity_division_id: placeholder Infinity division IDs — replace with the real per-division IDs from infinityplus.wockhardt.com
  { id: 'A000001', usertype: 'admin', name: 'Grocery Admin',      mobileno: '9000000001', password: 'Wock@123', otp: null, division_code: 'DIV-GRO', email: 'admin.grocery@d2cpharma.in', infinity_division_id: '1' },
  { id: 'A000002', usertype: 'admin', name: 'Beverages Admin',    mobileno: '9000000027', password: 'Wock@123', otp: null, division_code: 'DIV-BEV', email: 'admin.beverages@d2cpharma.in', infinity_division_id: '2' },
  { id: 'A000003', usertype: 'admin', name: 'Personal Care Admin', mobileno: '9000000028', password: 'Wock@123', otp: null, division_code: 'DIV-PCA', email: 'admin.personalcare@d2cpharma.in', infinity_division_id: '3' },
  { id: 'A000004', usertype: 'admin', name: 'Home Care Admin',    mobileno: '9000000029', password: 'Wock@123', otp: null, division_code: 'DIV-HCA', email: 'admin.homecare@d2cpharma.in', infinity_division_id: '4' },

  // Super Admins — same screens/permissions as admin, but always scoped to a single
  // division at a time, chosen client-side via the Admin Dashboard division selector
  // (so division_code on the account itself stays NULL, like CFA below).
  { id: 'SA000001', usertype: 'super-admin', name: 'Rakesh Kulkarni', mobileno: '9000000030', password: 'Wock@123', otp: null, division_code: null, email: 'super.admin@d2cpharma.in' },

  // SCM Admin — like super-admin, not scoped to a single division; restricted to
  // Product Master, Customer Upload, and CFA Records (the only roles, alongside
  // super-admin, allowed to write to those three areas).
  { id: 'SCM000001', usertype: 'scm-admin', name: 'SCM Admin', mobileno: '9000000031', password: 'Wock@123', otp: null, division_code: null, email: 'scm.admin@d2cpharma.in' },

  // CFA — unrestricted across all divisions
  { id: 'C000001', usertype: 'cfa',   name: 'CFA Chennai',   mobileno: '9444556677', password: 'CFApass@1', otp: null, email: 'cfa.chennai@d2cpharma.in' },

  // Marketing Managers
  { id: 'M000001', usertype: 'mm',    name: 'Pooja Agarwal', mobileno: '9000000006', password: 'MMpass@1', otp: null, division_code: 'DIV-HCA', email: 'pooja.agarwal@d2cpharma.in' },
  { id: 'M000002', usertype: 'mm',    name: 'Ritu Sharma',   mobileno: '9000000013', password: 'MMpass@2', otp: null, division_code: 'DIV-BEV', email: 'ritu.sharma@d2cpharma.in' },
  { id: 'M000003', usertype: 'mm',    name: 'Kiran Bhatt',   mobileno: '9000000018', password: 'MMpass@3', otp: null, division_code: 'DIV-GRO', email: 'kiran.bhatt@d2cpharma.in' },
  { id: 'M000004', usertype: 'mm',    name: 'Farah Sheikh',  mobileno: '9000000025', password: 'MMpass@4', otp: null, division_code: 'DIV-PCA', email: 'farah.sheikh@d2cpharma.in' },

  // Distribution Managers
  { id: 'DM000001', usertype: 'dm',    name: 'Suresh Pillai', mobileno: '9000000007', password: 'DMpass@1', otp: null, division_code: 'DIV-HCA', email: 'suresh.pillai@d2cpharma.in' },
  { id: 'DM000002', usertype: 'dm',    name: 'Anand Nair',    mobileno: '9000000014', password: 'DMpass@2', otp: null, division_code: 'DIV-BEV', email: 'anand.nair@d2cpharma.in' },
  { id: 'DM000003', usertype: 'dm',    name: 'Manoj Tiwari',  mobileno: '9000000019', password: 'DMpass@3', otp: null, division_code: 'DIV-GRO', email: 'manoj.tiwari@d2cpharma.in' },
  { id: 'DM000004', usertype: 'dm',    name: 'Ramesh Yadav',  mobileno: '9000000026', password: 'DMpass@4', otp: null, division_code: 'DIV-PCA', email: 'ramesh.yadav@d2cpharma.in' },
]

const CFA_LOCATIONS = [
  { cfa_code: 'CFA-MUM-01', cfa_name: 'CFA Mumbai',    mobile: '9022110011', email: 'cfa.mumbai@d2cpharma.in' },
  { cfa_code: 'CFA-PNQ-02', cfa_name: 'CFA Pune',      mobile: '9112233445', email: 'cfa.pune@d2cpharma.in' },
  { cfa_code: 'CFA-DEL-03', cfa_name: 'CFA Delhi',     mobile: '9911223300', email: 'cfa.delhi@d2cpharma.in' },
  { cfa_code: 'CFA-BLR-04', cfa_name: 'CFA Bangalore', mobile: '9845001122', email: 'cfa.bangalore@d2cpharma.in' },
  { cfa_code: 'CFA-HYD-05', cfa_name: 'CFA Hyderabad', mobile: '9000112233', email: 'cfa.hyderabad@d2cpharma.in' },
  { cfa_code: 'CFA-CHN-06', cfa_name: 'CFA Chennai',   mobile: '9444556677', email: 'cfa.chennai@d2cpharma.in' },
]

const PRODUCTS = [
  {
    name: 'Premium Cooking Oil', brand: 'SunGold', material_code: 'MC-1001',
    division_code: 'DIV-GRO', price: 185, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 100, accent: '#ff5a1f',
    unit: '1 Litre Bottle', unit_description: 'Each bottle contains 1 litre of refined sunflower cooking oil.',
    description: 'Refined sunflower cooking oil pressed for a light, neutral taste — packed in a sturdy 1 litre bottle built for daily kitchens.',
    schemes: [
      { label: 'Buy 5 Get 1 Free',                scheme_type: 'buy_get_free', buy_qty: 5,  free_qty: 1 },
      { label: 'Buy 10 Get 2 Free',               scheme_type: 'buy_get_free', buy_qty: 10, free_qty: 2 },
      { label: 'Order 50+ Get Free Steel Lunch Box', scheme_type: 'gift', min_qty: 50, gift_name: 'Steel Lunch Box', gift_value: 299 },
    ],
  },
  {
    name: 'Whole Wheat Atta — 5kg', brand: 'Hearth & Co.', material_code: 'MC-1002',
    division_code: 'DIV-GRO', price: 245, min_order_qty: 2, init_min_order_qty: 2, max_order_qty: 50, accent: '#c5430f',
    unit: '5 kg Pack', unit_description: 'Each pack contains 5kg of stone-ground whole wheat flour.',
    description: 'Stone-ground whole wheat flour milled from a blend of high-protein grains, finished with a touch of bran for everyday rotis.',
    schemes: [
      { label: 'Buy 10 Get 2 Free', scheme_type: 'buy_get_free', buy_qty: 10, free_qty: 2 },
      { label: 'Buy 20 Get 5 Free', scheme_type: 'buy_get_free', buy_qty: 20, free_qty: 5 },
      { label: 'Order 30+ Get Free Masala Dabba', scheme_type: 'gift', min_qty: 30, gift_name: 'Masala Dabba', gift_value: 199 },
    ],
  },
  {
    name: 'Sparkling Citrus Water', brand: 'Ariva', material_code: 'MC-1003',
    division_code: 'DIV-BEV', price: 60, min_order_qty: 6, init_min_order_qty: 6, max_order_qty: 60, accent: '#4f7585',
    unit: '250 ml Can', unit_description: 'Each can contains 250ml of lightly carbonated citrus water.',
    description: 'Lightly carbonated water infused with cold-pressed citrus oils — zero sugar, zero calories, finished crisp and clean.',
    schemes: [
      { label: 'Buy 12 Get 3 Free', scheme_type: 'buy_get_free', buy_qty: 12, free_qty: 3 },
    ],
  },
  {
    name: 'Cold Brew Concentrate', brand: 'Ariva', material_code: 'MC-1004',
    division_code: 'DIV-BEV', price: 399, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 24, accent: '#2b2f35',
    unit: '500 ml Bottle', unit_description: 'Each bottle contains 500ml of double-strength cold brew concentrate.',
    description: 'Slow-steeped for eighteen hours and bottled at double strength — smooth, low-acid, and ready to pour over ice.',
    schemes: [],
  },
  {
    name: 'Aloe & Oat Body Wash', brand: 'CleanWave', material_code: 'MC-1005',
    division_code: 'DIV-PCA', price: 275, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 40, accent: '#3c8f6b',
    unit: '300 ml Bottle', unit_description: 'Each bottle contains 300ml of soap-free body wash.',
    description: "A creamy, soap-free wash with aloe vera and colloidal oat extract that cleanses without stripping the skin's natural barrier.",
    schemes: [
      { label: 'Buy 3 Get 1 Free', scheme_type: 'buy_get_free', buy_qty: 3, free_qty: 1 },
      { label: 'Buy 6 Get 2 Free', scheme_type: 'buy_get_free', buy_qty: 6, free_qty: 2 },
    ],
  },
  {
    name: 'Daily Multivitamin Tablets', brand: 'NutriPlus', material_code: 'MC-1006',
    division_code: 'DIV-PCA', price: 450, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 12, accent: '#ff5a1f',
    unit: 'Strip of 15 Tablets', unit_description: 'Each strip contains 15 coated multivitamin tablets.',
    description: 'A balanced once-a-day formula covering twelve essential vitamins and minerals, in an easy-swallow coated tablet.',
    schemes: [
      { label: 'Buy 2 Get 1 Free', scheme_type: 'buy_get_free', buy_qty: 2, free_qty: 1 },
    ],
  },
  {
    name: 'Citrus Floor Cleaner — 2L', brand: 'CleanWave', material_code: 'MC-1007',
    division_code: 'DIV-HCA', price: 210, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 30, accent: '#4f7585',
    unit: '2 Litre Bottle', unit_description: 'Each bottle contains 2 litres of concentrated floor cleaner.',
    description: 'A concentrated, naturally-derived floor cleaner that cuts through grease and leaves behind a light citrus finish.',
    schemes: [
      { label: 'Buy 5 Get 1 Free',  scheme_type: 'buy_get_free', buy_qty: 5,  free_qty: 1 },
      { label: 'Buy 20 Get 5 Free', scheme_type: 'buy_get_free', buy_qty: 20, free_qty: 5 },
    ],
  },
  {
    name: 'Bamboo Kitchen Roll — Pack of 6', brand: 'Hearth & Co.', material_code: 'MC-1008',
    division_code: 'DIV-HCA', price: 320, min_order_qty: 1, init_min_order_qty: 1, max_order_qty: 24, accent: '#2b2f35',
    unit: 'Pack of 6 Rolls', unit_description: 'Each pack contains 6 bamboo kitchen paper rolls.',
    description: 'Highly absorbent, tear-resistant kitchen roll made from fast-growing bamboo pulp — a sturdier, more sustainable everyday staple.',
    schemes: [],
  },
]

// CFA name → code mapping for customer seed
const CFA_NAME_TO_CODE = {
  'CFA Mumbai':    'CFA-MUM-01',
  'CFA Pune':      'CFA-PNQ-02',
  'CFA Delhi':     'CFA-DEL-03',
  'CFA Bangalore': 'CFA-BLR-04',
  'CFA Hyderabad': 'CFA-HYD-05',
  'CFA Chennai':   'CFA-CHN-06',
}

// Pre-existing customers (from mock data — seeded as already approved)
const DOCTORS = [
  {
    id: 'doc-1001', customer_type: 'doctor', name: 'Dr. Anjali Mehta',
    email: 'anjali.mehta@carepoint.in', mobile: '9821044556',
    address: '14 Lotus Tower, FC Road', pin_code: '411001', city: 'Pune', state: 'Maharashtra',
    cfa_name: 'CFA Pune', division_code: 'DIV-PCA',
    registration_number: 'MH-MED-58213', age: 41, gender: 'Female',
  },
  {
    id: 'doc-1002', customer_type: 'doctor', name: 'Dr. Rohan Kapoor',
    email: 'rohan.kapoor@cityhealth.in', mobile: '9845011223',
    address: '22 Residency Road', pin_code: '560001', city: 'Bengaluru', state: 'Karnataka',
    cfa_name: 'CFA Bangalore', division_code: 'DIV-HCA',
    registration_number: 'KA-MED-77410', age: 47, gender: 'Male',
  },
  {
    id: 'doc-1003', customer_type: 'doctor', name: 'Dr. Sara Iqbal',
    email: 'sara.iqbal@northclinic.in', mobile: '9911223344',
    address: '8 Connaught Place', pin_code: '110001', city: 'New Delhi', state: 'Delhi',
    cfa_name: 'CFA Delhi', division_code: 'DIV-GRO',
    registration_number: 'DL-MED-90871', age: 36, gender: 'Female',
  },
  {
    id: 'doc-1004', customer_type: 'doctor', name: 'Dr. Vikram Nair',
    email: 'vikram.nair@coastalcare.in', mobile: '9870112233',
    address: '5 Marine Drive', pin_code: '400001', city: 'Mumbai', state: 'Maharashtra',
    cfa_name: 'CFA Mumbai', division_code: 'DIV-BEV',
    registration_number: 'MH-MED-31209', age: 53, gender: 'Male',
  },
]

const PHARMACIES = [
  {
    id: 'pha-2001', customer_type: 'doctor-pharmacy', name: 'Wellness Plus Pharmacy',
    email: 'contact@wellnessplus.in', mobile: '9823456710',
    address: '3 Market Yard Road', pin_code: '411001', city: 'Pune', state: 'Maharashtra',
    cfa_name: 'CFA Pune', division_code: 'DIV-GRO',
    gst_number: '27AAACW1234F1Z5', drug_licence_number: 'MH-DL-44120', pan_number: 'AAACW1234F', aadhaar_number: '234567891012',
  },
  {
    id: 'pha-2002', customer_type: 'doctor-pharmacy', name: 'MedLine Chemists',
    email: 'admin@medlinechemists.in', mobile: '9845998877',
    address: '17 Brigade Road', pin_code: '560001', city: 'Bengaluru', state: 'Karnataka',
    cfa_name: 'CFA Bangalore', division_code: 'DIV-PCA',
    gst_number: '29AABCM5678G1Z3', drug_licence_number: 'KA-DL-90213', pan_number: 'AABCM5678G', aadhaar_number: '345678912034',
  },
  {
    id: 'pha-2003', customer_type: 'doctor-pharmacy', name: 'Capital Care Pharmacy',
    email: 'support@capitalcarepharma.in', mobile: '9911774455',
    address: '29 Karol Bagh', pin_code: '110001', city: 'New Delhi', state: 'Delhi',
    cfa_name: 'CFA Delhi', division_code: 'DIV-HCA',
    gst_number: '07AADCC9012H1Z8', drug_licence_number: 'DL-DL-77051', pan_number: 'AADCC9012H', aadhaar_number: '456789123045',
  },
]

const HOSPITALS = [
  {
    id: 'hos-3001', customer_type: 'hospital', name: 'Sunrise Multispecialty Hospital',
    email: 'frontdesk@sunrisemultispecialty.in', mobile: '9822110099',
    address: '101 Senapati Bapat Road', pin_code: '411001', city: 'Pune', state: 'Maharashtra',
    cfa_name: 'CFA Pune', division_code: 'DIV-GRO',
    gst_number: '27AAFCS4321K1Z7', hospital_registration_number: 'MH-HOSP-22018', drug_licence_number: 'MH-DL-66043', pan_number: 'AAFCS4321K', aadhaar_number: '567891230456',
  },
  {
    id: 'hos-3002', customer_type: 'hospital', name: 'Lakeview General Hospital',
    email: 'info@lakeviewgeneral.in', mobile: '9845221100',
    address: '47 Hosur Road', pin_code: '560001', city: 'Bengaluru', state: 'Karnataka',
    cfa_name: 'CFA Bangalore', division_code: 'DIV-BEV',
    gst_number: '29AAGCL8765M1Z1', hospital_registration_number: 'KA-HOSP-50871', drug_licence_number: 'KA-DL-12077', pan_number: 'AAGCL8765M', aadhaar_number: '678912304567',
  },
  {
    id: 'hos-3003', customer_type: 'hospital', name: 'Capital Heart & Multispecialty Centre',
    email: 'reception@capitalheartcentre.in', mobile: '9911009988',
    address: '63 Pusa Road', pin_code: '110001', city: 'New Delhi', state: 'Delhi',
    cfa_name: 'CFA Delhi', division_code: 'DIV-PCA',
    gst_number: '07AAHCC2109N1Z6', hospital_registration_number: 'DL-HOSP-66302', drug_licence_number: 'DL-DL-88154', pan_number: 'AAHCC2109N', aadhaar_number: '789123045678',
  },
]

// Customer outstanding balances — covers every paymentOptions gating case from
// DIVISION_RULES below: DIV-GRO/DIV-HCA have online+payment-link enabled (Pay Now
// is testable there), DIV-PCA/DIV-BEV have none (amount shows, no button), and
// hos-3001 is left at zero to exercise the "Settled" state.
const CUSTOMER_OUTSTANDING = [
  { customerid: 'doc-1003', division_code: 'DIV-GRO', sap_customer_code: 'SAP-DOC-1003', outstanding_amount: 4500 },
  { customerid: 'pha-2001', division_code: 'DIV-GRO', sap_customer_code: 'SAP-PHA-2001', outstanding_amount: 12500 },
  { customerid: 'hos-3001', division_code: 'DIV-GRO', sap_customer_code: 'SAP-HOS-3001', outstanding_amount: 0 },
  { customerid: 'doc-1002', division_code: 'DIV-HCA', sap_customer_code: 'SAP-DOC-1002', outstanding_amount: 3200 },
  { customerid: 'pha-2003', division_code: 'DIV-HCA', sap_customer_code: 'SAP-PHA-2003', outstanding_amount: 8000 },
  { customerid: 'doc-1001', division_code: 'DIV-PCA', sap_customer_code: 'SAP-DOC-1001', outstanding_amount: 1500 },
  { customerid: 'hos-3002', division_code: 'DIV-BEV', sap_customer_code: 'SAP-HOS-3002', outstanding_amount: 2200 },
]

// Division mapping — D2D division code/name plus the numeric Infinity division
// code its DML/CML sync endpoints expect (placeholder; replace with the real
// per-division IDs from infinityplus.wockhardt.com). Backs GET /api/divisions,
// which feeds the admin/super-admin division selector.
const DIVISION_MAPPING = [
  { division_code: 'DIV-GRO', division_name: 'Grocery',       infinity_division_code: '1' },
  { division_code: 'DIV-BEV', division_name: 'Beverages',     infinity_division_code: '2' },
  { division_code: 'DIV-PCA', division_name: 'Personal Care',  infinity_division_code: '3' },
  { division_code: 'DIV-HCA', division_name: 'Home Care',     infinity_division_code: '4' },
]

// Division rules — today's hardcoded DIVISION_OVERRIDES (pre-admin-panel), expressed
// as full rows. New divisions added via the Division Rules admin panel don't belong here.
const BANK_NAMES = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Yes Bank',
  'IndusInd Bank',
  'Canara Bank',
]

const DIVISION_RULES = [
  {
    division_code: 'DIV-BEV',
    order_workflow: {
      initialStatus: 'pending-l1',
      steps: [
        { step: 1, label: 'Field Management Approval', approverRoles: ['rm', 'zsm', 'nsm'], fromStatus: 'pending-l1', toStatus: 'approved' },
      ],
    },
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: DEFAULT_RULES.orderEntry,
    documents: DEFAULT_RULES.documents,
  },
  {
    division_code: 'DIV-PCA',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: false, minOrderValue: 2000, paymentOptions: [] },
    documents: {
      customer: DEFAULT_RULES.documents.customer,
      order: [{ key: 'prescriptionCopy', label: 'Prescription Copy', required: true }],
    },
  },
  {
    division_code: 'DIV-GRO',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: true, minOrderValue: 0, paymentOptions: ['pdc-delivery', 'online', 'payment-link'] },
    documents: DEFAULT_RULES.documents,
  },
  {
    division_code: 'DIV-HCA',
    order_workflow: DEFAULT_RULES.orderWorkflow,
    customer_workflow: DEFAULT_RULES.customerWorkflow,
    order_entry: { showPrices: true, minOrderValue: 0, paymentOptions: ['online', 'payment-link'] },
    documents: DEFAULT_RULES.documents,
  },
]

// ── Seed functions ────────────────────────────────────────────────────────────

async function seedUsers(client) {
  const idByLabel = new Map()
  let count = 0
  for (const u of USERS_RAW) {
    const hash = u.password ? await bcrypt.hash(u.password, SALT_ROUNDS) : null
    // emp_code has no meaning for cfa accounts (schema.sql) or OTP-login usertypes —
    // for the admin-panel usertypes that do carry one, fixtures don't set it
    // explicitly, so fall back to the fixture label itself as a placeholder HR code
    // (matches the old seedAdminUserDetails() behavior).
    const empcode = (ADMIN_MANAGED_USERTYPES.includes(u.usertype) && u.usertype !== 'cfa')
      ? (u.emp_code ?? u.id)
      : null
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO users (usertype, name, mobileno, password_hash, otp, division_code, email, infinity_division_id, sap_code, empcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (mobileno) DO UPDATE SET
         usertype = EXCLUDED.usertype, name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         otp = EXCLUDED.otp, division_code = EXCLUDED.division_code, email = EXCLUDED.email,
         infinity_division_id = EXCLUDED.infinity_division_id, sap_code = EXCLUDED.sap_code,
         empcode = COALESCE(EXCLUDED.empcode, users.empcode)
       RETURNING id`,
      [u.usertype, u.name, u.mobileno, hash, u.otp, u.division_code ?? null, u.email ?? null, u.infinity_division_id ?? null, u.sap_code ?? null, empcode]
    )
    idByLabel.set(u.id, id)
    count++
  }
  return { map: idByLabel, summary: `${count} users` }
}

async function seedCfaLocations(client) {
  for (const c of CFA_LOCATIONS) {
    await client.query(
      `INSERT INTO cfa_locations (cfa_code, cfa_name, mobile, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cfa_code) DO UPDATE SET
         cfa_name = EXCLUDED.cfa_name, mobile = EXCLUDED.mobile, email = EXCLUDED.email`,
      [c.cfa_code, c.cfa_name, c.mobile, c.email]
    )
  }
  return `${CFA_LOCATIONS.length} CFA locations`
}

// No natural unique key exists on products (material_code isn't constrained
// unique), so — unlike the other seed functions — this always INSERTs fresh
// rather than upserting; re-running seed.js without wiping first will create
// duplicates. Fine for this repo's wipe-&-reseed workflow.
async function seedProducts(client) {
  let productCount = 0
  let schemeCount  = 0
  for (const p of PRODUCTS) {
    const { rows: [{ id: productId }] } = await client.query(
      `INSERT INTO products
         (name, brand, material_code, division_code, price, description, min_order_qty, init_min_order_qty, max_order_qty, accent, unit, unit_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [p.name, p.brand, p.material_code, p.division_code, p.price,
       p.description, p.min_order_qty, p.init_min_order_qty, p.max_order_qty, p.accent,
       p.unit ?? null, p.unit_description ?? null]
    )
    productCount++

    for (const s of p.schemes) {
      await client.query(
        `INSERT INTO product_schemes
           (product_id, label, scheme_type, buy_qty, free_qty, min_qty, gift_name, gift_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [productId, s.label, s.scheme_type,
         s.buy_qty ?? null, s.free_qty ?? null,
         s.min_qty ?? null, s.gift_name ?? null, s.gift_value ?? null]
      )
      schemeCount++
    }
  }
  return `${productCount} products, ${schemeCount} schemes`
}

// c.id below (e.g. 'doc-1003') is a JS-only lookup label, not sent to the
// database — customers.id is now a DB-generated UUID. Returned as a label -> id
// map so seedCustomerOutstanding() can resolve CUSTOMER_OUTSTANDING's
// customerid (also a label) to the real generated UUID.
async function seedCustomers(client) {
  const all = [...DOCTORS, ...PHARMACIES, ...HOSPITALS]
  const idByLabel = new Map()
  for (const c of all) {
    const cfaCode = CFA_NAME_TO_CODE[c.cfa_name] ?? null
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO customers
         (customer_type, name, email, mobile, address, pin_code, city, state,
          cfa_code, division_code, approval_status,
          age, gender, registration_number,
          gst_number, drug_licence_number, pan_number, aadhaar_number,
          hospital_registration_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',
               $11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (mobile) DO UPDATE SET
         name = EXCLUDED.name, email = EXCLUDED.email,
         city = EXCLUDED.city, state = EXCLUDED.state, approval_status = EXCLUDED.approval_status,
         age = EXCLUDED.age, gender = EXCLUDED.gender,
         registration_number = EXCLUDED.registration_number,
         gst_number = EXCLUDED.gst_number, drug_licence_number = EXCLUDED.drug_licence_number,
         pan_number = EXCLUDED.pan_number, aadhaar_number = EXCLUDED.aadhaar_number,
         hospital_registration_number = EXCLUDED.hospital_registration_number
       RETURNING id`,
      [
        c.customer_type, c.name, c.email, c.mobile, c.address,
        c.pin_code, c.city, c.state, cfaCode, c.division_code,
        c.age ?? null, c.gender ?? null, c.registration_number ?? null,
        c.gst_number ?? null, c.drug_licence_number ?? null,
        c.pan_number ?? null, c.aadhaar_number ?? null,
        c.hospital_registration_number ?? null,
      ]
    )
    idByLabel.set(c.id, id)
  }
  return { map: idByLabel, summary: `${all.length} customers` }
}

async function seedCustomerOutstanding(client, customersByLabel) {
  for (const o of CUSTOMER_OUTSTANDING) {
    const customerid = customersByLabel.get(o.customerid)
    await client.query(
      `INSERT INTO customer_outstanding (customerid, division_code, sap_customer_code, outstanding_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customerid) DO UPDATE SET
         division_code = EXCLUDED.division_code, sap_customer_code = EXCLUDED.sap_customer_code,
         outstanding_amount = EXCLUDED.outstanding_amount`,
      [customerid, o.division_code, o.sap_customer_code, o.outstanding_amount]
    )
  }
  return `${CUSTOMER_OUTSTANDING.length} customer outstanding balances`
}

async function seedDivisionMapping(client) {
  for (const d of DIVISION_MAPPING) {
    await client.query(
      `INSERT INTO division_mapping (division_code, division_name, infinity_division_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (division_code) DO UPDATE SET
         division_name = EXCLUDED.division_name, infinity_division_code = EXCLUDED.infinity_division_code`,
      [d.division_code, d.division_name, d.infinity_division_code]
    )
  }
  return `${DIVISION_MAPPING.length} division mappings`
}

async function seedDivisionRules(client) {
  for (const d of DIVISION_RULES) {
    await client.query(
      `INSERT INTO division_rules (division_code, order_workflow, customer_workflow, order_entry, documents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (division_code) DO UPDATE SET
         order_workflow = EXCLUDED.order_workflow, customer_workflow = EXCLUDED.customer_workflow,
         order_entry = EXCLUDED.order_entry, documents = EXCLUDED.documents, updated_at = NOW()`,
      [d.division_code, JSON.stringify(d.order_workflow), JSON.stringify(d.customer_workflow),
       JSON.stringify(d.order_entry), JSON.stringify(d.documents)]
    )
  }
  return `${DIVISION_RULES.length} division rules`
}

async function seedBankMaster(client) {
  for (const bankName of BANK_NAMES) {
    await client.query('INSERT INTO bank_master (bank_name) VALUES ($1) ON CONFLICT DO NOTHING', [bankName])
  }
  return `${BANK_NAMES.length} bank names`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect()
  console.log('\nD2D Portal — Database Seed\n')
  try {
    await client.query('BEGIN')
    await run('Users', async () => (await seedUsers(client)).summary)
    await run('CFA locations',  () => seedCfaLocations(client))
    await run('Products',       () => seedProducts(client))
    let customersByLabel
    await run('Customers', async () => {
      const { map, summary } = await seedCustomers(client)
      customersByLabel = map
      return summary
    })
    await run('Customer outstanding', () => seedCustomerOutstanding(client, customersByLabel))
    await run('Division mapping', () => seedDivisionMapping(client))
    await run('Division rules', () => seedDivisionRules(client))
    await run('Bank master',    () => seedBankMaster(client))
    await client.query('COMMIT')
    console.log('\nSeed complete.\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nSeed failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
