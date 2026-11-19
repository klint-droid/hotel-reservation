# Deployment Guide (Non-Technical & Developer Setup)

This guide walks you step by step through deploying the **Staycation Reservation & Endorsement Automation System** in your own Google account. **No coding experience is required** if you follow Option A (Apps Script Editor), or developers can use Option B (`clasp` CLI).

---

## Prerequisites Checklist
1. **Google Account** — A **Google Workspace** account (recommended: 1,500 emails/day and multi-admin identity support) or a dedicated **Gmail** account (100 emails/day; see Section 6 for single-owner note).
2. **Staycation Information Ready**:
   - Staycation Property Name
   - Official Contact Number & Email Address
   - Official Facebook Page link/handle (optional)
   - Staycation Logo image uploaded to Google Drive or a direct HTTPS image link (optional)
   - Standard Check-in and Check-out times (defaults: `2:00 PM` / `12:00 PM`)

---

## Step 1: Create the Private Admin Google Spreadsheet
1. Open [Google Sheets](https://sheets.google.com) signed into your **primary administrator Google account**.
2. Click **Blank spreadsheet** and name it: `Staycation Reservation Management`.
3. Keep the spreadsheet **Private** (Restricted). Share it **only** with authorized administrators as Editors — **never** share it with guests or "Anyone with the link".

---

## Step 2: Install the Apps Script Code

### Option A: Using `clasp` CLI (Recommended for Developers / GitHub Sync)
1. Enable the Google Apps Script API at https://script.google.com/home/usersettings.
2. In your new Google Sheet, click **Extensions -> Apps Script**.
3. Click the **Project Settings** gear icon on the left sidebar and copy the **Script ID**.
4. In your local repo (`c:\System\hotel-reservation`), copy `.clasp.json.example` to `.clasp.json` and paste your Script ID:
   ```json
   {
     "scriptId": "PASTE_YOUR_SCRIPT_ID_HERE",
     "rootDir": "./StaycationReservationSystem"
   }
   ```
5. Log in and push the project:
   ```bash
   npm run clasp:login
   npm run clasp:push
   ```
   Confirm overwriting `appsscript.json` when prompted.

### Option B: Manual Copy-Paste in Apps Script Editor (No CLI Required)
1. In your new Google Sheet, click **Extensions -> Apps Script**.
2. Click **Project Settings** (gear icon) and check **Show "appsscript.json" manifest file in editor**.
3. Replace `appsscript.json` with the contents of `StaycationReservationSystem/appsscript.json`.
4. Replace `Code.gs` with `StaycationReservationSystem/Code.gs`.
5. Click **+** next to **Files -> Script** to create each remaining `.gs` file (`Config`, `Setup`, `Utils`, `SecurityService`, `ValidationService`, `ReferenceGenerator`, `ReservationService`, `FormHandler`, `ApprovalService`, `DocumentService`, `PdfService`, `EmailService`, `DashboardService`, `ActivityLogService`, `EmailLogService`) and paste its contents.
6. Click **+** next to **Files -> HTML** to create the 4 dialog files (`ReservationDetails`, `ConfirmationDialog`, `EmailPreview`, `SettingsDialog`) and paste the contents from `StaycationReservationSystem/dialogs/*.html`. *(The system automatically supports both `dialogs/Name` and flat `Name` HTML filenames.)*
7. Click **Save** (`Ctrl+S`).

---

## Step 3: Run Automatic Workspace Setup (`runFullSetup`)
1. In the Apps Script Editor, open `Setup.gs`.
2. In the top toolbar dropdown (next to **Debug**), select **`runFullSetup`**.
3. Click **Run**.
4. Google will prompt **Authorization required**:
   - Click **Review Permissions** -> choose your primary administrator Google account.
   - If using an unverified personal project, click **Advanced -> Go to Staycation Reservation Management (unsafe)** -> **Allow**.
5. Wait ~10–15 seconds for execution to complete. Open **Execution Log** to view the created resource URLs:
   - **4 Formatted Sheets**: `Reservations`, `Email Logs`, `Settings`, `Activity Logs` (plus hidden raw backup sheet `Form Responses 1`)
   - **Private Google Drive Folder**: `Staycation Endorsement PDFs` (ID saved to `Settings`)
   - **Master Google Docs Template**: `Staycation Reservation Endorsement Template` (ID saved to `Settings`)
   - **Public Google Form**: `Staycation Reservation Registration` (already linked to your spreadsheet!)
   - **Installable Triggers**: `onFormSubmitTrigger` and `onSpreadsheetEditTrigger`

---

## Step 4: Configure Branding, Logo & Administrators
1. Reload your Google Sheet (`F5`). A new menu **`STAYCATION MANAGEMENT`** appears at the top.
2. Click **`STAYCATION MANAGEMENT -> System Settings`**.
3. Fill in your staycation's actual details:
   - **Staycation Name** (e.g., *Villa Verde Staycation*)
   - **Staycation Contact Number**
   - **Staycation Email Address**
   - **Staycation Facebook Page** (optional)
   - **Staycation Logo URL / Drive File ID** (optional: paste the Google Drive link/ID of your PNG/JPG logo)
   - **Check-in Time** / **Check-out Time**
   - **Authorized Administrator Email(s)** (comma-separated list of all staff Google accounts allowed to approve/send)
   - **Timezone**: `Asia/Manila` (default)
4. Click **SAVE SETTINGS** and verify all **Workspace Health Diagnostics** show **OK**.

---

## Step 5: Customize the Endorsement Certificate & Share the Public Form
1. **Customize Certificate (Optional)**: Open the Google Docs Template ID listed in the `Settings` sheet. You may refine colors, fonts, or reminder wording—just keep all `{{PLACEHOLDER}}` tags intact!
2. **Verify Public Form Settings**:
   - Open the created Google Form's edit link (shown in Execution Log or accessible via Google Drive).
   - Confirm under **Settings -> Responses** that **Limit to 1 response** is **OFF** and **Restrict to users in your organization** is **OFF**, so public guests can submit without signing in.
   - Click **Send -> Link** to copy the public registration link for your Facebook page, website, or booking chats.
3. **Verify Drive Folder Privacy**:
   - Confirm the `Staycation Endorsement PDFs` folder in Google Drive is set to **Restricted** (shared only with authorized administrators).

---

## Step 6: Important Note for Consumer `@gmail.com` Accounts
On **Google Workspace** (custom domain) accounts, Google Apps Script reliably identifies every same-domain administrator via `Session.getActiveUser().getEmail()`.

On **free consumer `@gmail.com`** accounts, Google restricts `Session.getActiveUser().getEmail()` in certain contexts:
- **Single-owner consumer Gmail**: If you are the sole administrator running the sheet under your own `@gmail.com` account and encounter an identity verification error, open **Apps Script -> Project Settings -> Script Properties**, click **Add script property**, and set:
  - Property: `ALLOW_OWNER_EFFECTIVE_FALLBACK`
  - Value: `true`
- **Multi-admin teams**: Upgrade to Google Workspace so each individual administrator's email is accurately verified and logged in `Activity Logs` and `Email Logs`.

---

## Step 7: Live End-to-End Verification Before Going Live
Before publishing the form link to real guests, run a complete live test using your own test email address:
1. Open the public Google Form in an Incognito browser window and submit a test reservation (future dates).
2. Confirm a new row appears in `Reservations` with `Approval Status = PENDING`, `Email Status = NOT_SENT`, and a `STAY-YYYYMMDD-0001` reference. **Verify NO email arrived.**
3. Select the row -> `STAYCATION MANAGEMENT -> Approve Reservation` -> confirm. **Verify NO email arrived.**
4. Select the row -> `STAYCATION MANAGEMENT -> Generate Endorsement PDF`. Open the generated Drive link to inspect the formatted PDF.
5. Select the row -> `STAYCATION MANAGEMENT -> Send Endorsement Email` -> review the preview -> click **SEND EMAIL**.
6. Verify your test inbox receives the HTML email with the attached `ENDORSEMENT_STAY-....pdf`, `Email Status` becomes `SENT`, and `Email Logs` + `Activity Logs` record the transaction.
7. Click `Send Endorsement Email` a second time on the same row and confirm duplicate sending is **blocked**.
