import { env } from "cloudflare:workers";

import type { Route } from "./+types/api.inquiry.$id";
import { requireAdmin } from "~/lib/auth.server";
import { sendDecisionEmail } from "~/lib/decision-email.server";
import { getSubmissionDetail } from "~/lib/submissions.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const detail = await getSubmissionDetail(env.DB, params.id);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}

export async function action({ request, params }: Route.ActionArgs) {
  const session = await requireAdmin(request);
  const form = await request.formData();
  if (form.get("intent") !== "send_decision_email") {
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }
  try {
    const result = await sendDecisionEmail(
      env,
      session,
      params.id,
      String(form.get("status") ?? ""),
    );
    return Response.json(result, {
      status: result.ok ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Could not send decision email", { id: params.id, err });
    return Response.json(
      { ok: false, message: "Could not send the email. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
