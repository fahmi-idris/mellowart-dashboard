import type { ArtistFields } from "~/lib/artist";
import type { SearchCriterion } from "~/lib/data-table";

export interface UploadFile {
  kind: "profile" | "portfolio" | "insurance" | "second_portfolio";
  data: ArrayBuffer;
  contentType: string;
  size: number;
  sortOrder: number;
}

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
};

/**
 * Upload files to R2, then insert the submission + file rows. Files go up first
 * so a DB failure leaves orphaned objects (cheap to GC) rather than rows
 * pointing at missing files.
 */
export async function createArtistSubmission(
  db: D1Database,
  bucket: R2Bucket,
  fields: ArtistFields,
  files: UploadFile[],
  eventId: string | null = null,
  stallOptionId: string | null = null,
): Promise<string> {
  const id = `ART-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const imageRows = [];
  for (const file of files) {
    const imageId = crypto.randomUUID();
    const ext = EXT_BY_TYPE[file.contentType] ?? "";
    const key = `submissions/${id}/${file.kind}/${imageId}${ext}`;
    await bucket.put(key, file.data, {
      httpMetadata: { contentType: file.contentType },
    });
    imageRows.push({
      id: imageId,
      kind: file.kind,
      key,
      contentType: file.contentType,
      size: file.size,
      sortOrder: file.sortOrder,
    });
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO submissions
          (id, first_name, last_name, email, applied_before, brand_name,
           website, instagram, bio, primary_category, secondary_category,
           product_description, additional_notes, consent_debut, consent_sharing,
           consent_setup_guide, first_stall_preference, second_stall_preference,
           offer_mini_if_unavailable, sharing_stall, has_insurance, event_id,
           stall_option_id,
           second_artist_first_name, second_artist_last_name, second_artist_email,
           second_artist_applied_before, second_artist_brand_name,
           second_artist_website, second_artist_instagram, second_artist_bio,
           second_artist_primary_category, second_artist_secondary_category,
           second_artist_product_description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        fields.firstName,
        fields.lastName,
        fields.email,
        fields.appliedBefore,
        fields.brandName,
        fields.website,
        fields.instagram,
        fields.bio,
        fields.primaryCategory,
        fields.secondaryCategory,
        fields.productDescription,
        fields.additionalNotes ?? null,
        fields.consentDebut ? 1 : 0,
        fields.consentSharing ? 1 : 0,
        fields.consentSetupGuide ? 1 : 0,
        fields.firstStallPreference,
        fields.secondStallPreference,
        fields.offerMiniIfUnavailable,
        fields.sharingStall,
        fields.hasInsurance,
        eventId,
        stallOptionId,
        fields.secondFirstName ?? null,
        fields.secondLastName ?? null,
        fields.secondEmail ?? null,
        fields.secondAppliedBefore ?? null,
        fields.secondBrandName ?? null,
        fields.secondWebsite ?? null,
        fields.secondInstagram ?? null,
        fields.secondBio ?? null,
        fields.secondPrimaryCategory ?? null,
        fields.secondSecondaryCategory ?? null,
        fields.secondProductDescription ?? null,
      ),
    ...imageRows.map((r) =>
      db
        .prepare(
          `INSERT INTO submission_images
            (id, submission_id, kind, r2_key, content_type, size, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(r.id, id, r.kind, r.key, r.contentType, r.size, r.sortOrder),
    ),
  ]);

  return id;
}

export interface SubmissionImage {
  id: string;
  kind: "profile" | "portfolio" | "insurance" | "second_portfolio";
  key: string;
  sortOrder: number;
}

export interface SubmissionDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  appliedBefore: string | null;
  brandName: string | null;
  website: string | null;
  instagram: string | null;
  bio: string;
  primaryCategory: string | null;
  secondaryCategory: string | null;
  productDescription: string | null;
  additionalNotes: string | null;
  internalNotes: string | null;
  consentDebut: number;
  consentSharing: number;
  consentSetupGuide: number;
  // Stall preferences: raw slugs + their resolved tier labels (label falls back
  // to the slug when it can't be matched to a stall option).
  firstStallPreference: string | null;
  secondStallPreference: string | null;
  offerMiniIfUnavailable: string | null;
  sharingStall: string | null;
  hasInsurance: string | null;
  eventId: string | null;
  eventName: string | null;
  status: string;
  rejectReason: string | null;
  waitlistReason: string | null;
  withdrawnReason: string | null;
  decisionEmailSentAt: string | null;
  stallOptionId: string | null;
  stallTier: string | null;
  paymentStatus: string;
  submittedAt: string;
  // Shared-stall second artist ("buddy") — null unless the applicant is sharing.
  secondFirstName: string | null;
  secondLastName: string | null;
  secondEmail: string | null;
  secondAppliedBefore: string | null;
  secondBrandName: string | null;
  secondWebsite: string | null;
  secondInstagram: string | null;
  secondBio: string | null;
  secondPrimaryCategory: string | null;
  secondSecondaryCategory: string | null;
  secondProductDescription: string | null;
  images: SubmissionImage[];
}

export async function getSubmissionDetail(
  db: D1Database,
  id: string,
): Promise<SubmissionDetail | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.first_name AS firstName, s.last_name AS lastName, s.email,
              s.applied_before AS appliedBefore, s.brand_name AS brandName,
              s.website, s.instagram, s.bio,
              s.primary_category AS primaryCategory,
              s.secondary_category AS secondaryCategory,
              s.product_description AS productDescription,
              s.additional_notes AS additionalNotes, s.internal_notes AS internalNotes,
              s.consent_debut AS consentDebut, s.consent_sharing AS consentSharing,
              s.consent_setup_guide AS consentSetupGuide,
              COALESCE(fp.tier, s.first_stall_preference) AS firstStallPreference,
              COALESCE(sp.tier, s.second_stall_preference) AS secondStallPreference,
              s.offer_mini_if_unavailable AS offerMiniIfUnavailable,
              s.sharing_stall AS sharingStall, s.has_insurance AS hasInsurance,
              s.event_id AS eventId, e.name AS eventName,
              s.status, s.reject_reason AS rejectReason,
              s.waitlist_reason AS waitlistReason,
              s.withdrawn_reason AS withdrawnReason,
              s.decision_email_sent_at AS decisionEmailSentAt,
              s.stall_option_id AS stallOptionId, o.tier AS stallTier,
              s.payment_status AS paymentStatus, s.created_at AS submittedAt,
              s.second_artist_first_name AS secondFirstName,
              s.second_artist_last_name AS secondLastName,
              s.second_artist_email AS secondEmail,
              s.second_artist_applied_before AS secondAppliedBefore,
              s.second_artist_brand_name AS secondBrandName,
              s.second_artist_website AS secondWebsite,
              s.second_artist_instagram AS secondInstagram,
              s.second_artist_bio AS secondBio,
              s.second_artist_primary_category AS secondPrimaryCategory,
              s.second_artist_secondary_category AS secondSecondaryCategory,
              s.second_artist_product_description AS secondProductDescription
       FROM submissions s
       LEFT JOIN events e ON e.id = s.event_id
       LEFT JOIN stall_options o ON o.id = s.stall_option_id
       LEFT JOIN stall_options fp
              ON fp.event_id = s.event_id AND fp.slug = s.first_stall_preference
       LEFT JOIN stall_options sp
              ON sp.event_id = s.event_id AND sp.slug = s.second_stall_preference
       WHERE s.id = ?`,
    )
    .bind(id)
    .first<Omit<SubmissionDetail, "images">>();

  if (!row) return null;

  const images = await db
    .prepare(
      `SELECT id, kind, r2_key AS key, sort_order AS sortOrder
       FROM submission_images
       WHERE submission_id = ?
       ORDER BY kind, sort_order`,
    )
    .bind(id)
    .all<SubmissionImage>();

  return { ...row, images: images.results ?? [] };
}

/** One fully-resolved submission row for CSV export. Every column is always
 * present (empty string / null when unset), so the export shape is stable. */
export interface SubmissionExportRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  appliedBefore: string | null;
  brandName: string | null;
  website: string | null;
  instagram: string | null;
  bio: string;
  primaryCategory: string | null;
  secondaryCategory: string | null;
  productDescription: string | null;
  additionalNotes: string | null;
  consentDebut: number;
  consentSharing: number;
  consentSetupGuide: number;
  firstStallPreference: string | null;
  secondStallPreference: string | null;
  offerMiniIfUnavailable: string | null;
  sharingStall: string | null;
  hasInsurance: string | null;
  eventId: string | null;
  eventName: string | null;
  status: string;
  rejectReason: string | null;
  waitlistReason: string | null;
  withdrawnReason: string | null;
  decisionEmailSentAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  stallOptionId: string | null;
  stallTier: string | null;
  paymentStatus: string;
  xeroInvoiceId: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  internalNotes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  secondFirstName: string | null;
  secondLastName: string | null;
  secondEmail: string | null;
  secondAppliedBefore: string | null;
  secondBrandName: string | null;
  secondWebsite: string | null;
  secondInstagram: string | null;
  secondBio: string | null;
  secondPrimaryCategory: string | null;
  secondSecondaryCategory: string | null;
  secondProductDescription: string | null;
}

export interface SubmissionExportFilters {
  search?: string;
  searches?: SearchCriterion[];
  status?: string;
  paymentStatus?: string;
  eventId?: string;
  stallOptionId?: string;
  view?: "active" | "archived";
}

/**
 * Every submission matching the given search/filters, fully resolved (event name
 * + stall tier labels) for CSV export. Mirrors the inquiries-list WHERE
 * semantics; ignores pagination. Values are bound; column identifiers are
 * developer-controlled. Capped for safety.
 */
export async function getSubmissionsForExport(
  db: D1Database,
  filters: SubmissionExportFilters,
): Promise<SubmissionExportRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];

  if (filters.search) {
    const like = `%${filters.search}%`;
    where.push(
      "(s.id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR (s.first_name || ' ' || s.last_name) LIKE ? OR s.email LIKE ? OR s.brand_name LIKE ? OR s.primary_category LIKE ? OR s.secondary_category LIKE ? OR s.internal_notes LIKE ?)",
    );
    args.push(...Array(9).fill(like));
  }
  const namedSearchGroups: string[] = [];
  for (const criterion of filters.searches ?? []) {
    const like = `%${criterion.value}%`;
    if (criterion.field === "name" && criterion.value) {
      namedSearchGroups.push(
        "(s.first_name LIKE ? OR s.last_name LIKE ? OR (s.first_name || ' ' || s.last_name) LIKE ?)",
      );
      args.push(like, like, like);
    } else if (criterion.field === "brand" && criterion.value) {
      namedSearchGroups.push("s.brand_name LIKE ?");
      args.push(like);
    } else if (criterion.field === "email" && criterion.value) {
      namedSearchGroups.push("s.email LIKE ?");
      args.push(like);
    } else if (criterion.field === "secondArtist" && criterion.value) {
      namedSearchGroups.push(
        "(s.second_artist_first_name LIKE ? OR s.second_artist_last_name LIKE ? OR s.second_artist_email LIKE ? OR s.second_artist_brand_name LIKE ?)",
      );
      args.push(like, like, like, like);
    } else if (criterion.value) {
      const fields: Record<string, string> = {
        reference: "s.id",
        primaryCategory: "s.primary_category",
        secondaryCategory: "s.secondary_category",
        instagram: "s.instagram",
        website: "s.website",
        notes: "s.internal_notes",
        appliedBefore: "s.applied_before",
      };
      const column = fields[criterion.field];
      if (column) {
        namedSearchGroups.push(`${column} LIKE ?`);
        args.push(like);
      }
    }
  }
  if (namedSearchGroups.length) {
    where.push(`(${namedSearchGroups.join(" OR ")})`);
  }
  const exact: [string, string | undefined][] = [
    ["s.status", filters.status],
    ["s.payment_status", filters.paymentStatus],
    ["s.event_id", filters.eventId],
    ["s.stall_option_id", filters.stallOptionId],
  ];
  for (const [col, value] of exact) {
    if (value != null && value !== "") {
      where.push(`${col} = ?`);
      args.push(value);
    }
  }
  if (filters.view === "active") where.push("s.archived_at IS NULL");
  else if (filters.view === "archived") where.push("s.archived_at IS NOT NULL");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const res = await db
    .prepare(
      `SELECT s.id, s.first_name AS firstName, s.last_name AS lastName, s.email,
              s.applied_before AS appliedBefore, s.brand_name AS brandName,
              s.website, s.instagram, s.bio,
              s.primary_category AS primaryCategory,
              s.secondary_category AS secondaryCategory,
              s.product_description AS productDescription,
              s.additional_notes AS additionalNotes,
              s.consent_debut AS consentDebut, s.consent_sharing AS consentSharing,
              s.consent_setup_guide AS consentSetupGuide,
              COALESCE(fp.tier, s.first_stall_preference) AS firstStallPreference,
              COALESCE(sp.tier, s.second_stall_preference) AS secondStallPreference,
              s.offer_mini_if_unavailable AS offerMiniIfUnavailable,
              s.sharing_stall AS sharingStall, s.has_insurance AS hasInsurance,
              s.event_id AS eventId, e.name AS eventName,
              s.status, s.reject_reason AS rejectReason,
              s.waitlist_reason AS waitlistReason,
              s.withdrawn_reason AS withdrawnReason,
              s.decision_email_sent_at AS decisionEmailSentAt,
              s.decided_by AS decidedBy, s.decided_at AS decidedAt,
              s.stall_option_id AS stallOptionId, o.tier AS stallTier,
              s.payment_status AS paymentStatus, s.xero_invoice_id AS xeroInvoiceId,
              s.invoice_url AS invoiceUrl, s.paid_at AS paidAt,
              s.internal_notes AS internalNotes, s.archived_at AS archivedAt,
              s.created_at AS createdAt, s.updated_at AS updatedAt,
              s.second_artist_first_name AS secondFirstName,
              s.second_artist_last_name AS secondLastName,
              s.second_artist_email AS secondEmail,
              s.second_artist_applied_before AS secondAppliedBefore,
              s.second_artist_brand_name AS secondBrandName,
              s.second_artist_website AS secondWebsite,
              s.second_artist_instagram AS secondInstagram,
              s.second_artist_bio AS secondBio,
              s.second_artist_primary_category AS secondPrimaryCategory,
              s.second_artist_secondary_category AS secondSecondaryCategory,
              s.second_artist_product_description AS secondProductDescription
       FROM submissions s
       LEFT JOIN events e ON e.id = s.event_id
       LEFT JOIN stall_options o ON o.id = s.stall_option_id
       LEFT JOIN stall_options fp
              ON fp.event_id = s.event_id AND fp.slug = s.first_stall_preference
       LEFT JOIN stall_options sp
              ON sp.event_id = s.event_id AND sp.slug = s.second_stall_preference
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT 10000`,
    )
    .bind(...args)
    .all<SubmissionExportRow>();

  return res.results ?? [];
}

/**
 * Archive (hide from the default inquiries list) or unarchive a submission.
 * Purely a visibility flag — leaves application/payment status untouched.
 */
export async function setArchived(db: D1Database, id: string, archived: boolean): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END,
             updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(archived ? 1 : 0, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Set (or clear) the internal, admin-only notes on a submission. */
export async function setInternalNotes(
  db: D1Database,
  id: string,
  notes: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE submissions
         SET internal_notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(notes, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Delete explicit submissions and their local dependent rows, then R2 files. */
export async function deleteSubmissions(
  db: D1Database,
  bucket: R2Bucket,
  ids: string[],
): Promise<{ deleted: number; filesFailed: number }> {
  if (ids.length === 0) return { deleted: 0, filesFailed: 0 };
  const placeholders = ids.map(() => "?").join(", ");
  const images = await db
    .prepare(`SELECT r2_key AS key FROM submission_images WHERE submission_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ key: string }>();
  const results = await db.batch([
    db.prepare(`DELETE FROM activity_log WHERE submission_id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM submissions WHERE id IN (${placeholders})`).bind(...ids),
  ]);
  // submission_images and invoices cascade from submissions. R2 is outside D1,
  // so report any cleanup failures rather than claiming a complete delete.
  let filesFailed = 0;
  for (const image of images.results ?? []) {
    try {
      await bucket.delete(image.key);
    } catch (err) {
      filesFailed++;
      console.error("Submission file cleanup failed", { key: image.key, err });
    }
  }
  return { deleted: results[1].meta.changes ?? 0, filesFailed };
}
