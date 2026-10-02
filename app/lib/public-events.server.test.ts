/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEventQuery, listPublicEvents } from "./public-events.server";
import { listEventReferences, saveEventContent, sanitizeEventDescription } from "./events.server";
import { parseEventForm } from "./event-form";

let sqlite: DatabaseSync;
// Run the production SQL on real SQLite; adapt only the small D1 query surface used here.
function database(): D1Database {
  const meta = (changes = 0): D1Meta => ({
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  });
  const prepare = (sql: string) => {
    let args: (string | number | null)[] = [];
    const statement: D1PreparedStatement = {
      bind(...values: unknown[]) {
        if (
          values.some(
            (value) => value !== null && typeof value !== "string" && typeof value !== "number",
          )
        )
          throw new Error("Unsupported bind value");
        args = values as (string | number | null)[];
        return statement;
      },
      async all<T>() {
        return {
          results: sqlite.prepare(sql).all(...args) as T[],
          success: true,
          meta: { ...meta() },
        };
      },
      async first<T>(column?: string): Promise<T | null> {
        const row = sqlite.prepare(sql).get(...args);
        return row ? ((column ? row[column] : row) as T) : null;
      },
      async run<T>() {
        return {
          success: true,
          results: [] as T[],
          meta: { ...meta(Number(sqlite.prepare(sql).run(...args).changes)) },
        };
      },
      raw() {
        throw new Error("raw() is not needed in this adapter");
      },
    };
    return statement;
  };
  const db: D1Database = {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run<T>());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    withSession() {
      return { prepare, batch: db.batch, getBookmark: () => null };
    },
    dump() {
      throw new Error("dump() is not needed in this adapter");
    },
  };
  return db;
}
function input(name = "New event", slug = "new-event") {
  const data = new FormData();
  data.set("name", name);
  data.set("slug", slug);
  data.set("startsAt", "2026-10-02");
  data.set("endsAt", "2026-10-04");
  data.append("location", "Melbourne");
  data.append("theme", "Art");
  data.append("category", "Market");
  data.append("month", "October");
  const result = parseEventForm(data);
  if (!result.input) throw new Error("Bad fixture");
  return result.input;
}
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations.filter((name) => !name.startsWith("0021")))
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  sqlite.exec(`INSERT INTO events (id,name,slug,location,starts_at,ends_at,webflow_id) VALUES
    ('EVT-A','Legacy market','legacy','Melbourne','2026-10-02','2026-10-03','webflow-keep');`);
  sqlite.exec(readFileSync("migrations/0021_event_content_and_references.sql", "utf8"));
});
afterEach(() => sqlite.close());

describe("event content migration and catalog", () => {
  it("preserves old events and backfills their reusable location", async () => {
    const refs = await listEventReferences(database());
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "location", name: "Melbourne" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("saves and updates references atomically without clearing the Webflow id", async () => {
    const db = database();
    await saveEventContent(db, "EVT-A", input());
    const next = input("Other", "other");
    next.references.location = ["melbourne"];
    await saveEventContent(db, null, next);
    expect((await listEventReferences(db)).filter((ref) => ref.kind === "location")).toHaveLength(
      1,
    );
    expect(sqlite.prepare("SELECT webflow_id FROM events WHERE id=?").get("EVT-A")).toMatchObject({
      webflow_id: "webflow-keep",
    });
    const changed = input();
    changed.references.theme = ["Stationery"];
    await saveEventContent(db, "EVT-A", changed);
    expect((await listEventReferences(db)).some((ref) => ref.name === "Art")).toBe(true);
    const response = await listPublicEvents(
      db,
      parseEventQuery(new URLSearchParams("theme=Stationery")),
      "https://test.example",
      "2026-10-02",
    );
    expect(response.data).toHaveLength(1);
    expect(response.data[0].theme).toEqual(["Stationery"]);
  });
  it("paginates equal dates without duplicates and returns only public fields", async () => {
    const db = database();
    await saveEventContent(db, null, input("Second", "second"));
    await saveEventContent(db, null, input("Third", "third"));
    const first = await listPublicEvents(
      db,
      parseEventQuery(new URLSearchParams("limit=2")),
      "https://test.example",
      "2026-10-02",
    );
    expect(first.pagination.has_more).toBe(true);
    const second = await listPublicEvents(
      db,
      parseEventQuery(new URLSearchParams({ limit: "2", cursor: first.pagination.next_cursor! })),
      "https://test.example",
      "2026-10-02",
    );
    expect(second.pagination.has_more).toBe(false);
    expect(second.pagination.next_cursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((event) => event.slug)).size).toBe(3);
    expect(Object.keys(first.data[0])).toEqual([
      "event_name",
      "slug",
      "start_date",
      "end_date",
      "event_status",
      "category",
      "theme",
      "summary",
      "image",
      "description",
      "location",
      "month",
    ]);
  });
  it("filters names, references and status, including the final event day", async () => {
    const db = database();
    await saveEventContent(db, "EVT-A", input());
    const query = parseEventQuery(
      new URLSearchParams(
        "event_name=New&locations=melbourne&theme=Art&category=Market&month=October&event_status=on_going",
      ),
    );
    expect(
      (await listPublicEvents(db, query, "https://example.test", "2026-10-04")).data,
    ).toHaveLength(1);
    expect(
      (await listPublicEvents(db, query, "https://example.test", "2026-10-05")).data,
    ).toHaveLength(0);
    expect(
      (
        await listPublicEvents(
          db,
          parseEventQuery(new URLSearchParams()),
          "https://example.test",
          "2026-10-05",
        )
      ).data,
    ).toHaveLength(0);
    const imageInput = input();
    imageInput.image = "/event-assets/abc.png";
    await saveEventContent(db, "EVT-A", imageInput);
    const upcoming = await listPublicEvents(
      db,
      parseEventQuery(new URLSearchParams("event_status=upcoming")),
      "https://example.test",
      "2026-10-01",
    );
    expect(upcoming.data[0]).toMatchObject({
      event_status: "upcoming",
      image: "https://example.test/event-assets/abc.png",
    });
  });
  it("escapes LIKE wildcards and never interpolates search input into SQL", async () => {
    expect(
      (
        await listPublicEvents(
          database(),
          parseEventQuery(new URLSearchParams("event_name=%25")),
          "https://example.test",
          "2026-10-02",
        )
      ).data,
    ).toEqual([]);
    expect(
      (
        await listPublicEvents(
          database(),
          parseEventQuery(new URLSearchParams({ theme: "' OR 1=1--" })),
          "https://example.test",
          "2026-10-02",
        )
      ).data,
    ).toEqual([]);
  });
  it("rejects malformed pagination and filters", () => {
    for (const query of ["limit=0", "limit=101", "limit=1.5", "cursor=bad", "event_status=bad"])
      expect(() => parseEventQuery(new URLSearchParams(query))).toThrow();
  });
  it("rolls back duplicate slugs without adding partial references", async () => {
    const next = input("Duplicate", "legacy");
    next.references.theme = ["Rollback theme"];
    await expect(saveEventContent(database(), null, next)).rejects.toThrow();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM event_references WHERE name='Rollback theme'")
        .get(),
    ).toMatchObject({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get()).toMatchObject({ n: 1 });
  });
  it("handles legacy timestamps as date-only values across page cursors", async () => {
    sqlite.exec(
      "UPDATE events SET starts_at='2026-10-02T10:00:00Z', ends_at='2026-10-03T10:00:00Z'",
    );
    await saveEventContent(database(), null, input("Second", "second"));
    const first = await listPublicEvents(
      database(),
      parseEventQuery(new URLSearchParams("event_status=on_going&limit=1")),
      "https://example.test",
      "2026-10-02",
    );
    expect(first.data[0].start_date).toBe("2026-10-02");
    expect(first.pagination.has_more).toBe(true);
    const next = await listPublicEvents(
      database(),
      parseEventQuery(new URLSearchParams({ cursor: first.pagination.next_cursor!, limit: "1" })),
      "https://example.test",
      "2026-10-02",
    );
    expect(next.data).toHaveLength(1);
    expect(next.data[0].slug).not.toBe(first.data[0].slug);
  });
  it("sanitizes rich text and unsafe links while keeping formatting", () => {
    const clean = sanitizeEventDescription(
      '<h2>Market</h2><script>alert(1)</script><p onclick="x()"><strong>Art</strong><a href="javascript:alert(1)">link</a><img src=x onerror=x()></p>',
    );
    expect(clean).toContain("<h2>Market</h2>");
    expect(clean).toContain("<strong>Art</strong>");
    for (const bad of ["script", "onclick", "javascript:", "<img"])
      expect(clean).not.toContain(bad);
  });
});
