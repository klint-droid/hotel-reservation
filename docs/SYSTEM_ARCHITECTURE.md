# System Architecture — Staycation Reservation & Endorsement Automation System

## 1. Overview
The **Staycation Reservation & Endorsement Automation System** is a 100% Google Workspace-native MVP designed for staycation businesses to collect guest reservations publicly, verify and approve them manually inside a private Google Sheets admin dashboard, generate personalized PDF Reservation Endorsement Certificates from a Google Docs template, and manually dispatch endorsement emails via Gmail with strict duplicate prevention and audit logging.

No external backend server, Node.js runtime service, or third-party database is required. Local Node.js tooling is used solely for `clasp` deployment and automated offline testing.

## 2. Logical Architecture

```text
GUEST (Public Browser, No Account Required)
  │
  ▼
GOOGLE FORMS ("Staycation Reservation Registration")
  │  (Writes immutable raw backup to hidden "Form Responses 1")
  ▼  [Installable onFormSubmit Trigger]
GOOGLE APPS SCRIPT — FormHandler + ValidationService + ReferenceGenerator (LockService)
  │  (Server-side validation, duplicate check, STAY-YYYYMMDD-XXXX, PENDING / NOT_SENT — NO EMAIL)
  ▼
GOOGLE SHEETS ("Reservations", "Email Logs", "Settings", "Activity Logs")
  │
  ├──► ADMIN APPROVAL (Code.gs Menu + ApprovalService + SecurityService)
  │      • Verifies authorized admin & PENDING status
  │      • Confirmation dialog
  │      • Updates APPROVED + Approved At/By + Endorsed SHA-256 Hash
  │      • NO EMAIL SENT AUTOMATICALLY
  │
  ├──► ENDORSEMENT GENERATOR (DocumentService + PdfService)
  │      • Verifies APPROVED + Endorsed Hash integrity
  │      • Clones Master Google Docs Template
  │      • Replaces all {{PLACEHOLDERS}} & asserts zero unresolved tokens
  │      • Exports PDF -> Private Google Drive Output Folder (PRIVATE sharing enforced)
  │      • Trashes temporary Google Doc; stores PDF File ID, URL, and PDF Hash
  │
  └──► EMAIL AUTOMATION (EmailService + EmailLogService)
         • Verifies APPROVED + PDF exists + Hash matches + Email Status NOT_SENT
         • Preview & Confirmation Dialog
         • Acquires ScriptLock, re-checks state, attaches PDF, calls GmailApp.sendEmail()
         • Marks SENT only AFTER Gmail succeeds; logs to Email Logs & Activity Logs
         • On failure: marks FAILED, records Last Error, preserves reservation data
  │
  ▼
GUEST RECEIVES HTML ENDORSEMENT EMAIL + ATTACHED PDF CERTIFICATE
```

## 3. Core Architectural Invariants
1. **No Auto-Email on Registration**: Guest submission creates a `PENDING` / `NOT_SENT` record and never triggers email delivery.
2. **No Auto-Email on Approval**: Approving a reservation records admin authorization metadata and never sends an email.
3. **Manual Three-Stage Admin Control**: Approval, PDF generation, and email sending are explicitly separated administrator operations.
4. **Post-Approval Edit Invalidation**: Changing any endorsed field (`Guest Name`, `Email Address`, `Contact Number`, `Check-in Date`, `Check-out Date`, `Number of Guests`, `Number of Rooms`) on an `APPROVED` reservation revokes approval back to `PENDING` and invalidates any previously generated PDF via both an installable `onEdit` trigger and SHA-256 hash verification in `ScriptProperties`.
5. **Immutable Primary Keys**: Every reservation is identified by a generated UUID (`RES-<uuid>`), never by spreadsheet row number.
6. **Concurrency Safety**: `LockService.getScriptLock()` guards reference number generation, approval/rejection transitions, PDF updates, and idempotent email dispatch.
7. **Fail-Closed Security**: Administrator actions verify executing Google account identity against an explicit allowlist, enforce private Drive sharing on generated PDFs, neutralize Google Sheets formula injection, and HTML-escape all guest values inside emails and modal dialogs.

## 4. Module Responsibilities (`StaycationReservationSystem/`)

| File | Responsibility |
|---|---|
| `appsscript.json` | V8 runtime, `Asia/Manila` timezone, Stackdriver logging, explicit minimal OAuth scopes |
| `Config.gs` | Single source of truth for sheet names, column maps, status enums, settings accessors, constants |
| `Utils.gs` | Pure utilities: UUIDs, timezone calendar dates, filename & formula sanitization, HTML/regex escaping, SHA-256 hashing, `withScriptLock` |
| `Setup.gs` | Idempotent bootstrapper for 4 sheets, conditional formatting, protections, Google Form, starter Docs template, private Drive folder, and installable triggers |
| `SecurityService.gs` | Admin identity resolution, allowlist enforcement, Drive `PRIVATE` permission enforcement, approval/PDF integrity hash management |
| `ValidationService.gs` | Strict server-side validation for form submissions, reservation records, dates, email/phone formats, and settings |
| `ReferenceGenerator.gs` | Concurrency-safe `STAY-YYYYMMDD-XXXX` reference number generation with daily sequence self-healing |
| `ReservationService.gs` | Reservation CRUD, lookup by `Reservation ID` / `Reference Number`, active row resolution, duplicate detection |
| `FormHandler.gs` | Installable `onFormSubmit` pipeline: replay protection, validation, duplicate flagging/blocking, persistence |
| `ApprovalService.gs` | Approve, Reject, and `onEdit`-driven approval revocation & PDF invalidation |
| `DocumentService.gs` | Master Google Docs template cloning, placeholder replacement (Body/Header/Footer), optional logo insertion, unresolved placeholder check |
| `PdfService.gs` | PDF export, sanitized `ENDORSEMENT_<REF>_<GUEST>.pdf` naming, private Drive storage, temp Doc cleanup |
| `EmailService.gs` | Pre-send validation, hotel-themed HTML + plain-text rendering, alias/reply-to handling, locked idempotent Gmail delivery |
| `EmailLogService.gs` | Append-only `Email Logs` writer and reader |
| `ActivityLogService.gs` | Append-only `Activity Logs` audit writer |
| `DashboardService.gs` | Live KPI metrics, quota monitoring, workspace health checks, formatting refresh |
| `Code.gs` | Thin Google Sheets entrypoint: `onOpen`, installable trigger wrappers, menu dispatchers, and `google.script.run` dialog endpoints |
| `dialogs/ReservationDetails.html` | Modal inspector for the selected reservation with quick actions and admin PDF preview link |
| `dialogs/ConfirmationDialog.html` | Confirmation modal for Approve, Reject (with required reason), and Send Endorsement Email |
| `dialogs/EmailPreview.html` | Visual HTML email & attachment preview before sending |
| `dialogs/SettingsDialog.html` | Settings manager and workspace health check panel |

## 5. Google Apps Script Platform Limitations & Design Mitigations

### 5.1 Administrator Identity (`Session.getActiveUser()`)
- **Google Workspace (Paid Domain)**: `Session.getActiveUser().getEmail()` reliably returns the executing user's email for accounts within the same Workspace organization.
- **Consumer Gmail (`@gmail.com`)**: Google restricts `Session.getActiveUser().getEmail()` for non-owner editors in consumer accounts, often returning an empty string (`""`).
- **Mitigation**: `SecurityService` fails closed when active identity cannot be verified against the configured admin allowlist. Single-owner consumer Gmail deployments may explicitly enable `ALLOW_OWNER_EFFECTIVE_FALLBACK` in `ScriptProperties` (documented in `DEPLOYMENT_GUIDE.md`), ensuring only the verified spreadsheet/script owner's email is accepted—never trusting user-typed identity strings.

### 5.2 Gmail Quotas & Sender Aliases
- **Quotas**: 100 recipients/day (consumer Gmail) vs. 1,500 recipients/day (Google Workspace). `EmailService` checks `MailApp.getRemainingDailyQuota()` before every send and displays remaining quota on the Dashboard.
- **Sender Identity**: `GmailApp.sendEmail({ from })` only works for verified Gmail "Send mail as" aliases. `EmailService` checks `GmailApp.getAliases()` and falls back gracefully to `name: STAYCATION_NAME` + `replyTo: STAYCATION_EMAIL_ADDRESS`.

### 5.3 Execution Time & Concurrency
- All admin actions process a single reservation (typical duration 2–6s, well under Apps Script's 6-minute limit).
- All mutating critical sections run inside `LockService.getScriptLock()` with a 30-second wait timeout.

### 5.4 Simple vs. Installable Triggers
- `onOpen(e)` is a simple trigger restricted strictly to creating the `STAYCATION MANAGEMENT` menu.
- `onFormSubmitTrigger(e)` and `onSpreadsheetEditTrigger(e)` are installed as **installable triggers** via `Setup.installTriggers()` so they run with full authorized service permissions.

## 6. Status State Machine

| State Dimension | Allowed Values | Transition Rules |
|---|---|---|
| `Approval Status` | `PENDING`, `APPROVED`, `REJECTED` | Starts `PENDING`. `PENDING` -> `APPROVED` or `REJECTED`. `APPROVED` -> `PENDING` if an endorsed field is edited. `REJECTED` is terminal for endorsement. |
| `Email Status` | `NOT_SENT`, `SENT`, `FAILED` | Starts `NOT_SENT`. Moves to `SENT` only after Gmail accepts the message (`SENT` is terminal/idempotent in MVP). Moves to `FAILED` if Gmail throws; manual admin retry allowed with explicit warning dialog (zero automatic retries). |
| PDF Lifecycle | None -> Generated -> Invalidated | Requires `APPROVED` + valid integrity hash. Editing endorsed fields clears `PDF File ID`, `PDF File URL`, and PDF hash. |
