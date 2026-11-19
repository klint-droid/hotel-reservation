# Database Schema — Google Sheets Data Model

The system uses a single private Google Spreadsheet containing **4 administrator sheets** plus **1 hidden raw intake sheet** linked to the public Google Form.

> **Primary Key Rule**: Every record across `Reservations`, `Email Logs`, and `Activity Logs` uses an immutable UUID primary key (`RES-<uuid>`, `ELOG-<uuid>`, `ACT-<uuid>`). Spreadsheet row numbers are **never** stored or relied upon as permanent identifiers.

---

## Sheet 1: `Reservations` (Columns `A`–`T`)

- **Frozen Rows**: Row 1 (headers)
- **Filter**: Enabled across `A1:T`
- **Row 1 Styling**: Dark Green background (`#1B4332`), bold White text (`#FFFFFF`)

| Col | Index | Header | Type / Format | Protected | Endorsed Field | Validation & Notes |
|---|---|---|---|---|---|---|
| `A` | 1 | `Reservation ID` | Text (`@`) | Yes | No | Immutable UUID (`RES-<uuid>`) |
| `B` | 2 | `Reference Number` | Text (`@`) | Yes | No | Unique `STAY-YYYYMMDD-XXXX` generated under `LockService` |
| `C` | 3 | `Guest Name` | Text | No | **Yes** | Required, 2–120 chars, formula-sanitized |
| `D` | 4 | `Email Address` | Text | No | **Yes** | Required, trimmed lowercase, valid email format |
| `E` | 5 | `Contact Number` | **Plain Text (`@`)** | No | **Yes** | Required, valid phone format; plain text preserves leading `0` / `+` |
| `F` | 6 | `Check-in Date` | Plain Text (`@`, canonical `yyyy-mm-dd`) | No | **Yes** | Required; cannot be in the past at submission (`Asia/Manila`); plain text prevents timezone drift |
| `G` | 7 | `Check-out Date` | Plain Text (`@`, canonical `yyyy-mm-dd`) | No | **Yes** | Required; must be strictly later than `Check-in Date`; plain text prevents timezone drift |
| `H` | 8 | `Number of Guests` | Integer (`0`) | No | **Yes** | Required; integer `>= 1` |
| `I` | 9 | `Number of Rooms` | Text (`@`) | No | **Yes** | Optional dropdown (`1`, `2`, `3`, `4`, `5+`, `Not Applicable`) |
| `J` | 10 | `Special Requests` | Wrapped Text | No | No | Optional; max 1,000 chars, formula-sanitized |
| `K` | 11 | `Approval Status` | Dropdown | Yes | No | Enum: `PENDING` (Yellow), `APPROVED` (Green), `REJECTED` (Red) |
| `L` | 12 | `Admin Remarks` | Wrapped Text | No | No | Internal notes, rejection reason, or duplicate warning flags |
| `M` | 13 | `Email Status` | Dropdown | Yes | No | Enum: `NOT_SENT` (Gray), `SENT` (Green), `FAILED` (Red) |
| `N` | 14 | `Submitted At` | Timestamp (`yyyy-mm-dd hh:mm:ss`) | Yes | No | Recorded in configured timezone (`Asia/Manila`) |
| `O` | 15 | `Approved At` | Timestamp (`yyyy-mm-dd hh:mm:ss`) | Yes | No | Populated on Approve; cleared on revocation |
| `P` | 16 | `Approved By` | Text | Yes | No | Executing administrator email; cleared on revocation |
| `Q` | 17 | `PDF File ID` | Text (`@`) | Yes | No | Google Drive File ID; cleared on invalidation |
| `R` | 18 | `PDF File URL` | URL | Yes | No | Private Google Drive URL; cleared on invalidation |
| `S` | 19 | `Email Sent At` | Timestamp (`yyyy-mm-dd hh:mm:ss`) | Yes | No | Populated ONLY after Gmail accepts delivery |
| `T` | 20 | `Last Error` | Wrapped Text | Yes | No | Latest PDF/email error; cleared upon subsequent success |

### Conditional Formatting Rules (`Reservations`)
| Column | Value | Background | Text Color |
|---|---|---|---|
| `K` (`Approval Status`) | `PENDING` | `#FFF3CD` | `#856404` |
| `K` (`Approval Status`) | `APPROVED` | `#D4EDDA` | `#155724` |
| `K` (`Approval Status`) | `REJECTED` | `#F8D7DA` | `#721C24` |
| `M` (`Email Status`) | `NOT_SENT` | `#E2E3E5` | `#383D41` |
| `M` (`Email Status`) | `SENT` | `#D4EDDA` | `#155724` |
| `M` (`Email Status`) | `FAILED` | `#F8D7DA` | `#721C24` |

---

## Sheet 2: `Email Logs` (Columns `A`–`J`)
Append-only audit ledger of every endorsement email attempt. Frozen Row 1, Auto-Filter enabled, Sheet-level protection.

| Col | Header | Type / Notes |
|---|---|---|
| `A` | `Log ID` | `ELOG-<uuid>` |
| `B` | `Reservation ID` | Foreign key to `Reservations.Reservation ID` |
| `C` | `Reference Number` | `STAY-YYYYMMDD-XXXX` |
| `D` | `Recipient Email` | Normalized guest email |
| `E` | `Email Subject` | Resolved subject line |
| `F` | `Email Status` | `SENT` (Green) or `FAILED` (Red) |
| `G` | `Date Attempted` | `yyyy-mm-dd hh:mm:ss` (`Asia/Manila`) |
| `H` | `Date Sent` | `yyyy-mm-dd hh:mm:ss` (blank if `FAILED`) |
| `I` | `Error Message` | Sanitized error details (blank if `SENT`) |
| `J` | `Administrator` | Executing administrator email |

---

## Sheet 3: `Settings` (Columns `A`–`D`)
Key-value configuration table. All values remain configurable—no hardcoded branding, template IDs, or folder IDs.

| Col | Header | Notes |
|---|---|---|
| `A` | `Setting Key` | Protected system key |
| `B` | `Setting Value` | Plain text (`@`), editable by administrators via sheet or `System Settings` dialog |
| `C` | `Description` | Human-readable explanation for non-technical admins |
| `D` | `Required` | `YES` or `NO` |

### Supported Keys
1. `STAYCATION_NAME`
2. `STAYCATION_LOGO_URL`
3. `STAYCATION_CONTACT_NUMBER`
4. `STAYCATION_EMAIL_ADDRESS`
5. `STAYCATION_FACEBOOK_PAGE`
6. `CHECK_IN_TIME` (default `2:00 PM`)
7. `CHECK_OUT_TIME` (default `12:00 PM`)
8. `DOCS_TEMPLATE_ID`
9. `DRIVE_OUTPUT_FOLDER_ID`
10. `ADMINISTRATOR_EMAIL` (supports comma-separated authorized admin list)
11. `TIMEZONE` (default `Asia/Manila`)

---

## Sheet 4: `Activity Logs` (Columns `A`–`I`)
Append-only audit log of administrative actions, system events, validation rejections, duplicate detections, and unauthorized access attempts. Frozen Row 1, Auto-Filter enabled, Sheet-level protection.

| Col | Header | Type / Notes |
|---|---|---|
| `A` | `Activity ID` | `ACT-<uuid>` |
| `B` | `Reservation ID` | `RES-<uuid>` or `SYSTEM` |
| `C` | `Reference Number` | `STAY-YYYYMMDD-XXXX` or `N/A` |
| `D` | `Administrator` | Executing admin email or `SYSTEM/FORM_SUBMIT` |
| `E` | `Action` | Standardized enum (`RESERVATION_CREATED`, `RESERVATION_APPROVED`, `RESERVATION_REJECTED`, `APPROVAL_REVOKED`, `PDF_GENERATED`, `PDF_INVALIDATED`, `PDF_GENERATION_FAILED`, `ENDORSEMENT_EMAIL_SENT`, `ENDORSEMENT_EMAIL_FAILED`, `DUPLICATE_SUBMISSION_BLOCKED`, `DUPLICATE_SUBMISSION_FLAGGED`, `VALIDATION_FAILED`, `SETTINGS_UPDATED`, `UNAUTHORIZED_ACCESS`, `SYSTEM_SETUP`) |
| `F` | `Previous Value` | Previous state or value |
| `G` | `New Value` | New state or value |
| `H` | `Timestamp` | `yyyy-mm-dd hh:mm:ss` (`Asia/Manila`) |
| `I` | `Remarks` | Context, rejection reason, or sanitized error |

---

## Supporting Hidden Sheets
1. **`Form Responses 1` (Hidden & Hard-Protected)**: Created automatically when the public Google Form is linked to the Spreadsheet. Kept hidden and protected as an immutable raw submission audit buffer while `FormHandler.gs` validates and writes clean records to `Reservations`.
2. **`_SystemIntegrity` (Hidden & Hard-Protected)**: Internal system security table (`Reservation ID`, `Approval Hash`, `PDF Hash`, `Bound PDF File ID`, `Sent Locked`, `Sent Log ID`, `Updated At`). Scales to tens of thousands of reservations without exhausting Apps Script's 500 KB `ScriptProperties` quota, binds each reservation to its exact generated PDF File ID, and prevents manual `Email Status` tampering from bypassing duplicate-send protection.

---

## ScriptProperties & ScriptCache Metadata (Internal, Non-Schema State)
- **`ScriptProperties`**:
  - `AUTHORIZED_ADMINS_CSV`: Sole authoritative administrator email allowlist (bootstrapped from `Settings` on initial setup; updated via authorized `System Settings` saves).
  - `REF_SEQ_YYYYMMDD`: Daily sequence counter for `STAY-YYYYMMDD-XXXX` (self-healed against `Reservations` sheet and auto-pruned after 7 days).
  - `LINKED_FORM_ID`: ID of the linked Google Form created/configured by `Setup.gs`.
  - `ALLOW_OWNER_EFFECTIVE_FALLBACK`: Optional `"true"` opt-in strictly for single-owner consumer `@gmail.com` accounts.
- **`CacheService` (`ScriptCache`, 6-hour TTL)**:
  - `FORM_RESP_<FormResponseID>`: Expiring trigger replay guard preventing duplicate processing of identical form submission events without consuming permanent `ScriptProperties` quota.
