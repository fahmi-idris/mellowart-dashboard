import {
  EVENT_REFERENCE_KINDS,
  getEventPhase,
  type EventReference,
  type EventSummary,
} from "./events";

export interface EventCursor {
  date: string;
  id: string;
}
export function parseEventQuery(params: URLSearchParams) {
  const limit = Number(params.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be an integer between 1 and 100.");
  const status = params.get("event_status");
  if (status && !["on_going", "upcoming", "inactive", "all"].includes(status))
    throw new Error("Invalid event_status.");
  let cursor: EventCursor | null = null;
  if (params.has("cursor")) {
    try {
      const raw = params.get("cursor")!;
      if (raw.length > 500) throw new Error();
      const value = JSON.parse(atob(raw));
      if (
        typeof value.id !== "string" ||
        value.id.length > 100 ||
        typeof value.date !== "string" ||
        !/^(?:\d{4}-\d{2}-\d{2})?$/.test(value.date)
      )
        throw new Error();
      cursor = { date: value.date, id: value.id };
    } catch {
      throw new Error("Invalid cursor.");
    }
  }
  const name = (params.get("event_name") ?? "").trim();
  if (name.length > 200) throw new Error("Event search is too long.");
  const filters = EVENT_REFERENCE_KINDS.map((kind) => ({
    kind,
    values: params
      .getAll(kind === "location" ? "locations" : kind)
      .concat(kind === "location" ? params.getAll("location") : [])
      .map((value) => value.trim())
      .filter(Boolean),
  }));
  if (
    filters.some(
      (filter) => filter.values.length > 20 || filter.values.some((value) => value.length > 100),
    )
  )
    throw new Error("Too many or invalid reference filters.");
  return { limit, status, cursor, name, filters };
}

type Row = EventSummary & {
  summary: string | null;
  description: string | null;
  image: string | null;
};

/** Bound SQL + stable date/id keyset pagination; no applicant/admin fields are returned. */
export async function listPublicEvents(
  db: D1Database,
  query: ReturnType<typeof parseEventQuery>,
  origin: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  const { status, cursor, name, filters, limit } = query;
  if (!status) {
    conditions.push("e.starts_at IS NOT NULL AND substr(e.ends_at, 1, 10) >= ?");
    args.push(today);
  } else if (status === "upcoming") {
    conditions.push("substr(e.starts_at, 1, 10) > ?");
    args.push(today);
  } else if (status === "on_going") {
    conditions.push("substr(e.starts_at, 1, 10) <= ? AND substr(e.ends_at, 1, 10) >= ?");
    args.push(today, today);
  } else if (status === "inactive") {
    conditions.push("substr(e.ends_at, 1, 10) < ?");
    args.push(today);
  }
  if (name) {
    conditions.push("e.name LIKE ? ESCAPE '\\'");
    args.push(`%${name.replace(/[\\%_]/g, (value) => `\\${value}`)}%`);
  }
  for (const { kind, values } of filters) {
    if (!values.length) continue;
    conditions.push(
      `EXISTS (SELECT 1 FROM event_reference_links l JOIN event_references r ON r.id=l.reference_id WHERE l.event_id=e.id AND r.kind=? AND r.name COLLATE NOCASE IN (${values.map(() => "?").join(",")}))`,
    );
    args.push(kind, ...values);
  }
  if (cursor) {
    conditions.push(
      "(COALESCE(substr(e.starts_at, 1, 10), '') > ? OR (COALESCE(substr(e.starts_at, 1, 10), '') = ? AND e.id > ?))",
    );
    args.push(cursor.date, cursor.date, cursor.id);
  }
  const result = await db
    .prepare(
      `SELECT e.id, e.name, e.slug, substr(e.starts_at, 1, 10) AS startsAt, substr(e.ends_at, 1, 10) AS endsAt, e.summary, e.description, e.image
    FROM events e ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY COALESCE(substr(e.starts_at, 1, 10), ''), e.id LIMIT ?`,
    )
    .bind(...args, limit + 1)
    .all<Row>();
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const links = rows.length
    ? await db
        .prepare(
          `SELECT l.event_id AS eventId, r.id, r.kind, r.name FROM event_reference_links l JOIN event_references r ON r.id=l.reference_id WHERE l.event_id IN (${rows.map(() => "?").join(",")}) ORDER BY r.name COLLATE NOCASE`,
        )
        .bind(...rows.map((row) => row.id))
        .all<EventReference & { eventId: string }>()
    : { results: [] };
  const data = rows.map((row) => {
    const refs = links.results.filter((ref) => ref.eventId === row.id);
    const values = (kind: string) => refs.filter((ref) => ref.kind === kind).map((ref) => ref.name);
    const phase = getEventPhase(row, today);
    return {
      event_name: row.name,
      slug: row.slug,
      start_date: row.startsAt,
      end_date: row.endsAt,
      event_status: phase === "ongoing" ? "on_going" : phase,
      category: values("category"),
      theme: values("theme"),
      summary: row.summary ?? "",
      image: row.image ? new URL(row.image, origin).href : "",
      description: row.description ?? "",
      location: values("location"),
      month: values("month"),
    };
  });
  const last = rows.at(-1);
  return {
    data,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor:
        hasMore && last ? btoa(JSON.stringify({ date: last.startsAt ?? "", id: last.id })) : null,
    },
  };
}
