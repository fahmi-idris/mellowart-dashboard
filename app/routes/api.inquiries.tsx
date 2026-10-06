import { env } from "cloudflare:workers";

import type { Route } from "./+types/api.inquiries";
import { requireAdmin } from "~/lib/auth.server";
import { rowsToCsv } from "~/lib/csv";
import { getEvent } from "~/lib/events.server";
import { parseListQuery } from "~/lib/data-table";
import { d1List, type D1ListConfig } from "~/lib/d1-pagination.server";
import { getSubmissionsForExport, type SubmissionExportRow } from "~/lib/submissions.server";
import { zipStream, type ZipEntry } from "~/lib/zip.server";

const yesNo = (v: number) => (v ? "yes" : "no");
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

// CSV export columns, in order. Every row includes every column (blank when
// unset) so the export shape is stable regardless of which fields have data.
const EXPORT_COLUMNS: {
  header: string;
  get: (r: SubmissionExportRow) => unknown;
}[] = [
  { header: "Reference", get: (r) => r.id },
  { header: "First name", get: (r) => r.firstName },
  { header: "Last name", get: (r) => r.lastName },
  { header: "Email", get: (r) => r.email },
  { header: "Applied before", get: (r) => r.appliedBefore },
  { header: "Brand name", get: (r) => r.brandName },
  { header: "Website", get: (r) => r.website },
  { header: "Instagram", get: (r) => r.instagram },
  { header: "Bio", get: (r) => r.bio },
  { header: "Primary category", get: (r) => r.primaryCategory },
  { header: "Secondary category", get: (r) => r.secondaryCategory },
  { header: "Product description", get: (r) => r.productDescription },
  { header: "Additional notes", get: (r) => r.additionalNotes },
  { header: "Consent debut", get: (r) => yesNo(r.consentDebut) },
  { header: "Consent sharing", get: (r) => yesNo(r.consentSharing) },
  { header: "Consent setup guide", get: (r) => yesNo(r.consentSetupGuide) },
  { header: "First stall preference", get: (r) => r.firstStallPreference },
  { header: "Second stall preference", get: (r) => r.secondStallPreference },
  { header: "Offer mini if unavailable", get: (r) => r.offerMiniIfUnavailable },
  { header: "Sharing stall", get: (r) => r.sharingStall },
  { header: "Has insurance", get: (r) => r.hasInsurance },
  { header: "Event", get: (r) => r.eventName },
  { header: "Status", get: (r) => r.status },
  { header: "Reject reason", get: (r) => r.rejectReason },
  { header: "Waitlist reason", get: (r) => r.waitlistReason },
  { header: "Withdrawal reason", get: (r) => r.withdrawnReason },
  { header: "Decision email sent at", get: (r) => r.decisionEmailSentAt },
  { header: "Decided by", get: (r) => r.decidedBy },
  { header: "Decided at", get: (r) => r.decidedAt },
  { header: "Stall assigned", get: (r) => r.stallTier },
  { header: "Payment status", get: (r) => r.paymentStatus },
  { header: "Xero invoice ID", get: (r) => r.xeroInvoiceId },
  { header: "Invoice URL", get: (r) => r.invoiceUrl },
  { header: "Paid at", get: (r) => r.paidAt },
  { header: "Internal notes", get: (r) => r.internalNotes },
  { header: "Archived at", get: (r) => r.archivedAt },
  { header: "Submitted at", get: (r) => r.createdAt },
  { header: "Updated at", get: (r) => r.updatedAt },
  { header: "Second artist first name", get: (r) => r.secondFirstName },
  { header: "Second artist last name", get: (r) => r.secondLastName },
  { header: "Second artist email", get: (r) => r.secondEmail },
  { header: "Second artist applied before", get: (r) => r.secondAppliedBefore },
  { header: "Second artist brand name", get: (r) => r.secondBrandName },
  { header: "Second artist website", get: (r) => r.secondWebsite },
  { header: "Second artist instagram", get: (r) => r.secondInstagram },
  { header: "Second artist bio", get: (r) => r.secondBio },
  { header: "Second artist primary category", get: (r) => r.secondPrimaryCategory },
  {
    header: "Second artist secondary category",
    get: (r) => r.secondSecondaryCategory,
  },
  {
    header: "Second artist product description",
    get: (r) => r.secondProductDescription,
  },
];

// Map client column ids (TanStack accessorKeys) → DB columns for sorting.
const SORT_FIELD_MAP: Record<string, string> = {
  id: "id",
  name: "last_name",
  status: "status",
  paymentStatus: "payment_status",
  submittedAt: "created_at",
};

const LIST_CONFIG: D1ListConfig = {
  table: "submissions",
  columns:
    "id, first_name AS firstName, last_name AS lastName, " +
    "(first_name || ' ' || last_name) AS name, email, brand_name AS brandName, " +
    "primary_category AS primaryCategory, secondary_category AS secondaryCategory, " +
    "product_description AS productDescription, " +
    "sharing_stall AS sharingStall, has_insurance AS hasInsurance, " +
    "applied_before AS appliedBefore, instagram, decided_at AS decidedAt, " +
    "event_id AS eventId, status, reject_reason AS rejectReason, " +
    "withdrawn_reason AS withdrawnReason, decision_email_sent_at AS decisionEmailSentAt, " +
    "stall_option_id AS stallOptionId, payment_status AS paymentStatus, " +
    "invoice_url AS invoiceUrl, internal_notes AS internalNotes, " +
    "archived_at AS archivedAt, created_at AS submittedAt",
  searchColumns: [
    "first_name",
    "last_name",
    "(first_name || ' ' || last_name)",
    "email",
    "brand_name",
    "id",
    "primary_category",
    "secondary_category",
    "internal_notes",
  ],
  searchFieldColumns: {
    name: ["first_name", "last_name", "(first_name || ' ' || last_name)"],
    brand: ["brand_name"],
    email: ["email"],
    reference: ["id"],
    primaryCategory: ["primary_category"],
    secondaryCategory: ["secondary_category"],
    instagram: ["instagram"],
    website: ["website"],
    notes: ["internal_notes"],
    appliedBefore: ["applied_before"],
    secondArtist: [
      "second_artist_first_name",
      "second_artist_last_name",
      "second_artist_email",
      "second_artist_brand_name",
    ],
  },
  // Filter keys sent by the UI map 1:1 to these columns.
  filterColumns: ["status", "payment_status", "event_id", "stall_option_id"],
  sortColumns: ["last_name", "status", "payment_status", "created_at"],
  defaultSort: { field: "created_at", dir: "desc" },
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const query = parseListQuery(url.searchParams);
  if (query.sort) {
    query.sort.field = SORT_FIELD_MAP[query.sort.field] ?? "created_at";
  }

  // Archive is a list-visibility scope, not a real column — pull `view` out of
  // the generic filters and map it to a WHERE fragment. The UI sends
  // view=active by default (hide archived); clearing the filter ("All views")
  // drops the key entirely, which shows everything.
  const view = query.filters?.view;
  if (query.filters) delete query.filters.view;
  const archiveWhere =
    view === "active"
      ? "archived_at IS NULL"
      : view === "archived"
        ? "archived_at IS NOT NULL"
        : undefined;
  const config: D1ListConfig = { ...LIST_CONFIG, extraWhere: archiveWhere };

  // All-event backups require explicit scope; otherwise require one event.
  if (url.searchParams.get("format") === "backup") {
    const allEvents = url.searchParams.get("scope") === "all";
    const eventId = query.filters?.event_id;
    if (!allEvents && !eventId)
      return Response.json({ error: "Choose an event to back up." }, { status: 400 });
    const event = !allEvents && eventId ? await getEvent(env.DB, eventId) : null;
    if (!allEvents && !event) return Response.json({ error: "Event not found." }, { status: 404 });
    const matching = await d1List(
      env.DB,
      allEvents
        ? { page: 1, pageSize: 1 }
        : { page: 1, pageSize: 1, filters: { event_id: eventId! } },
      LIST_CONFIG,
    );
    if (matching.total > 10_000) {
      return Response.json(
        { error: "Backup exceeds the supported record count." },
        { status: 413 },
      );
    }
    const rows = await getSubmissionsForExport(env.DB, allEvents ? {} : { eventId });
    const imageRows: { submissionId: string; key: string; size: number | null }[] = [];
    // Bound batches avoid exceeding the D1 query parameter limit. Only selected
    // submissions' documents may enter the ZIP (including metadata/HTML links).
    for (let offset = 0; offset < rows.length; offset += 90) {
      const ids = rows.slice(offset, offset + 90).map((row) => row.id);
      const images = await env.DB.prepare(
        `SELECT submission_id AS submissionId, r2_key AS key, size FROM submission_images WHERE submission_id IN (${ids.map(() => "?").join(",")}) ORDER BY submission_id, sort_order`,
      )
        .bind(...ids)
        .all<{ submissionId: string; key: string; size: number | null }>();
      imageRows.push(...(images.results ?? []));
    }
    const imagePaths = new Map<string, string[]>();
    for (const image of imageRows) {
      const path = `images/${image.key.replace(/^submissions\//, "")}`;
      imagePaths.set(image.submissionId, [...(imagePaths.get(image.submissionId) ?? []), path]);
    }
    const estimatedBytes = imageRows.reduce((n, item) => n + Number(item.size ?? 0), 0);
    if (estimatedBytes >= 3_500_000_000 || imageRows.length + 3 > 65535) {
      return Response.json(
        { error: "Backup is too large for a single ZIP download." },
        { status: 413 },
      );
    }
    const csv = rowsToCsv(
      EXPORT_COLUMNS.map((c) => c.header),
      rows.map((r) => EXPORT_COLUMNS.map((c) => c.get(r))),
    );
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mellow inquiries backup</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;vertical-align:top}th{background:#eee}td{white-space:pre-wrap}</style><h1>Inquiries backup</h1><p>${rows.length} submissions</p><table><thead><tr>${EXPORT_COLUMNS.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}<th>Documents</th></tr></thead><tbody>${rows.map((row) => `<tr>${EXPORT_COLUMNS.map((c) => `<td>${escapeHtml(c.get(row))}</td>`).join("")}<td>${(imagePaths.get(row.id) ?? []).map((path) => `<a href="${escapeHtml(path)}">${escapeHtml(path.split("/").at(-1))}</a>`).join("<br>")}</td></tr>`).join("")}</tbody></table></html>`;
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: "inquiries.csv", body: new TextEncoder().encode(`\ufeff${csv}`) };
      yield { name: "inquiries.html", body: new TextEncoder().encode(html) };
      for (const image of imageRows) {
        const name = `images/${image.key.replace(/^submissions\//, "")}`;
        const object = await env.BUCKET.get(image.key);
        if (object?.body) yield { name, body: object.body };
        else
          yield {
            name: `${name}.missing.txt`,
            body: new TextEncoder().encode(`File missing from R2: ${image.key}\n`),
          };
      }
    }
    const date = new Date().toISOString().slice(0, 10);
    const eventFilename = event
      ? (event.slug || event.id).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100)
      : "all-events";
    return new Response(zipStream(entries()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="inquiries-backup-${eventFilename}-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Copy-emails mode: every matching email for the current search/filters,
  // ignoring pagination. Returns { emails: string[] }.
  if (url.searchParams.get("emails") === "1") {
    const all = await d1List<{ email: string }>(
      env.DB,
      { ...query, page: 1, pageSize: 10_000 },
      { ...config, columns: "email" },
    );
    const emails = [...new Set(all.data.map((r) => r.email))];
    return Response.json({ emails });
  }

  // CSV export: every submission matching the current search/filters (ignoring
  // pagination), fully resolved, as a downloadable file.
  if (url.searchParams.get("format") === "csv") {
    const rows = await getSubmissionsForExport(env.DB, {
      search: query.search,
      searches: query.searches,
      status: query.filters?.status,
      paymentStatus: query.filters?.payment_status,
      eventId: query.filters?.event_id,
      stallOptionId: query.filters?.stall_option_id,
      view: view === "archived" ? "archived" : view === "active" ? "active" : undefined,
    });
    const csv = rowsToCsv(
      EXPORT_COLUMNS.map((c) => c.header),
      rows.map((r) => EXPORT_COLUMNS.map((c) => c.get(r))),
    );
    const date = new Date().toISOString().slice(0, 10);
    // Prepend a UTF-8 BOM so Excel reads non-ASCII names correctly.
    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inquiries-${date}.csv"`,
      },
    });
  }

  const result = await d1List(env.DB, query, config);
  return Response.json(result);
}
