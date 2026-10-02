/** Events + per-event stall options: reads, counts, and stall CRUD. */

import {
  EVENT_REFERENCE_KINDS,
  type EventReference,
  type EventSummary,
  type EventWithCounts,
  type StallOption,
} from "~/lib/events";
import type { EventFormInput } from "./event-form";
import sanitizeHtml from "sanitize-html";

export function sanitizeEventDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "s",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "hr",
    ],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  });
}

export async function listEventReferences(db: D1Database): Promise<EventReference[]> {
  const result = await db
    .prepare("SELECT id, kind, name FROM event_references ORDER BY kind, name COLLATE NOCASE")
    .all<EventReference>();
  return result.results;
}

const EVENT_COLUMNS =
  "id, webflow_id AS webflowId, name, slug, location, " +
  "starts_at AS startsAt, ends_at AS endsAt";

const STALL_COLUMNS =
  "id, event_id AS eventId, tier, slug, unit_amount AS unitAmount, currency, " +
  "frontage, furniture, sharing, sort_order AS sortOrder";

/** All events with applicant + awaiting-review counts, newest first. */
export async function listEventsWithCounts(db: D1Database): Promise<EventWithCounts[]> {
  const res = await db
    .prepare(
      `SELECT e.id, e.webflow_id AS webflowId, e.name, e.slug, e.location,
              e.starts_at AS startsAt, e.ends_at AS endsAt, e.summary, e.description, e.image,
              e.webflow_sync_status AS webflowSyncStatus, e.webflow_sync_error AS webflowSyncError,
              e.webflow_synced_at AS webflowSyncedAt,
              COUNT(s.id) AS applicants,
              COALESCE(SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END), 0) AS awaitingReview
         FROM events e
         LEFT JOIN submissions s ON s.event_id = e.id
        GROUP BY e.id
        ORDER BY e.starts_at DESC, e.created_at DESC`,
    )
    .all<EventWithCounts>();
  const events = res.results ?? [];
  const links = await db
    .prepare(
      `SELECT l.event_id AS eventId, r.id, r.kind, r.name
    FROM event_reference_links l JOIN event_references r ON r.id = l.reference_id
    ORDER BY r.name COLLATE NOCASE`,
    )
    .all<EventReference & { eventId: string }>();
  const byEvent = new Map<string, EventReference[]>();
  for (const { eventId, ...reference } of links.results) {
    const values = byEvent.get(eventId) ?? [];
    values.push(reference);
    byEvent.set(eventId, values);
  }
  return events.map((event) => ({ ...event, references: byEvent.get(event.id) ?? [] }));
}

/** Cheap sidebar availability check; uses the same end-date rule as the template picker. */
export async function hasEventAvailableForTemplates(db: D1Database): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM events
          WHERE ends_at IS NULL OR substr(ends_at, 1, 10) >= ?
       ) AS available`,
    )
    .bind(today)
    .first<{ available: number }>();
  return row?.available === 1;
}

export async function getEvent(db: D1Database, id: string): Promise<EventSummary | null> {
  return db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`)
    .bind(id)
    .first<EventSummary>();
}

/** Atomically save content + reusable reference links. Existing Webflow ids are never cleared. */
export async function saveEventContent(
  db: D1Database,
  id: string | null,
  input: EventFormInput,
  newId?: string,
): Promise<boolean> {
  const eventId = id ?? newId ?? `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const description = input.description ? sanitizeEventDescription(input.description) : null;
  const location = input.references.location.join(", ") || null;
  const values = [
    input.name,
    input.slug,
    input.startsAt,
    input.endsAt,
    input.summary,
    description,
    input.image,
    location,
    crypto.randomUUID(),
  ];
  const write = id
    ? db
        .prepare(
          `UPDATE events SET name=?, slug=?, starts_at=?, ends_at=?, summary=?, description=?, image=?, location=?, webflow_sync_version=?, webflow_sync_status='pending', webflow_sync_error=NULL, updated_at=datetime('now') WHERE id=?`,
        )
        .bind(...values, eventId)
    : db
        .prepare(
          `INSERT INTO events (name, slug, starts_at, ends_at, summary, description, image, location, webflow_sync_version, id, webflow_sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .bind(...values, eventId);
  const statements = [
    write,
    db.prepare("DELETE FROM event_reference_links WHERE event_id=?").bind(eventId),
  ];
  for (const kind of EVENT_REFERENCE_KINDS) {
    for (const name of input.references[kind]) {
      statements.push(
        db
          .prepare(
            "INSERT INTO event_references (id, kind, name) VALUES (?, ?, ?) ON CONFLICT(kind, name) DO NOTHING",
          )
          .bind(`REF-${crypto.randomUUID()}`, kind, name),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO event_reference_links (event_id, reference_id)
        SELECT ?, id FROM event_references WHERE kind=? AND name=? COLLATE NOCASE`,
          )
          .bind(eventId, kind, name),
      );
    }
  }
  const results = await db.batch(statements);
  return (results[0].meta.changes ?? 0) > 0;
}

export async function listStallOptions(db: D1Database, eventId: string): Promise<StallOption[]> {
  const res = await db
    .prepare(
      `SELECT ${STALL_COLUMNS} FROM stall_options
        WHERE event_id = ?
        ORDER BY sort_order, unit_amount`,
    )
    .bind(eventId)
    .all<StallOption>();
  return res.results ?? [];
}

export async function getStallOption(db: D1Database, id: string): Promise<StallOption | null> {
  return db
    .prepare(`SELECT ${STALL_COLUMNS} FROM stall_options WHERE id = ?`)
    .bind(id)
    .first<StallOption>();
}

export interface StallOptionInput {
  tier: string;
  slug?: string | null;
  unitAmount: number;
  currency: string;
  frontage?: string | null;
  furniture?: string | null;
  sharing?: string | null;
  sortOrder?: number;
}

/** Validate a stall-option form submission. Shared by the stall CRUD routes. */
export function parseStallOptionForm(form: FormData): StallOptionInput | { error: string } {
  const tier = String(form.get("tier") ?? "").trim();
  const amountText = String(form.get("unitAmount") ?? "").trim();
  const unitAmount = Number(amountText);
  const currency = String(form.get("currency") ?? "")
    .trim()
    .toUpperCase();
  if (!tier) return { error: "Tier name is required." };
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(unitAmount)) {
    return { error: "Price must be an amount with up to two decimal places." };
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "Currency must be a 3-letter code." };
  }
  const slug = String(form.get("slug") ?? "")
    .trim()
    .toLowerCase();
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, and dashes." };
  }
  const sortOrder = Number(form.get("sortOrder"));
  return {
    tier,
    slug: slug || null,
    unitAmount,
    currency,
    frontage: String(form.get("frontage") ?? "").trim() || null,
    furniture: String(form.get("furniture") ?? "").trim() || null,
    sharing: String(form.get("sharing") ?? "").trim() || null,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

export async function createStallOption(
  db: D1Database,
  eventId: string,
  input: StallOptionInput,
): Promise<string> {
  const id = `STL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db
    .prepare(
      `INSERT INTO stall_options
         (id, event_id, tier, slug, unit_amount, currency, frontage, furniture, sharing, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      eventId,
      input.tier,
      input.slug ?? null,
      input.unitAmount,
      input.currency,
      input.frontage ?? null,
      input.furniture ?? null,
      input.sharing ?? null,
      input.sortOrder ?? 0,
    )
    .run();
  return id;
}

export async function updateStallOption(
  db: D1Database,
  id: string,
  input: StallOptionInput,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE stall_options
         SET tier = ?, slug = ?, unit_amount = ?, currency = ?, frontage = ?,
             furniture = ?, sharing = ?, sort_order = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      input.tier,
      input.slug ?? null,
      input.unitAmount,
      input.currency,
      input.frontage ?? null,
      input.furniture ?? null,
      input.sharing ?? null,
      input.sortOrder ?? 0,
      id,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteStallOption(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM stall_options WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Resolve an event slug (or Webflow Item ID / local id) to a local event id
 * (for the submit endpoint). */
export async function findEventBySlug(db: D1Database, ref: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM events WHERE slug = ? OR webflow_id = ? OR id = ? LIMIT 1")
    .bind(ref, ref, ref)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Resolve a stall slug to a local stall-option id, scoped to one event (for the
 * submit endpoint). Slugs are only unique within an event, so the event must be
 * resolved first. Returns null when the event has no stall with that slug.
 */
export async function findStallByEventSlug(
  db: D1Database,
  eventId: string,
  slug: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM stall_options WHERE event_id = ? AND slug = ? LIMIT 1")
    .bind(eventId, slug)
    .first<{ id: string }>();
  return row?.id ?? null;
}
