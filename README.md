# Staycation Reservation & Endorsement Automation System

A production-ready, 100% Google Workspace-native MVP for collecting staycation guest reservations via a public **Google Form**, managing manual administrator review & approval in **Google Sheets**, generating personalized **PDF Reservation Endorsement Certificates** from a **Google Docs** template stored in a private **Google Drive** folder, and dispatching formatted HTML endorsement emails with PDF attachments via **Gmail** (`GmailApp`).

## Key Capabilities & Business Rules
- **Public Guest Registration**: Guests submit reservation details without needing a Google account or login; guests never receive access to internal sheets or Drive files.
- **Zero Auto-Emailing**:
  - Guest form submissions are saved as `PENDING` / `NOT_SENT` — **no email is sent automatically**.
  - Administrator approval updates `Approval Status` to `APPROVED` — **no email is sent automatically**.
  - Approval, PDF generation, and endorsement email sending are strictly separated administrator-triggered operations.
- **Data Integrity & Edit Invalidation**: Modifying any endorsed reservation detail (`Guest Name`, `Email Address`, `Contact Number`, `Check-in Date`, `Check-out Date`, `Number of Guests`, `Number of Rooms`) on an `APPROVED` row automatically revokes approval back to `PENDING` and invalidates any previously generated PDF (enforced by both an installable `onEdit` trigger and SHA-256 integrity hashing).
- **Concurrency & Duplicate Protection**: `LockService` guards sequential `STAY-YYYYMMDD-XXXX` reference generation, approval transitions, and idempotent email delivery (`SENT` rows cannot be emailed twice in MVP).
- **Private PDF Security**: Generated endorsement PDFs (`ENDORSEMENT_STAY-YYYYMMDD-XXXX_GUEST-NAME.pdf`) are stored strictly with `PRIVATE` Drive permissions and delivered to guests only as Gmail attachments.

## Project Structure

```text
hotel-reservation/
├── StaycationReservationSystem/        # clasp rootDir pushed to Google Apps Script
│   ├── appsscript.json                 # V8 runtime, Asia/Manila timezone, explicit OAuth scopes
│   ├── Code.gs                         # Menu, triggers, & dialog RPC router (thin entrypoint)
│   ├── Config.gs                       # Frozen schema constants, status enums, Settings accessors
│   ├── Setup.gs                        # One-run Workspace bootstrapper (sheets, Form, Docs template, folder, triggers)
│   ├── FormHandler.gs                  # Installable onFormSubmit validation & intake pipeline
│   ├── ReservationService.gs           # Immutable-ID CRUD & duplicate detection
│   ├── ApprovalService.gs              # Approve, Reject, & post-approval edit invalidation
│   ├── ValidationService.gs            # Server-side validation (never trusts client/sheet input)
│   ├── ReferenceGenerator.gs           # Locked STAY-YYYYMMDD-XXXX sequential generator
│   ├── DocumentService.gs              # Google Docs template copy, logo & placeholder engine
│   ├── PdfService.gs                   # PDF export, sanitized naming, private Drive storage
│   ├── EmailService.gs                 # Pre-send guards, HTML email renderer, idempotent Gmail send
│   ├── DashboardService.gs             # Live KPI metrics & Workspace health diagnostics
│   ├── ActivityLogService.gs           # Append-only administrator & system audit trail
│   ├── EmailLogService.gs              # Append-only email delivery ledger
│   ├── SecurityService.gs              # Fail-closed admin allowlist, Drive privacy, SHA-256 hashes
│   ├── Utils.gs                        # Pure date, hashing, sanitization, locking & escape helpers
│   └── dialogs/
│       ├── ReservationDetails.html     # Dashboard & selected reservation inspector modal
│       ├── ConfirmationDialog.html     # Approve / Reject / Send confirmation modal
│       ├── EmailPreview.html           # Sandboxed HTML email & PDF preview before sending
│       └── SettingsDialog.html         # Branding, resource IDs, admin allowlist & health check
├── docs/                               # Complete system, deployment, admin & QA documentation
├── tests/
│   ├── helpers/gasMockRuntime.js       # Faithful in-memory GAS V8 mock runtime
│   ├── unit/                           # Phase-by-phase unit test suites
│   └── integration/                    # End-to-end mocked tests + LiveSmokeTests.gs
├── .clasp.json.example                 # Template for local clasp binding
├── .claspignore
└── package.json                        # Dev-only scripts for local tests & clasp CLI
```

## Documentation Index
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md) — Logical architecture, data flows, state machine, and Apps Script limitations
- [Database Schema](docs/DATABASE_SCHEMA.md) — Complete column-by-column specification for all 4 sheets and metadata
- [Implementation Guide](docs/IMPLEMENTATION_GUIDE.md) — Module contracts, coding conventions, and local development workflow
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) — Step-by-step setup for both non-technical administrators and `clasp` developers
- [Administrator User Guide](docs/ADMIN_USER_GUIDE.md) — Daily staycation workflow manual for staff & owners
- [Testing Documentation](docs/TESTING_DOCUMENTATION.md) — Test matrix, automated test results, security audit, and live smoke testing
- [Troubleshooting Guide](docs/TROUBLESHOOTING.md) — Common errors, quota limits, permission issues, and recovery procedures

## Running Automated Local Tests
Node.js is used **only** as a local development/testing tool (zero Node backend is deployed):

```bash
npm test
```

> **Live Google Account Verification Notice**: Automated local tests verify all business logic, state transitions, validation rules, concurrency guards, and HTML/PDF flows against an in-memory Google Apps Script runtime mock. Before going live with guests, follow [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) and run a real end-to-end test using an authorized Google account and `tests/integration/LiveSmokeTests.gs`.
