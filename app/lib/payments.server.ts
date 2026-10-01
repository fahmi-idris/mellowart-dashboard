/**
 * State-machine writes for submissions. Every transition is guarded in SQL
 * (`WHERE ... AND status = ...`) so they're idempotent and safe under retries /
 * concurrent webhook deliveries. Each returns whether a row actually changed.
 */

import type { ApplicationStatus, ManualPaymentStatus } from "~/lib/status";

interface InvoiceLookupRow {
  id: string;
  payment_status: string;
}

/**
 * Set the application decision. Reversible at any time (pending / accepted /
 * waitlisted / rejected / withdrawn) — admins can always override. The optional `reason`
 * is stored against whichever decision it belongs to (`reject_reason` for
 * rejected, `waitlist_reason` for waitlisted, `withdrawn_reason` for withdrawn).
 * A new decision clears the previous decision-email sent state.
 */
export async function setApplicationStatus(
  db: D1Database,
  id: string,
  status: ApplicationStatus,
  decidedBy: string,
  reason?: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET status = ?,
             reject_reason = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END,
             waitlist_reason = CASE WHEN ? = 'waitlisted' THEN ? ELSE NULL END,
             withdrawn_reason = CASE WHEN ? = 'withdrawn' THEN ? ELSE NULL END,
             decision_email_sent_at = NULL,
             decided_by = ?,
             decided_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      status,
      status,
      reason ?? null,
      status,
      reason ?? null,
      status,
      reason ?? null,
      decidedBy,
      id,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Apply one decision to a bounded, explicit selection in one D1 batch. */
export async function setApplicationStatuses(
  db: D1Database,
  ids: string[],
  status: ApplicationStatus,
  decidedBy: string,
): Promise<number> {
  const statements = ids.map((id) =>
    db
      .prepare(
        `UPDATE submissions
          SET status = ?, reject_reason = NULL, waitlist_reason = NULL,
              withdrawn_reason = NULL, decision_email_sent_at = NULL,
              decided_by = ?, decided_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ?`,
      )
      .bind(status, decidedBy, id),
  );
  const results = await db.batch(statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

/** Mark a Gmail-accepted decision email for the current status only. */
export async function markDecisionEmailSent(
  db: D1Database,
  id: string,
  status: ApplicationStatus,
  sentAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE submissions
          SET decision_email_sent_at = ?, updated_at = datetime('now')
        WHERE id = ? AND status = ? AND decision_email_sent_at IS NULL`,
    )
    .bind(sentAt, id, status)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Assign (or clear, with null) the stall for an accepted submission. When
 * assigning, the stall must belong to the submission's own event — stall
 * options are event-scoped. Only valid while `accepted`.
 */
export async function assignStall(
  db: D1Database,
  id: string,
  stallOptionId: string | null,
): Promise<boolean> {
  if (stallOptionId) {
    const ok = await db
      .prepare(
        `SELECT 1
           FROM submissions s
           JOIN stall_options o
             ON o.id = ? AND o.event_id = s.event_id
          WHERE s.id = ? AND s.status = 'accepted'`,
      )
      .bind(stallOptionId, id)
      .first();
    if (!ok) return false;
  }

  const res = await db
    .prepare(
      `UPDATE submissions
         SET stall_option_id = ?, updated_at = datetime('now')
       WHERE id = ? AND status = 'accepted'`,
    )
    .bind(stallOptionId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * accepted + stall assigned + none → invoicing. Explicit entry into the payment
 * machine, triggered by the admin's "Send Xero invoice" action. Guarding on
 * `stall_option_id IS NOT NULL` ensures the invoice always has a price.
 */
export async function startInvoicing(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET payment_status = 'invoicing',
             updated_at = datetime('now')
       WHERE id = ?
         AND status = 'accepted'
         AND stall_option_id IS NOT NULL
         AND payment_status = 'none'`,
    )
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Roll back invoicing → none when invoice creation fails, so the admin can
 * retry "Send invoice". Guarded on `xero_invoice_id IS NULL` so a row that did
 * get an invoice attached is never reset.
 */
export async function cancelInvoicing(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET payment_status = 'none', updated_at = datetime('now')
       WHERE id = ?
         AND payment_status = 'invoicing'
         AND xero_invoice_id IS NULL`,
    )
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * invoicing → awaiting_payment. Called once the Xero invoice exists. Stores the
 * join key used by the webhook.
 */
export async function attachInvoice(
  db: D1Database,
  id: string,
  xeroInvoiceId: string,
  invoiceUrl: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET xero_invoice_id = ?,
             invoice_url = ?,
             payment_status = 'awaiting_payment',
             updated_at = datetime('now')
       WHERE id = ? AND payment_status = 'invoicing'`,
    )
    .bind(xeroInvoiceId, invoiceUrl, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Find the submission a Xero invoice belongs to (webhook → applicant). */
export async function findByInvoiceId(
  db: D1Database,
  xeroInvoiceId: string,
): Promise<InvoiceLookupRow | null> {
  return db
    .prepare("SELECT id, payment_status FROM submissions WHERE xero_invoice_id = ?")
    .bind(xeroInvoiceId)
    .first<InvoiceLookupRow>();
}

/**
 * Admin-driven payment status change by submission id. Only valid on accepted
 * submissions that have entered the payment machine (payment_status != 'none').
 * Stamps `paid_at` on the paid transition.
 */
export async function setPaymentStatus(
  db: D1Database,
  id: string,
  status: ManualPaymentStatus,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET payment_status = ?,
             paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END,
             updated_at = datetime('now')
       WHERE id = ?
         AND status = 'accepted'
         AND payment_status != 'none'`,
    )
    .bind(status, status, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
