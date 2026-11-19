# Administrator User Guide

Welcome! This guide explains how staycation staff and administrators process guest reservations every day inside Google Sheets—**no technical knowledge or manual document editing required**.

---

## Daily Reservation Workflow (5 Simple Steps)

### Step 1: Review New Submissions
1. Open the **Staycation Reservation Management** spreadsheet and go to the **`Reservations`** tab.
2. New guest requests submitted from the public Google Form automatically appear at the bottom with:
   - A unique Reference Number (`STAY-YYYYMMDD-XXXX`)
   - **`Approval Status` = `PENDING`** (highlighted Yellow)
   - **`Email Status` = `NOT_SENT`** (highlighted Gray)
3. Click any cell in a guest's row and select **`STAYCATION MANAGEMENT -> View Selected Reservation`** to inspect all guest details, check-in/out dates, special requests, and remarks clearly.
   - *Tip*: Watch for `[FLAG: Potential duplicate of ...]` in `Admin Remarks` when the same email has overlapping booking dates.

### Step 2: Approve or Reject the Reservation
> **Reminder**: Approving or rejecting a reservation **never** automatically emails the guest.

- **To Approve**:
  1. Click the guest's row in `Reservations`.
  2. Select **`STAYCATION MANAGEMENT -> Approve Reservation`**.
  3. Review the guest summary, add optional internal notes (e.g., *"Downpayment verified via GCash"*), and click **`APPROVE RESERVATION`**.
  4. `Approval Status` updates to **`APPROVED`** (Green) with your email and timestamp.
- **To Reject**:
  1. Click the guest's row in `Reservations`.
  2. Select **`STAYCATION MANAGEMENT -> Reject Reservation`**.
  3. Enter a required **Rejection Reason** (e.g., *"Requested dates fully booked"*) and click **`REJECT RESERVATION`**.
  4. `Approval Status` updates to **`REJECTED`** (Red). Rejected reservations cannot generate endorsement PDFs or be emailed.

### Step 3: Generate & Preview the Endorsement PDF
1. Click an **`APPROVED`** reservation row.
2. Select **`STAYCATION MANAGEMENT -> Generate Endorsement PDF`**.
3. Wait a few seconds. The system automatically fills your hotel-styled certificate template, exports a private PDF named `ENDORSEMENT_STAY-YYYYMMDD-XXXX_GUEST-NAME.pdf`, and saves its link in columns `Q` and `R`.
4. Click the link in `PDF File URL` (or open **`View Selected Reservation`**) to preview the certificate and verify all details look right.

### Step 4: Manually Send the Endorsement Email
1. Click the **`APPROVED`** row (with a generated PDF).
2. Select **`STAYCATION MANAGEMENT -> Send Endorsement Email`**.
3. The **Send Reservation Endorsement?** preview dialog opens showing:
   - Guest Name, Recipient Email, and Reference Number
   - Exact email subject and attached PDF filename (with a Preview PDF link)
   - Live visual preview of the email the guest will receive
4. Click **`SEND EMAIL`** (or **`CANCEL`** to abort).
5. Once delivered:
   - `Email Status` updates to **`SENT`** (Green) and `Email Sent At` is recorded.
   - A permanent record is added to **`Email Logs`** and **`Activity Logs`**.
   - Duplicate sending is automatically blocked—clicking `Send Endorsement Email` again on a `SENT` row will safely stop you.

### Step 5: Monitor Statuses & Logs
- **`STAYCATION MANAGEMENT -> Dashboard`**: View real-time counts of Pending, Approved, Rejected, PDFs Ready, Emails Sent/Failed, remaining daily Gmail quota, and Workspace health checks.
- **`STAYCATION MANAGEMENT -> View Email Logs`**: Jump straight to the full email delivery ledger (`Email Logs`).
- **`STAYCATION MANAGEMENT -> Refresh Dashboard`**: Re-apply clean column formatting, filters, and dropdown rules without touching your data.
- **`STAYCATION MANAGEMENT -> System Settings`**: Update staycation contact info, logo, check-in/out times, template/folder IDs, or authorized admin emails.

---

## Important Rules to Remember
1. **What happens if you edit guest details after approving?**
   If you change a guest's Name, Email, Contact Number, Check-in/Check-out Dates, Guest Count, or Rooms on an already **`APPROVED`** row, the system automatically **revokes approval back to `PENDING`** and **invalidates the old PDF** so you never accidentally email an outdated certificate. Simply re-approve and generate a fresh PDF.
2. **Do not manually type `APPROVED` or `SENT` into the status columns.**
   Always use the **`STAYCATION MANAGEMENT`** menu so audit timestamps, security hashes, and logs stay intact. Manually typing `APPROVED` will be rejected by PDF generation and email sending.
3. **If an email fails (`FAILED` in Red)**:
   Check the **`Last Error`** column (Column `T`) or **`Email Logs`** to see why (e.g., typo in guest email or daily Gmail limit reached). If the email address had a typo, fix the email cell (which resets approval), re-approve, regenerate the PDF, and send. If it was a temporary Gmail error, click **`Send Endorsement Email`** again—you will see a manual retry warning and can re-send safely.
