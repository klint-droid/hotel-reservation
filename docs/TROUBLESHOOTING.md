# Troubleshooting Guide

Use this reference to quickly diagnose and resolve common operational or setup issues.

---

## 1. Custom Menu (`STAYCATION MANAGEMENT`) Does Not Appear
- **Cause**: The spreadsheet was just created or Apps Script permissions have not been granted yet.
- **Fix**:
  1. Reload the Google Sheet (`F5`) and wait 5–10 seconds for `onOpen` to complete.
  2. If it still does not appear, open **Extensions -> Apps Script**, confirm `Code.gs` is saved, and run `onOpen` or `runFullSetup` once to complete OAuth authorization.

## 2. "Access denied" / "Administrator identity could not be verified" (`ERR_UNAUTHORIZED`)
- **Cause 1**: The signed-in Google account email is not listed in `Settings -> ADMINISTRATOR_EMAIL`.
  - **Fix**: Have an authorized owner add the email (comma-separated) in the `Settings` sheet or via `System Settings`.
- **Cause 2**: You are running on a consumer `@gmail.com` account where Google hides `Session.getActiveUser().getEmail()`.
  - **Fix (Single-Owner Consumer Gmail)**: Open **Apps Script -> Project Settings -> Script Properties**, add `ALLOW_OWNER_EFFECTIVE_FALLBACK` = `true`, and ensure the script owner's email is in `Settings -> ADMINISTRATOR_EMAIL`.
  - **Fix (Multi-Admin Team)**: Migrate to a Google Workspace domain account where active user identity is reliably provided.

## 3. Guest Form Submissions Are Not Appearing in `Reservations`
- **Check 1 (Trigger Missing)**: Open `STAYCATION MANAGEMENT -> System Settings` and check **Installable Triggers** under Workspace Health. If it says `NEEDS SETUP`, open Apps Script (`Setup.gs`) and run **`installSystemTriggers`**.
- **Check 2 (Server-Side Validation Rejected Input)**: Open the **`Activity Logs`** sheet and look for `VALIDATION_FAILED` or `DUPLICATE_SUBMISSION_BLOCKED` entries explaining why the submission was rejected (e.g., Check-out Date earlier than Check-in Date, past Check-in Date, or exact duplicate booking).
- **Check 3 (Raw Backup)**: Unhide the hidden `Form Responses 1` sheet to verify whether Google Forms delivered the raw submission.

## 4. "Google Docs Endorsement Template could not be accessed" (`ERR_MISSING_TEMPLATE`)
- **Cause**: `DOCS_TEMPLATE_ID` in `Settings` is still a `[CONFIGURE: ...]` placeholder, points to a trashed Doc, or the executing admin does not have access to the template file.
- **Fix**: Verify the Doc exists in Google Drive, share it with all authorized administrators, and paste its exact ID (or URL) into `System Settings -> Google Docs Endorsement Template ID`.

## 5. "Unresolved placeholder(s) remained" / "Missing required placeholder(s)" (`ERR_UNRESOLVED_PLACEHOLDERS`)
- **Cause**: The Google Docs template was edited and either removed a required token (`{{GUEST_NAME}}`, `{{REFERENCE_NUMBER}}`, `{{CHECK_IN_DATE}}`, `{{CHECK_OUT_DATE}}`, `{{NUMBER_OF_GUESTS}}`) or contains an unrecognized `{{UNKNOWN_TAG}}` typo.
- **Fix**: Open the Master Google Docs Template and confirm every `{{PLACEHOLDER}}` matches the supported tokens listed in `Config.gs` (`PLACEHOLDERS`). Also make sure no token is split mid-word with mixed font formatting.

## 6. "Google Drive Output Folder could not be accessed" (`ERR_MISSING_FOLDER`)
- **Cause**: `DRIVE_OUTPUT_FOLDER_ID` is unconfigured, trashed, or not shared with the executing administrator.
- **Fix**: Verify the folder in Google Drive, confirm it is **Restricted (Private)** to authorized administrators, and save its ID in `System Settings`.

## 7. "Endorsed reservation details were modified after approval" (`ERR_INTEGRITY_MISMATCH`)
- **Cause**: Someone manually edited Guest Name, Email, Contact Number, Dates, Guests, or Rooms after the reservation was approved—or manually typed `APPROVED` into column `K` instead of using the menu.
- **Fix**: This is an intentional safety control. Review the updated row details, click **`Approve Reservation`**, click **`Generate Endorsement PDF`**, and then click **`Send Endorsement Email`**.

## 8. "Daily Gmail sending quota has been exceeded" (`ERR_QUOTA_EXCEEDED`)
- **Cause**: Consumer Gmail allows 100 recipients/day; Google Workspace allows 1,500 recipients/day.
- **Fix**: Wait for Google's rolling 24-hour quota reset (monitor quota on `STAYCATION MANAGEMENT -> Dashboard`), then manually click **`Send Endorsement Email`** to retry any `FAILED` bookings.

## 9. Email Sent From Personal Gmail Instead of Staycation Email Address
- **Cause**: Gmail only lets `GmailApp.sendEmail({ from })` send as an address that has been verified under **Gmail Settings -> Accounts and Import -> Send mail as**.
- **Behavior**: The system automatically sets `Name` to your Staycation Name and `Reply-To` to your Staycation Email Address so guest replies still go to the right inbox.
- **Fix (Optional)**: Verify your Staycation Email Address as a Gmail alias under **Send mail as**; the system will automatically detect it via `GmailApp.getAliases()` on the next send.

## 10. "The system is currently processing another operation" (`ERR_LOCK_TIMEOUT`)
- **Cause**: Two administrators clicked an action at the exact same moment or a long Drive operation held the script lock for more than 30 seconds.
- **Fix**: Wait 5–10 seconds and retry the action. No duplicate reference numbers or duplicate emails will have been created.
