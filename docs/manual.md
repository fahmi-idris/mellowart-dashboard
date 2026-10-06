# Mellow Art Dashboard — User Manual

A plain-language guide for running the Mellow Art platform: reviewing artist
submissions, approving/rejecting them, sending invoices through Xero, and
emailing applicants. No technical knowledge required.

- **Dashboard URL:** https://mellow-cf.mellowartmarket.workers.dev
- **Who this is for:** the admin(s) who review submissions and manage invoices.

---

## 1. What the platform does

Artists submit their application through your public form (brand details, bio,
categories, stall preferences, insurance answer, a portfolio document, and an
optional insurance certificate). On submit they automatically get a
**confirmation email**, and the application lands in this dashboard as
**Pending**. You review it and set a decision:

- **Accepted** → you then **assign a stall** (which sets the price) and click
  **Send invoice**: the system creates an invoice in **Xero** and emails the
  artist a link to view and pay it.
- **Waitlisted** → kept on hold; no email is sent.
- **Rejected** → the system emails the artist with the reason you wrote.

You can also track whether an invoice has been **paid** and adjust invoice
defaults (currency, account code, due date, tax).

The flow at a glance:

```
Artist submits → confirmation email → Pending → Accepted → assign stall → Send invoice → Xero invoice + email → track payment
                                              → Waitlisted (on hold)
                                              → Rejected → rejection email sent
```

> The **stall sets the price.** Each event defines its own stall options (e.g.
> Mini / Standard / Flagship), each with its own price. The assigned stall's
> price is what Xero charges — there is no single global table fee. The artist
> picks a **first and second stall preference** on the form (shown on their
> profile to guide you), but you assign the actual billed stall here.

---

## 2. Logging in

1. Go to the dashboard URL and you'll be sent to the **login** page.
2. Enter your admin **email** and **password**.
3. You land on the **Dashboard** (summary cards).

> Forgot your password or need another admin account? That's done by the
> developer (admin accounts are created directly in the database). Ask them to
> reset it or add a new admin.

Use **Logout** (in the sidebar) when you're done, especially on a shared
computer.

---

## 3. The Dashboard (home)

After login you see summary cards:

| Card                | Meaning                                     |
| ------------------- | ------------------------------------------- |
| **Total inquiries** | All submissions ever received.              |
| **Pending review**  | Waiting for your decision.                  |
| **Accepted**        | Accepted applicants.                        |
| **Waitlisted**      | Applicants kept on hold.                    |
| **Rejected**        | Declined applicants.                        |
| **Withdrawn**       | Applicants whose application was withdrawn. |

Use the sidebar to move between **Dashboard**, **Inquiries**, **Events**, and
**Invoice settings**.

---

## 4. Reviewing submissions (Inquiries)

Open **Inquiries** to see the full list (sortable, filterable, paginated).

### Columns

Each row has two **independent** status controls, plus the stall and invoice:

**Application status** (a dropdown you can change at any time):

| Status         | What it means                                             |
| -------------- | --------------------------------------------------------- |
| **Pending**    | New — needs your decision.                                |
| **Accepted**   | You accepted it. Unlocks the stall picker.                |
| **Waitlisted** | On hold; email can be sent separately.                    |
| **Rejected**   | Declined; email can be sent separately.                   |
| **Withdrawn**  | Removed from consideration; email can be sent separately. |

**Payment status** (separate from the decision above):

| Status               | What it means                     |
| -------------------- | --------------------------------- |
| **Not sent**         | No invoice created yet.           |
| **Invoicing**        | Invoice is being created in Xero. |
| **Awaiting payment** | Invoice sent, not yet paid.       |
| **Paid**             | Invoice paid.                     |
| **Overdue**          | Invoice past its due date.        |
| **Voided**           | Invoice cancelled.                |

Other columns: **Stall assigned** (dropdown, only active once Accepted),
**Invoice** (the _Send invoice_ button / link), and a **Notes** icon (see
below). You can **filter by Application status, Payment status, or Event** and
search by name/email to focus your work. **Advanced search** also offers reference,
categories, Instagram, website, internal notes, prior applications, and second
artist fields. Use **Columns** to show or hide optional table fields.

**Copy emails** copies addresses matching the current filters. **Export CSV**
downloads the filtered records. **Backup data** downloads a ZIP with CSV, HTML,
and uploaded documents for a chosen event or all events, including archived
submissions. The current event is preselected for the single-event option.

### Viewing details

Click a row's actions and choose **View profile** to see the full application —
brand, website, Instagram, categories, bio, product description, stall
preferences, the sharing/insurance answers, and links to their uploaded
**portfolio document** (and **insurance certificate**, if provided). Documents
are private; only logged-in admins can open them.

### Accepting and invoicing

This is a few steps, because the **stall** (and therefore the price) is chosen
before the invoice:

1. Set the row's **Application status** to **Accepted**.
2. In the **Stall assigned** column, pick a stall. The options are this event's
   configured stalls, each with its price. (The artist's first/second stall
   **preferences** are on their profile to guide you — but you choose the actual
   billed stall here.)
3. Click **Send invoice** in the **Invoice** column. The system:
   - Creates an **invoice in Xero** for the **stall's price**, using your other
     Invoice settings (currency, account code, tax, due date).
   - **Emails the artist** an approval message with a "View & pay invoice" link.
4. Payment status moves to **Awaiting payment**.

> **Send invoice** only appears once a row is **Accepted with a stall assigned**.
> If an event has no stalls yet, the stall column links you to **Events** to add
> them.

**Requirements for invoicing to fully work:**

- **Xero must be connected** (otherwise the invoice can't be created).
- **Gmail must be connected** for the email to send. If Gmail is disconnected,
  the invoice still happens — only the email is skipped.

### Waitlisting / Rejecting / Withdrawing

- Set **Application status** to **Waitlisted** or **Rejected** to record the
  decision. You can optionally include a reason.
- Set it to **Withdrawn** when the applicant withdraws.
- The **Email** button beside these statuses opens a confirmation before sending
  the matching editable template. A status change alone never sends that email.

> You can change the Application status at any time via the dropdown. Re-setting
> a row to **Rejected** does not re-send the rejection email.

### Bulk actions and deletion

Select rows using the checkboxes in the table. You can apply one application
status to the selected rows; review the confirmation dialog before applying it.
Bulk status changes do not send emails. **Delete** permanently removes the
selected submissions, their local invoice records, activity, notes, and uploaded
files after confirmation. Invoices already issued in Xero remain in Xero. Back
up the data before deleting if you may need it later.

### Internal notes

Each row has a **sticky-note icon** (between Payment and the actions menu). Click
it to add or edit **private staff notes** about an applicant — reminders,
follow-ups, anything internal. The icon is filled when notes exist. These notes
are **never shown to the applicant** and are separate from the "additional
notes" the artist may have written on the form (which appear in their profile).

### Tracking payment

The system doesn't automatically know when an invoice is paid in Xero, so you
reconcile it by hand:

1. Check the invoice status in your **Xero** account.
2. Back in the dashboard, open the row's actions → **Payment**, and set the
   matching status: **Awaiting payment**, **Paid**, **Overdue**, or **Voided**.

This keeps the dashboard badge in sync with reality.

### Submission rows and backups

Click any non-interactive cell in an artist submission row to open its profile;
focused rows also open with Enter or Space. Checkboxes, links, status selectors
and action buttons keep their own behavior.

**Backup data** offers **One event** or **All events**. Single-event ZIPs contain
only that event's submissions and documents. All-event ZIPs contain all submissions
and documents, including unassigned records. Both include archived submissions.
Search, status filters and pagination are ignored so the event backup is complete.
The dialog shows the event's submission count. The event slug appears in the ZIP
filename; all-event backups use `all-events` in the filename. The API requires
`format=backup&filter.event_id=EVENT_ID` for one event and rejects missing/unknown
events. Use `format=backup&scope=all` explicitly for all events.

### Email branding

Brand colors accept #RGB or #RRGGBB; invalid colors cannot be published. Hero,
pill, solid-button, header and footer text contrast adjusts to their background.
Brand changes remain event-scoped and are saved with **Publish changes**.
The footer contact email is rendered as a clickable `mailto:` link.

---

## 5. Invoice settings

Open **Invoice settings** in the sidebar. This page has three sections.

### Xero connection

Invoices can only be created while Xero is **Connected**.

- **Connect Xero** → opens Xero's consent screen → returns here showing
  "Connected · <your organisation>".
- **Reconnect** → re-authorize (e.g. after the connection expires).
- **Disconnect** → stops invoice creation until reconnected.

> The connection refreshes itself automatically while in use. If it sits unused
> for ~60 days it expires and you'll need to **Reconnect**.

### Email (Gmail)

Sends approval and rejection emails from your Google Workspace mailbox.

- **Connect Gmail** → opens Google's consent screen → returns showing
  "Connected · <mailbox>". That mailbox becomes the **From** address on all
  emails.
- **Reconnect** / **Disconnect** as needed.

> Approvals and rejections still work while Gmail is disconnected — the emails
> are simply not sent.

### Line item & tax

These defaults are applied to the single fee line on every generated invoice.
Note there is **no price field here** — the price comes from the **stall**
assigned to each applicant (configured per event under **Events**).

| Field                 | What it is                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Item description**  | Text shown on the invoice line (e.g. "Full table fee"). The assigned stall's tier name is appended automatically. |
| **Currency**          | 3-letter code, e.g. `AUD`, `USD`. Used only as a fallback if a stall has no currency.                             |
| **Account code**      | Your Xero account/ledger code the income posts to.                                                                |
| **Due in (days)**     | How many days from issue until the invoice is due.                                                                |
| **Line amount types** | Whether the stall price is tax-inclusive, exclusive, or no-tax (matches Xero's options).                          |
| **Tax type**          | Xero tax code, chosen from a dropdown: **GST on Income (10%)**, **GST Free Income**, or **No GST**.               |

Click **Save settings**. Changes apply to **future** invoices only — already-
created invoices are not changed.

---

## 6. Where the artist form sends data

Artists don't use this dashboard — they fill in your public form, which sends
their application to the platform automatically. The form also tells the platform
which **event** the artist is applying to, so applications arrive already scoped
to that event, along with the artist's stall **preferences**. The technical
details of that connection (the API) are in `docs/api-submit.md` (for whoever
builds/maintains the form). As the admin, you only ever see the results in
**Inquiries**.

---

## 7. Common questions

**An artist says they didn't get the email.**
Check **Invoice settings → Email (Gmail)** shows _Connected_. If it was
disconnected at the time, the email was skipped — reconnect, then (for
approvals) the invoice link is also visible in Xero so you can resend manually.

**Invoice failed / no invoice was created.**
Check **Invoice settings → Xero connection** shows _Connected_, that the row is
**Accepted with a stall assigned**, then click **Send invoice** again.

**The Send invoice button isn't showing.**
A row must be **Accepted** _and_ have a **stall assigned** first. If the stall
column says the event has no stalls, add them under **Events** for that event.

**I set the wrong decision.**
Application status can be changed anytime from its dropdown. For an invoice
mistake, void/correct it in Xero and set the dashboard **Payment** status to
**Voided**. For other fixes, contact the developer.

**Can I change the email wording?**
The email text is set in the app's templates. Ask the developer to adjust the
approval/rejection wording.

**Who can log in?**
Only admin accounts created by the developer. There's no public sign-up.
