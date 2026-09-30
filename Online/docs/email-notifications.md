# D2D Email Notifications Reference

All email logic lives in `backend/src/services/notifications.js` (orchestration) and `backend/src/services/emailService.js` (dispatch). Templates are in `backend/src/templates/`.

---

## Address Sources

| Label | Where it comes from |
|---|---|
| **RM / ZSM / NSM / MM / DM** | `vw_tm_hierarchy` — looked up by the submitter's `empcode` |
| **TM (submitter)** | `users.email` for the user who placed the order / registered the customer |
| **Customer** | `customer_email` field on the order or customer record |
| **CFA** | `cfa_locations.email` for the order's assigned CFA code |
| **Division CC** | `division_contacts.cc_emails` for the division — configured via admin panel → Division Contacts; falls back to empty if none set |

---

## OTP / Auth

| Event | Subject | TO | CC |
|---|---|---|---|
| Login OTP | `Wockhardt Online - OTP Verification` | User requesting OTP | — |

---

## Customer Workflow

| Event | Subject | TO | CC |
|---|---|---|---|
| Customer submitted (TM registers) | `Approval Needed — Customer C-XXXX` | RM, ZSM, NSM | TM (submitter) + Division CC |
| L1 approved → awaiting final approval | `Final Approval Needed — Customer C-XXXX` | DM | TM (submitter) + Division CC |
| Customer fully approved (DM approves) | `Customer C-XXXX Approved` | TM (submitter) | RM, ZSM, NSM, DM + Division CC |
| Customer rejected (any step) | `Customer C-XXXX Rejected` | TM (submitter) | RM, ZSM, NSM, DM + Division CC |

---

## Order Workflow

| Event | Subject | TO | CC |
|---|---|---|---|
| Order submitted (TM places order) | `Approval Needed — Order ORD-XXXX` | RM, ZSM, NSM | TM (submitter) + Division CC |
| L1 approved → awaiting final approval | `Final Approval Needed — Order ORD-XXXX` | MM | TM (submitter) + Division CC |
| Order fully approved (MM approves) | `Order ORD-XXXX Approved` | TM (submitter) | RM, ZSM, NSM, MM + Division CC |
| Order rejected (any step) | `Order ORD-XXXX Rejected` | TM (submitter) | RM, ZSM, NSM, MM + Division CC |

---

## Payment

| Event | Subject | TO | CC |
|---|---|---|---|
| Order payment outcome (success / failure / aborted) | `Payment {Status} — Order ORD-XXXX` | Customer (`customer_email` on order) | TM + RM + CFA + Division CC |
| Outstanding payment outcome (success / failure / aborted) | `Payment {Status} — Customer C-XXXX (Name)` | Customer (`customer_email` on customer record) | TM + RM + CFA + Division CC |

---

## Admin

| Event | Subject | TO | CC |
|---|---|---|---|
| Test email (sent from admin panel) | `D2D Portal — Email Configuration Test` | Address entered by admin | — |
