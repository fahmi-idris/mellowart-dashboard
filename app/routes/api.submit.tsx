import { env } from "cloudflare:workers";

import type { Route } from "./+types/api.submit";
import { ALLOWED_DOC_TYPES, ArtistFieldsSchema, MAX_FILE_BYTES } from "~/lib/artist";
import { findEventBySlug } from "~/lib/events.server";
import { collectFormFiles } from "~/lib/form-files";
import { sendConfirmationEmail } from "~/lib/jobs.server";
import { createArtistSubmission, type UploadFile } from "~/lib/submissions.server";

/**
 * Public artist-application submission endpoint (multipart/form-data).
 *
 * Auth: shared secret in the `X-Client-Key` header, compared to `env.CLIENT_KEY`.
 * Text fields validated with zod; files (1 portfolio document + an optional
 * insurance certificate) validated here and streamed to R2.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Client-Key",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });
}

function bad(status: number, error: string, extra?: unknown) {
  return json({ error, ...(extra ? { issues: extra } : {}) }, { status });
}

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function asOptional(value: FormDataEntryValue | null): string | undefined {
  const s = asString(value).trim();
  return s.length ? s : undefined;
}

function asBool(value: FormDataEntryValue | null): boolean {
  const s = asString(value).toLowerCase();
  return s === "true" || s === "on" || s === "1" || s === "yes";
}

/**
 * First non-empty text value across several field names. Lets us accept the
 * API name, the native Webflow name, and the legacy alias (e.g. `buddyEmail` /
 * `buddy-email-01` / `secondEmail`).
 */
function pickOptional(form: FormData, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const s = asOptional(form.get(k));
    if (s) return s;
  }
  return undefined;
}

/** First present form entry (file or text) across several field names. */
function pickEntry(form: FormData, ...keys: string[]): FormDataEntryValue | null {
  for (const k of keys) {
    const v = form.get(k);
    if (v instanceof File ? v.size > 0 : typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function validateDoc(file: File): string | null {
  if (!ALLOWED_DOC_TYPES.includes(file.type)) {
    return `Unsupported file type: ${file.type || "unknown"} (PDF or image only)`;
  }
  if (file.size === 0) return "Empty file";
  if (file.size > MAX_FILE_BYTES) return "File exceeds 10 MB";
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") return bad(405, "Method not allowed");

  const provided = request.headers.get("x-client-key");
  if (!env.CLIENT_KEY || !provided || provided !== env.CLIENT_KEY) {
    return bad(401, "Unauthorized");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "Expected multipart/form-data");
  }

  // Re-enter email is a confirmation field — checked here, never stored. Only
  // enforced when the form actually sends it.
  const email = asString(form.get("email")).trim();
  const confirmEmail = asOptional(form.get("confirmEmail"));
  if (confirmEmail && confirmEmail.toLowerCase() !== email.toLowerCase()) {
    return bad(422, "Email addresses do not match");
  }

  // Text fields → validate.
  const parsed = ArtistFieldsSchema.safeParse({
    firstName: asString(form.get("firstName")),
    lastName: asString(form.get("lastName")),
    email,
    appliedBefore: asString(form.get("appliedBefore")),
    brandName: asString(form.get("brandName")),
    website: asString(form.get("website")),
    instagram: asString(form.get("instagram")),
    bio: asString(form.get("bio")),
    primaryCategory: asString(form.get("primaryCategory")),
    secondaryCategory: asString(form.get("secondaryCategory")),
    productDescription: asString(form.get("productDescription")),
    additionalNotes: asOptional(form.get("additionalNotes")),
    firstStallPreference: asString(form.get("firstStallPreference")),
    secondStallPreference: asString(form.get("secondStallPreference")),
    offerMiniIfUnavailable: asString(form.get("offerMiniIfUnavailable")),
    sharingStall: asString(form.get("sharingStall")),
    hasInsurance: asString(form.get("hasInsurance")),
    consentDebut: asBool(form.get("consentDebut")),
    consentSharing: asBool(form.get("consentSharing")),
    consentSetupGuide: asBool(form.get("consentSetupGuide")),
    // Shared-stall second artist ("buddy") — only present when sharingStall
    // is "Yes". The API field name is the camelCase `buddy*` form; the native
    // Webflow `buddy-*` name and the legacy `second*` name are also accepted so
    // data flows however the form forwards it. buddy-email-02 is a confirm
    // field and is never stored.
    secondFirstName: pickOptional(form, "buddyFirstName", "buddy-first-name", "secondFirstName"),
    secondLastName: pickOptional(form, "buddyLastName", "buddy-last-name", "secondLastName"),
    secondEmail: pickOptional(form, "buddyEmail", "buddy-email-01", "secondEmail"),
    secondAppliedBefore: pickOptional(
      form,
      "buddyAppliedBefore",
      "buddy-first-timer",
      "secondAppliedBefore",
    ),
    secondBrandName: pickOptional(form, "buddyBrandName", "buddy-brand-name", "secondBrandName"),
    secondWebsite: pickOptional(form, "buddyWebsite", "buddy-website", "secondWebsite"),
    secondInstagram: pickOptional(form, "buddyInstagram", "buddy-instagram", "secondInstagram"),
    secondBio: pickOptional(form, "buddyBio", "buddy-artist-bio", "secondBio"),
    secondPrimaryCategory: pickOptional(
      form,
      "buddyPrimaryCategory",
      "buddy-category-01",
      "secondPrimaryCategory",
    ),
    secondSecondaryCategory: pickOptional(
      form,
      "buddySecondaryCategory",
      "buddy-category-02",
      "secondSecondaryCategory",
    ),
    secondProductDescription: pickOptional(
      form,
      "buddyProductDescription",
      "buddy-product-info",
      "secondProductDescription",
    ),
  });
  if (!parsed.success) {
    return bad(422, "Validation failed", parsed.error.flatten());
  }

  // Files: one required portfolio document + zero or more insurance documents.
  const portfolio = form.get("portfolio");
  if (!(portfolio instanceof File) || portfolio.size === 0) {
    return bad(422, "A portfolio document is required");
  }
  // Webflow may repeat the same multipart key or use the conventional [] form.
  // `get()` would silently discard every insurance document after the first.
  const insuranceFiles = collectFormFiles(form, "insurance", "insurance[]");

  // Optional second-artist portfolio (shared stall). Same rules as the main one.
  const secondPortfolio = pickEntry(
    form,
    "buddyPortfolio",
    "buddy-portfolio-file",
    "secondPortfolio",
  );
  const hasSecondPortfolio = secondPortfolio instanceof File && secondPortfolio.size > 0;

  for (const file of [
    portfolio,
    ...insuranceFiles,
    ...(hasSecondPortfolio ? [secondPortfolio] : []),
  ]) {
    const err = validateDoc(file as File);
    if (err) return bad(422, `${(file as File).name || "file"}: ${err}`);
  }

  const files: UploadFile[] = [
    {
      kind: "portfolio",
      data: await portfolio.arrayBuffer(),
      contentType: portfolio.type,
      size: portfolio.size,
      sortOrder: 0,
    },
    ...(await Promise.all(
      insuranceFiles.map(async (insurance, sortOrder) => ({
        kind: "insurance" as const,
        data: await insurance.arrayBuffer(),
        contentType: insurance.type,
        size: insurance.size,
        sortOrder,
      })),
    )),
    ...(hasSecondPortfolio
      ? [
          {
            kind: "second_portfolio" as const,
            data: await secondPortfolio.arrayBuffer(),
            contentType: secondPortfolio.type,
            size: secondPortfolio.size,
            sortOrder: 0,
          },
        ]
      : []),
  ];

  // Optional event scoping. Forms pass the event's `eventSlug` (the event's
  // Webflow Item ID or local id are still accepted; legacy `webflow_id` /
  // `event` field names also work). Unknown or absent refs leave the submission
  // unassigned (admin scopes later).
  const eventRef =
    asOptional(form.get("eventSlug")) ??
    asOptional(form.get("webflow_id")) ??
    asOptional(form.get("event"));
  const eventId = eventRef ? await findEventBySlug(env.DB, eventRef) : null;

  // Stall preferences come in as slugs and are stored as-is; they're resolved
  // against the event's stall options at read time. The admin still assigns the
  // billed stall (stall_option_id) later, so it starts null.
  const id = await createArtistSubmission(env.DB, env.BUCKET, parsed.data, files, eventId, null);

  // Best-effort confirmation email — never fail the submission if mail is down.
  await sendConfirmationEmail(env, id);

  return json({ ok: true, id }, { status: 201 });
}

export async function loader() {
  return bad(405, "Method not allowed");
}
