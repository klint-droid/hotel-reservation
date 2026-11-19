# Implementation Guide

## 1. Technology Stack & Constraints
- **Runtime**: Google Apps Script V8 (`runtimeVersion: "V8"`, `timeZone: "Asia/Manila"`).
- **UI**: Native Google Sheets custom menu (`STAYCATION MANAGEMENT`) + `HtmlService` modal dialogs (`dialogs/*.html`).
- **Storage**: Private Google Spreadsheet (4 admin sheets + 1 hidden raw Form intake sheet) and Private Google Drive folder for PDFs.
- **Local Tooling**: Git + GitHub + `@google/clasp` for deployment; Node.js built-in `node:test` for offline automated unit/integration tests. No external backend server or database.

## 2. Coding Architecture & Patterns

### 2.1 Load-Order Independent IIFE Modules
Google Apps Script evaluates all `.gs` files in a shared global scope, and file evaluation order is not guaranteed when files are copied manually or pushed via `clasp`. Every service module therefore follows the **Revealing Module (IIFE)** pattern:

```javascript
var ExampleService = (function () {
  function doWork() {
    // Only reference other modules (Config, Utils, etc.) INSIDE functions,
    // never during top-level IIFE initialization!
  }
  return Object.freeze({ doWork: doWork });
})();
```

- Top-level `function` declarations exist ONLY in `Code.gs` (menus, installable triggers, `google.script.run` server RPC handlers) and `Setup.gs` (`runFullSetup`, `initializeSpreadsheet`, `installSystemTriggers`).
- Cross-module tests verify full functionality even under **reversed file load order**.

### 2.2 Thin `Code.gs` Entrypoint & JSON-Safe RPC Boundary
`google.script.run` cannot serialize native `Date` instances across the Apps Script client-server boundary and can only call top-level `function` names.
- All `api*` functions in `Code.gs` delegate immediately to service modules, wrap exceptions using `Utils.errorToResult()`, and return `{ ok, code, message, data, errors }` containing formatted date strings (never raw `Date` objects).
- Dialog HTML templates receive initial data serialized with `Utils.toSafeScriptJson()` (escaping `<`, `>`, `&`, `\u2028`, `\u2029`) and render all untrusted guest fields via `textContent` (never unescaped `innerHTML`).

### 2.3 Immutable Primary Keys & Column Mapping
- All row reads/writes go through `ReservationService` using `Config.RESERVATION_COLS`.
- Every operation resolves the current row dynamically by `Reservation ID` (`RES-<uuid>`) so sorting, filtering, or inserting rows never corrupts records.

### 2.4 Data Integrity & Concurrency Pattern
1. Mutating operations (`FormHandler.handleFormSubmit`, `ApprovalService.approveReservation`, `ApprovalService.rejectReservation`, `PdfService.generateEndorsementPdf`, `EmailService.sendEndorsementEmail`) execute inside `Utils.withScriptLock()` (`LockService.getScriptLock()`, 30s wait).
2. `ReferenceGenerator.generateNextInLock()` reads both `ScriptProperties` (`REF_SEQ_YYYYMMDD`) and the maximum daily sequence present in `Reservations`, ensuring uniqueness even if properties are cleared.
3. Upon approval, `SecurityService.recordApprovalHash()` saves a SHA-256 digest of the 7 endorsed fields (`Guest Name`, `Email Address`, `Contact Number`, `Check-in Date`, `Check-out Date`, `Number of Guests`, `Number of Rooms`). Upon PDF generation, `SecurityService.recordPdfHash()` records the matching hash. Both `PdfService` and `EmailService` re-verify these hashes before acting.

## 3. Extending or Customizing the System
- **Customizing the Endorsement Certificate Design**: Open the Google Docs template created by `runFullSetup()` (link stored in `Settings -> DOCS_TEMPLATE_ID`), adjust layout/fonts/borders/logo as desired, and keep the required `{{PLACEHOLDER}}` tokens intact.
- **Adding Additional Authorized Administrators**: Add comma-separated Google account emails to `ADMINISTRATOR_EMAIL` via `STAYCATION MANAGEMENT -> System Settings`, and share both the Google Spreadsheet and private PDF Drive folder with those administrators.
- **Local Development Commands**:
  ```bash
  # Run all automated unit and end-to-end integration tests
  npm test

  # Authenticate clasp (first time only)
  npm run clasp:login

  # Copy .clasp.json.example to .clasp.json with your bound Script ID, then push
  npm run clasp:push
  ```
