import { logActivity } from "./activity.server";
import { sendRejectionEmail, sendWaitlistEmail, sendWithdrawnEmail } from "./jobs.server";
import { markDecisionEmailSent } from "./payments.server";
import { APPLICATION_LABEL, type ApplicationStatus } from "./status";

type DecisionStatus = Extract<ApplicationStatus, "rejected" | "waitlisted" | "withdrawn">;

export type DecisionEmailResult =
  | { ok: false; message: string }
  | {
      ok: true;
      intent: "send_decision_email";
      id: string;
      status: DecisionStatus;
      decisionEmailSentAt: string;
      message: string;
    };

/** Send once for the current decision, then return the exact state to show in the UI. */
export async function sendDecisionEmail(
  env: Env,
  actor: { sub: string; email: string },
  id: string,
  requestedStatus: string,
): Promise<DecisionEmailResult> {
  const decision = await env.DB.prepare(
    `SELECT status, reject_reason AS rejectReason,
            waitlist_reason AS waitlistReason,
            withdrawn_reason AS withdrawnReason,
            decision_email_sent_at AS decisionEmailSentAt
       FROM submissions
      WHERE id = ?`,
  )
    .bind(id)
    .first<{
      status: string;
      rejectReason: string | null;
      waitlistReason: string | null;
      withdrawnReason: string | null;
      decisionEmailSentAt: string | null;
    }>();

  if (
    !decision ||
    !["rejected", "waitlisted", "withdrawn"].includes(decision.status) ||
    decision.status !== requestedStatus
  ) {
    return { ok: false, message: `${id} changed status. Refresh the row before sending an email.` };
  }
  if (decision.decisionEmailSentAt) {
    return { ok: false, message: `${id} already has an email sent for this decision.` };
  }

  const status = decision.status as DecisionStatus;
  const sent =
    status === "rejected"
      ? await sendRejectionEmail(env, id, decision.rejectReason)
      : status === "waitlisted"
        ? await sendWaitlistEmail(env, id, decision.waitlistReason)
        : await sendWithdrawnEmail(env, id, decision.withdrawnReason);
  if (!sent) {
    return {
      ok: false,
      message: `Could not send the email for ${id}. Check the Google connection and try again.`,
    };
  }

  const sentAt = new Date().toISOString();
  const recorded = await markDecisionEmailSent(env.DB, id, status, sentAt);
  if (!recorded) {
    return {
      ok: false,
      message: `Email sent for ${id}, but its status changed before the send could be recorded. Refresh the row.`,
    };
  }

  const decisionLabel =
    status === "rejected" ? "rejection" : status === "waitlisted" ? "waitlist" : "withdrawal";
  let name = id;
  try {
    const row = await env.DB.prepare(
      "SELECT first_name AS firstName, last_name AS lastName FROM submissions WHERE id = ?",
    )
      .bind(id)
      .first<{ firstName: string; lastName: string }>();
    if (row) name = `${row.firstName} ${row.lastName}`.trim() || id;
    await logActivity(env.DB, {
      actorId: actor.sub,
      actorEmail: actor.email,
      submissionId: id,
      subject: name,
      type: "email_sent",
      message: `${name} ${decisionLabel} email sent`,
    });
  } catch (err) {
    // The email and sent marker succeeded; an activity-log failure is secondary.
    console.error("Could not log sent decision email", { id, err });
  }

  return {
    ok: true,
    intent: "send_decision_email",
    id,
    status,
    decisionEmailSentAt: sentAt,
    message: `${APPLICATION_LABEL[status]} email sent to ${name}.`,
  };
}
