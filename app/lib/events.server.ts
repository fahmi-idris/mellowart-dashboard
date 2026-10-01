/** Events + per-event stall options: reads, counts, and stall CRUD. */

import type { EventSummary, EventWithCounts, StallOption } from "~/lib/events";

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
              e.starts_at AS startsAt, e.ends_at AS endsAt,
              COUNT(s.id) AS applicants,
              COALESCE(SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END), 0) AS awaitingReview
         FROM events e
         LEFT JOIN submissions s ON s.event_id = e.id
        GROUP BY e.id
        ORDER BY e.starts_at DESC, e.created_at DESC`,
    )
    .all<EventWithCounts>();
  return res.results ?? [];
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

export interface EventInput {
  name: string;
  slug: string;
  webflowId?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export async function createEvent(db: D1Database, input: EventInput): Promise<string> {
  const id = `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db
    .prepare(
      `INSERT INTO events (id, webflow_id, name, slug, location, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.webflowId ?? null,
      input.name,
      input.slug,
      input.location ?? null,
      input.startsAt ?? null,
      input.endsAt ?? null,
    )
    .run();
  return id;
}

export async function updateEvent(db: D1Database, id: string, input: EventInput): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE events
         SET webflow_id = ?, name = ?, slug = ?, location = ?,
             starts_at = ?, ends_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      input.webflowId ?? null,
      input.name,
      input.slug,
      input.location ?? null,
      input.startsAt ?? null,
      input.endsAt ?? null,
      id,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Delete an event. Its stall options cascade away (FK), and any submissions
 * pointing at it have `event_id` set to NULL (FK) — applications are never
 * deleted by removing an event.
 */
export async function deleteEvent(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
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

/**
 * Mirror events from the Webflow CMS into the local `events` table.
 *
 * STUB — Phase 2 wiring. The real implementation fetches the Webflow CMS
 * "Events" collection and upserts each item by `webflow_id` (name, slug,
 * location, start/end dates). Events are managed in Webflow; the dashboard only
 * mirrors them, so until this is wired, seed the `events` table directly.
 */
export async function syncEventsFromWebflow(_env: Env): Promise<{ synced: number }> {
  // TODO(phase-2): call Webflow CMS API and upsert by webflow_id.
  return { synced: 0 };
}
