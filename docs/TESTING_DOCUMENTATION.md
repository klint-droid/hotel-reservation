# Testing Documentation & QA Security Review

## 1. Testing Strategy
Verification is performed in two explicit layers to enforce Section 12 acceptance criteria and Section 15 integrity rules:

1. **Automated Offline Unit & Integration Suite (`npm test`)**:
   - Executes all **16 actual `.gs` files** and **4 `dialogs/*.html` files** directly inside a faithful Google Apps Script V8 `vm` runtime mock (`tests/helpers/gasMockRuntime.js`) using Node.js's built-in `node:test` runner (zero external backend frameworks).
   - Tests both alphabetical and **reversed file load order** to prove zero Google Apps Script TDZ/initialization dependencies.
2. **Live Authorized Google Workspace Verification (`tests/integration/LiveSmokeTests.gs`)**:
   - **Important Rule**: Local mock tests verify all business logic, security controls, state transitions, and error handling, but **live Google Forms / Sheets / Docs / Drive / Gmail integrations MUST be verified against an authorized Google account** using `DEPLOYMENT_GUIDE.md` Step 7 and `LiveSmokeTests.gs` before inviting real guests.

---

## 2. Automated Test Suite Summary

Command: `npm test`
Result: **31 / 31 PASSED (0 failed)**

| Suite File | Tests | Scope |
|---|---|---|
| `tests/unit/phase1_config_utils.test.js` | 3 | Frozen schema constants, calendar date parsing, filename sanitization, formula injection neutralization, HTML/regex escaping, SHA-256 hashing, `ScriptLock` exclusivity & cleanup |
| `tests/unit/phase2_setup.test.js` | 1 | `runFullSetup()` creates 4 admin sheets (`20/10/4/9` columns), conditional colors, dropdowns, protections, public Google Form (9 fields + validations), private Drive folder, hotel Docs template, and idempotent triggers |
| `tests/unit/phase3_backend.test.js` | 5 | Valid guest intake (`PENDING`/`NOT_SENT`, `STAY-YYYYMMDD-XXXX`, zero emails), all server-side validation failures, exact duplicate blocking vs. overlapping flagging, sequential lock self-healing, fail-closed admin auth |
| `tests/unit/phase4_admin_approval.test.js` | 5 | Custom `STAYCATION MANAGEMENT` menu (9 items), approve/reject guards & zero auto-emails, edit-triggered revocation & PDF invalidation, modal rendering, unauthorized admin denial |
| `tests/unit/phase5_pdf.test.js` | 2 | Sanitized `ENDORSEMENT_<REF>_<NAME>.pdf`, private Drive permissions, placeholder substitution, temp Doc trash cleanup, blocking PENDING/REJECTED/missing template/missing folder/missing placeholders/tampering |
| `tests/unit/phase6_email.test.js` | 3 | HTML email & PDF attachment delivery, alias/reply-to handling, post-send `SENT` transition, Email & Activity logs, duplicate-send prevention, missing PDF / quota exceeded / simulated Gmail failure -> `FAILED` + explicit manual retry |
| `tests/integration/end_to_end_workflow.test.js` | 5 | Complete happy path, post-approval edit -> re-approve -> regenerate PDF -> email flow, XSS/formula/`$`/`\` defenses, reverse file load order, inline Drive logo insertion |
| `tests/integration/security_audit_regressions.test.js` | 7 | Dedicated regression tests covering all HIGH, MEDIUM, and LOW findings from the Agent 6 QA & Security Audit |

---

## 3. Specification Scenario Coverage Matrix (Section 12)

### Guest Registration
- [x] Valid reservation submission (`PENDING`, `NOT_SENT`, `STAY-YYYYMMDD-XXXX`, zero auto-email)
- [x] Missing required information (Full Name, Email, Phone, Dates, Guests, Agreement)
- [x] Invalid email format
- [x] Invalid contact number format
- [x] Check-out date before or equal to check-in date
- [x] Past check-in date (in configured `Asia/Manila` timezone)
- [x] Zero guests (`0` / negative / non-integer)
- [x] Duplicate submission (exact duplicate blocked & logged; overlapping booking with different details flagged in `Admin Remarks`; trigger replay deduplicated via `CacheService`)
- [x] Simultaneous submissions (`LockService` sequential counter + sheet max self-healing)

### Approval
- [x] Approve pending reservation (records timestamp, admin, approval hash; zero auto-email)
- [x] Reject pending reservation (requires reason; records remarks & activity log; zero auto-email)
- [x] Approve already approved reservation (blocked with `ERR_INVALID_STATE`)
- [x] Approve rejected reservation (blocked with `ERR_INVALID_STATE`)
- [x] Attempt to send a pending reservation (blocked with `ERR_INVALID_STATE`)
- [x] Attempt to send a rejected reservation (blocked with `ERR_INVALID_STATE`)
- [x] Editing endorsed fields after approval revokes approval -> `PENDING` and invalidates PDF

### PDF Generation
- [x] Generate PDF for approved reservation
- [x] Attempt to generate PDF for unapproved (`PENDING` / `REJECTED`) reservation
- [x] Missing or trashed template (`ERR_MISSING_TEMPLATE`)
- [x] Missing, trashed, or non-private output folder (`ERR_MISSING_FOLDER` / `ERR_PDF_GENERATION_FAILED`)
- [x] Missing required placeholders or unknown template placeholders (`ERR_UNRESOLVED_PLACEHOLDERS`)
- [x] Verify guest details appear accurately (including literal `$`, `\`, and guest `{{...}}` safety)
- [x] Verify generated file naming (`ENDORSEMENT_STAY-YYYYMMDD-XXXX_GUEST-NAME.pdf`)
- [x] Verify `PRIVATE` Drive sharing and temporary Google Doc cleanup

### Email Sending
- [x] Send valid approved reservation with attached PDF
- [x] Send without PDF (`ERR_PDF_MISSING`)
- [x] Send with invalid recipient (`ERR_VALIDATION_FAILED`)
- [x] Send an already-sent reservation (`ERR_DUPLICATE_EMAIL` — enforced across sheet status, `_SystemIntegrity` Sent-Lock, and `Email Logs`)
- [x] Simulate Gmail failure (sets `FAILED`, never `SENT`, preserves reservation data, logs error, allows explicit manual admin retry only)
- [x] Simulate daily Gmail quota exhaustion (`ERR_QUOTA_EXCEEDED`)
- [x] Verify attachment, HTML escaping, email logs, activity logs, and post-send logging failure isolation

---

## 4. Independent QA & Security Audit Summary (Agent 6)

An independent adversarial audit of all 21 files in `StaycationReservationSystem/` identified **6 HIGH**, **10 MEDIUM**, and **3 LOW** issues. **100% of findings were remediated and covered by regression tests:**

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| HIGH-1 | HIGH | Missing OAuth scopes (`https://mail.google.com/`, `script.send_mail`, `script.external_request`) and bogus quota fallback | Updated `appsscript.json` with exact scopes; removed bogus `remainingQuota = 1` fallback |
| HIGH-2 | HIGH | Non-existent `requireWholeNumberGreaterThan()` and consumer-crashing `setRequireLogin(false)` in `Setup.gs` | Replaced with `requireTextMatchesPattern('^[1-9][0-9]*$')`; wrapped `setRequireLogin(false)` in `try/catch` |
| HIGH-3 | HIGH | Privilege escalation via unprotected `Settings` sheet unioned with `ScriptProperties` | Made `ScriptProperties` the sole authoritative allowlist once initialized; hard-protected `Settings` sheet (`warningOnly: false`) |
| HIGH-4 | HIGH | Stored XSS via `javascript:` URI in editable `PDF File URL` column | Enforced canonical DriveApp URL in `EmailService.getEmailPreview()` and strict `https://(drive\|docs).google.com/` allowlist in HTML dialogs |
| HIGH-5 | HIGH | Unbound `pdfFileId` (PDF swap risk) & manual `Email Status` reset bypass | Created hidden, hard-protected `_SystemIntegrity` sheet binding `pdfHash` + `boundPdfFileId` + `sentLocked`, cross-checked against `Email Logs` |
| HIGH-6 | HIGH | Post-send logging error rolled `emailStatus` from `SENT` back to `FAILED` | Isolated `GmailApp.sendEmail()` dispatch from downstream logging so a delivered email is never marked `FAILED` |
| MEDIUM-1..10 | MEDIUM | Quote round-trip on `+`/`@` settings, timezone date drift, Google Docs `replaceText` over-escaping & guest `{{...}}` injection, O(N²) unlocked `onEdit`, ScriptProperties 500 KB growth, orphan PDF / folder privacy checks, trimmed-sheet `getRange` bounds, locale `e.namedValues` date ambiguity, settings validation & self-lockout, dialog control flow | Remediated across `Config.gs`, `Utils.gs`, `Setup.gs`, `DocumentService.gs`, `PdfService.gs`, `ApprovalService.gs`, `FormHandler.gs`, `ReferenceGenerator.gs`, `ValidationService.gs`, `Code.gs`, and `dialogs/*.html` |
| LOW-1..3 | LOW | Secret redaction across all log surfaces, `MISSING_APPROVAL_HASH` auto-revocation, MIME/length/header/filter hardening | Added `Utils.redactSensitiveText()` globally and applied all hardening fixes |

---

## 5. Live Google Workspace Acceptance Checklist (Pre-Production)
Because this development environment has no signed-in Google account connected, complete this checklist on your target Google account before onboarding real guests:
1. Deploy via `clasp push` or copy-paste following [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
2. Run `runFullSetup()` from Apps Script Editor and grant OAuth permissions.
3. Configure `System Settings` and verify all Workspace Health Diagnostics show **OK**.
4. Optionally copy `tests/integration/LiveSmokeTests.gs` into a staging project and execute `runLiveWorkspaceSmokeTest('your-test-inbox@example.com')` (remove after testing).
5. Perform one manual guest form submission from an Incognito browser window and verify every acceptance criterion in Section 12 live.
