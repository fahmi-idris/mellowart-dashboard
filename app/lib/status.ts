/**
 * Two independent state machines for a submission, surfaced to the admin as two
 * separate, colour-coded dropdowns (NOT one compound badge).
 *
 *  Application:  pending → accepted | waitlisted | rejected | withdrawn (reversible)
 *  Payment:      none → invoicing → awaiting_payment → paid
 *                (+ overdue / voided)                          (Xero-driven, async)
 *
 * Stall assignment unlocks only once Application = accepted; assigning a stall is
 * the prerequisite for sending the Xero invoice.
 */

// ---------- Application (decision) ----------

export type ApplicationStatus = "pending" | "accepted" | "waitlisted" | "rejected" | "withdrawn";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "pending",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
];

export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function isApplicationStatus(v: string): v is ApplicationStatus {
  return (APPLICATION_STATUSES as string[]).includes(v);
}

/** Accepted is the gate for stall assignment + invoicing. */
export function isAccepted(status: ApplicationStatus): boolean {
  return status === "accepted";
}

// ---------- Payment ----------

export type PaymentStatus =
  "none" | "invoicing" | "awaiting_payment" | "paid" | "overdue" | "voided";

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  none: "Not sent",
  invoicing: "Invoicing",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  overdue: "Overdue",
  voided: "Voided",
};

/**
 * Payment statuses an admin may set by hand. Without the Xero webhook, the
 * admin reconciles payment state manually from the Xero dashboard.
 */
export const MANUAL_PAYMENT_STATUSES = ["awaiting_payment", "paid", "overdue", "voided"] as const;

export type ManualPaymentStatus = (typeof MANUAL_PAYMENT_STATUSES)[number];

export function isManualPaymentStatus(v: string): v is ManualPaymentStatus {
  return (MANUAL_PAYMENT_STATUSES as readonly string[]).includes(v);
}

// ---------- Colour coding (per Alison's request) ----------
//
// Application: accepted=green, waitlisted=yellow, rejected=red, pending=grey.
// Payment:     paid=green, awaiting=yellow, overdue=red, voided/none=grey.

export type StatusTone = "grey" | "green" | "yellow" | "red";

/** Soft pill classes for a given tone, light + dark. */
export const TONE_CLASS: Record<StatusTone, string> = {
  grey: "bg-muted text-muted-foreground",
  green: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export const APPLICATION_TONE: Record<ApplicationStatus, StatusTone> = {
  pending: "grey",
  accepted: "green",
  waitlisted: "yellow",
  rejected: "red",
  withdrawn: "grey",
};

export const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  none: "grey",
  invoicing: "yellow",
  awaiting_payment: "yellow",
  paid: "green",
  overdue: "red",
  voided: "grey",
};

export function applicationToneClass(status: ApplicationStatus): string {
  return TONE_CLASS[APPLICATION_TONE[status]];
}

export function paymentToneClass(status: PaymentStatus): string {
  return TONE_CLASS[PAYMENT_TONE[status]];
}
