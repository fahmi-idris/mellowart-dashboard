import { sendEmail } from "~/lib/gmail.server";
import { renderTemplate } from "~/lib/email-templates.server";
import { formatDueDate, getInvoiceSettings, saveInvoiceRecord } from "~/lib/invoices.server";
import { attachInvoice } from "~/lib/payments.server";
import { createInvoice } from "~/lib/xero-client.server";

interface InvoiceSubmissionRow {
  id: string;
  event_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  payment_status: string;
  event_name: string | null;
  stall_tier: string | null;
  stall_amount: number | null;
  stall_currency: string | null;
}

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

/** Friendly due date for the email, e.g. "15 Aug 2026". */
function money(amount: number | null, currency: string): string {
  return amount == null ? "" : `${currency} ${amount.toFixed(2)}`;
}

// approve → invoicing → (this) create Xero invoice from DB config → awaiting_payment
export async function createInvoiceForSubmission(env: Env, submissionId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.first_name, s.last_name, s.email, s.payment_status,
            e.name AS event_name,
            o.tier AS stall_tier, o.unit_amount AS stall_amount,
            o.currency AS stall_currency
       FROM submissions s
       LEFT JOIN events e ON e.id = s.event_id
       LEFT JOIN stall_options o ON o.id = s.stall_option_id
      WHERE s.id = ?`,
  )
    .bind(submissionId)
    .first<InvoiceSubmissionRow>();

  // Idempotency: only invoice while in the `invoicing` state. The assigned
  // stall must carry a price — that's what drives the invoice amount.
  if (!row || row.payment_status !== "invoicing") return;
  if (row.stall_amount == null) return;

  const settings = await getInvoiceSettings(env.DB);

  // Stall option (event-scoped) sets the amount/currency; the rest of the line
  // (account, tax, terms) still comes from invoice settings.
  const unitAmount = row.stall_amount;
  const currency = row.stall_currency ?? settings.currency;
  const description = row.stall_tier
    ? `${settings.itemDescription} — ${row.stall_tier}`
    : settings.itemDescription;

  const created = await createInvoice(
    env,
    {
      contactName: `${row.first_name} ${row.last_name}`.trim(),
      contactEmail: row.email,
      reference: row.id,
      description,
      unitAmount,
      accountCode: settings.accountCode,
      currency,
      lineAmountTypes: settings.lineAmountTypes,
      taxType: settings.taxType,
      dueDate: isoDate(settings.dueDays),
    },
    row.id, // idempotency key — Xero won't create a duplicate on retry
  );

  // Snapshot what we created for later reconciliation/reference.
  await saveInvoiceRecord(env.DB, {
    xeroInvoiceId: created.invoiceId,
    submissionId: row.id,
    invoiceNumber: created.invoiceNumber,
    currency: created.currency ?? currency,
    unitAmount,
    total: created.total,
    amountDue: created.amountDue,
    status: created.status,
    onlineUrl: created.onlineUrl,
    reference: row.id,
  });

  await attachInvoice(env.DB, row.id, created.invoiceId, created.onlineUrl);

  // Best-effort approval email with the invoice link. Never let a mail failure
  // (or a missing Gmail connection) undo the invoice — it's already created.
  try {
    const invCurrency = created.currency ?? currency;
    await sendEmail(
      env,
      await renderTemplate(
        env.DB,
        "approval",
        {
          name: `${row.first_name} ${row.last_name}`.trim(),
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          reference: row.id,
          eventName: row.event_name ?? "",
          invoiceUrl: created.onlineUrl,
          amount: money(created.total ?? unitAmount, invCurrency),
          dueDate: formatDueDate(settings.dueDays),
          bankAccountName: settings.bankAccountName ?? "",
          bankBsb: settings.bankBsb ?? "",
          bankAccountNumber: settings.bankAccountNumber ?? "",
          confirmationFormUrl: settings.confirmationFormUrl ?? "",
        },
        row.event_id,
      ),
    );
  } catch (err) {
    console.error("Approval email failed (invoice still created)", err);
  }
}

// Best-effort confirmation email sent right after a public application lands.
// Never let a mail failure (or a missing Gmail connection) fail the submission.
export async function sendConfirmationEmail(env: Env, submissionId: string): Promise<void> {
  // Resolve the event name and the applicant's requested stall types (their
  // first + second stall preferences, slugs resolved to the option tier labels —
  // the assigned stall_option_id is still null at submission time).
  const row = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.first_name, s.last_name, s.email, s.brand_name,
            s.primary_category, s.secondary_category,
            e.name AS event_name,
            COALESCE(fp.tier, s.first_stall_preference) AS stall_type,
            COALESCE(sp.tier, s.second_stall_preference) AS second_stall_type
       FROM submissions s
       LEFT JOIN events e ON e.id = s.event_id
       LEFT JOIN stall_options fp
              ON fp.event_id = s.event_id AND fp.slug = s.first_stall_preference
       LEFT JOIN stall_options sp
              ON sp.event_id = s.event_id AND sp.slug = s.second_stall_preference
      WHERE s.id = ?`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      event_id: string | null;
      first_name: string;
      last_name: string;
      email: string;
      brand_name: string | null;
      primary_category: string | null;
      secondary_category: string | null;
      event_name: string | null;
      stall_type: string | null;
      second_stall_type: string | null;
    }>();
  if (!row) return;

  try {
    await sendEmail(
      env,
      await renderTemplate(
        env.DB,
        "confirmation",
        {
          name: `${row.first_name} ${row.last_name}`.trim(),
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          reference: row.id,
          brandName: row.brand_name ?? "",
          eventName: row.event_name ?? "",
          stallType: row.stall_type ?? "",
          secondStallType: row.second_stall_type ?? "",
          primaryCategory: row.primary_category ?? "",
          secondaryCategory: row.secondary_category ?? "",
        },
        row.event_id,
      ),
    );
  } catch (err) {
    console.error("Confirmation email failed (submission still created)", err);
  }
}

// Manually send the rejection email with the admin's optional reason. Returns
// whether Gmail accepted the message so the UI can report an honest result.
export async function sendRejectionEmail(
  env: Env,
  submissionId: string,
  reason: string | null,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.first_name, s.last_name, s.email,
            e.name AS event_name
       FROM submissions s LEFT JOIN events e ON e.id = s.event_id
      WHERE s.id = ?`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      event_id: string | null;
      event_name: string | null;
      first_name: string;
      last_name: string;
      email: string;
    }>();
  if (!row) return false;

  try {
    await sendEmail(
      env,
      await renderTemplate(
        env.DB,
        "rejection",
        {
          name: `${row.first_name} ${row.last_name}`.trim(),
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          reference: row.id,
          eventName: row.event_name ?? "",
          reason: reason ?? "",
        },
        row.event_id,
      ),
    );
    return true;
  } catch (err) {
    console.error("Rejection email failed", err);
    return false;
  }
}

// Manually send the waitlist email. Returns whether Gmail accepted the message
// so the UI can report an honest result.
export async function sendWaitlistEmail(
  env: Env,
  submissionId: string,
  reason: string | null,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.first_name, s.last_name, s.email,
            e.name AS event_name
       FROM submissions s LEFT JOIN events e ON e.id = s.event_id
      WHERE s.id = ?`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      event_id: string | null;
      event_name: string | null;
      first_name: string;
      last_name: string;
      email: string;
    }>();
  if (!row) return false;

  try {
    await sendEmail(
      env,
      await renderTemplate(
        env.DB,
        "waitlist",
        {
          name: `${row.first_name} ${row.last_name}`.trim(),
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          reference: row.id,
          eventName: row.event_name ?? "",
          reason: reason ?? "",
        },
        row.event_id,
      ),
    );
    return true;
  } catch (err) {
    console.error("Waitlist email failed", err);
    return false;
  }
}

/** Manually send the withdrawal notice after the status and optional reason are saved. */
export async function sendWithdrawnEmail(
  env: Env,
  submissionId: string,
  reason: string | null,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.first_name, s.last_name, s.email,
            e.name AS event_name
       FROM submissions s LEFT JOIN events e ON e.id = s.event_id
      WHERE s.id = ? AND s.status = 'withdrawn'`,
  )
    .bind(submissionId)
    .first<{
      id: string;
      event_id: string | null;
      event_name: string | null;
      first_name: string;
      last_name: string;
      email: string;
    }>();
  if (!row) return false;
  try {
    await sendEmail(
      env,
      await renderTemplate(
        env.DB,
        "withdrawn",
        {
          name: `${row.first_name} ${row.last_name}`.trim(),
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          reference: row.id,
          eventName: row.event_name ?? "",
          reason: reason ?? "",
        },
        row.event_id,
      ),
    );
    return true;
  } catch (err) {
    console.error("Withdrawn email failed", err);
    return false;
  }
}
