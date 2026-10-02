/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveEventContent } from "../events.server";
import { syncEventToWebflow } from "./sync.server";
import { unpublishAndDeleteEvent } from "./delete.server";
import { eventFields, mapEventContent, referenceFieldValue } from "./mapper.server";
import type { CmsField } from "./client.server";

let sqlite: DatabaseSync;
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
          throw new Error("Unsupported bind");
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
        throw new Error("Not used");
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
        for (const stmt of statements) result.push(await stmt.run<T>());
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
      throw new Error("Not used");
    },
  };
  return db;
}
const site = "a".repeat(24),
  collection = "b".repeat(24),
  referenceCollection = "c".repeat(24);
const config = {
  WEBFLOW_ACCESS_TOKEN: "test-token",
  WEBFLOW_SITE_ID: site,
  WEBFLOW_EVENT_COLLECTION_ID: collection,
};
const content = {
  name: "Art market",
  slug: "art-market",
  startsAt: "2026-10-02",
  endsAt: "2026-10-04",
  summary: "Summary",
  description: "<p>Hello</p>",
  image: null,
  references: { category: ["Art"], theme: [], location: ["Melbourne"], month: [] },
};
const fields: CmsField[] = [
  { slug: "name", displayName: "event name", type: "PlainText", isRequired: true },
  { slug: "slug", displayName: "Slug", type: "PlainText", isRequired: true },
  { slug: "date", displayName: "start date", type: "DateTime", isRequired: false },
  { slug: "end-date", displayName: "End date", type: "DateTime", isRequired: false },
  { slug: "desc", displayName: "summary", type: "PlainText", isRequired: false },
  { slug: "description-2", displayName: "description", type: "RichText", isRequired: false },
  { slug: "image", displayName: "image", type: "Image", isRequired: false },
  {
    slug: "location-2",
    displayName: "location",
    type: "Reference",
    isRequired: false,
    validations: { collectionId: referenceCollection },
  },
];
let calls: { path: string; method: string; body: Record<string, unknown> }[];
let remoteId: string | null;
let publishFails: boolean;
let createFails: number;
let referenceMissing: boolean;
let beforePublish: (() => Promise<void>) | undefined;
let beforeUnpublish: (() => Promise<void>) | undefined;
let unpublishFails: number;
let liveAbsent: boolean;
const mockFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input)),
    path = url.pathname.replace("/v2", "");
  const method = init?.method ?? "GET";
  const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ path, method, body });
  if (path === `/sites/${site}/collections`)
    return Response.json({ collections: [{ id: collection }] });
  if (path === `/collections/${collection}`) return Response.json({ id: collection, fields });
  if (method === "GET" && path.endsWith("/live")) {
    return liveAbsent
      ? new Response(null, { status: 404 })
      : Response.json({ id: remoteId, fieldData: {} });
  }
  if (method === "DELETE" && path.endsWith("/items/live")) {
    expect(row()).toBeDefined(); // The local event must exist until unpublishing succeeds.
    expect(body).toEqual({ items: [{ id: remoteId }] });
    await beforeUnpublish?.();
    if (unpublishFails) return new Response(null, { status: unpublishFails });
    liveAbsent = true;
    return new Response(null, { status: 204 });
  }
  if (path === `/collections/${referenceCollection}/items`)
    return Response.json({
      items: referenceMissing ? [] : [{ id: "ref-id", fieldData: { name: "Melbourne" } }],
      pagination: { total: referenceMissing ? 0 : 1 },
    });
  if (path.endsWith("/items/publish")) {
    await beforePublish?.();
    return Response.json(
      publishFails
        ? { errors: ["Failed"], publishedItemIds: [] }
        : { publishedItemIds: [remoteId], errors: [] },
      { status: 202 },
    );
  }
  if (method === "GET" && path.endsWith("/items"))
    return Response.json({
      items: remoteId ? [{ id: remoteId, fieldData: { slug: content.slug } }] : [],
      pagination: { total: remoteId ? 1 : 0 },
    });
  if (method === "POST") {
    if (createFails)
      return Response.json(
        { message: "Secret must never be echoed: test-token" },
        { status: createFails },
      );
    remoteId = "item-id";
    return Response.json({ id: remoteId, fieldData: body.fieldData });
  }
  if (method === "PATCH")
    return Response.json({ id: remoteId ?? "legacy-item", fieldData: body.fieldData });
  throw new Error(`Unexpected mock request ${method} ${path}`);
};
beforeEach(async () => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  await saveEventContent(database(), null, content, "EVT-TEST");
  calls = [];
  remoteId = null;
  publishFails = false;
  createFails = 0;
  referenceMissing = false;
  beforePublish = undefined;
  beforeUnpublish = undefined;
  unpublishFails = 0;
  liveAbsent = false;
});
afterEach(() => sqlite.close());
const sync = (custom = config) =>
  syncEventToWebflow(database(), "EVT-TEST", custom, "https://app.example.com", mockFetch);
const row = () => sqlite.prepare("SELECT * FROM events WHERE id='EVT-TEST'").get();

describe("unpublish before deleting an event", () => {
  const remove = (custom = config) =>
    unpublishAndDeleteEvent(database(), "EVT-TEST", custom, mockFetch);
  it("unpublishes the CMS item before removing local data, preserving applications", async () => {
    await sync();
    sqlite.exec(`INSERT INTO stall_options(id,event_id,tier) VALUES('STALL-TEST','EVT-TEST','Standard');
      INSERT INTO submissions(id,first_name,last_name,email,bio,event_id,stall_option_id)
      VALUES('ART-TEST','Test','Artist','test@example.com','Bio','EVT-TEST','STALL-TEST');`);
    expect((await remove()).ok).toBe(true);
    expect(row()).toBeUndefined();
    expect(
      sqlite.prepare("SELECT event_id,stall_option_id FROM submissions WHERE id='ART-TEST'").get(),
    ).toMatchObject({ event_id: null, stall_option_id: null });
    expect(sqlite.prepare("SELECT id FROM stall_options").all()).toHaveLength(0);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.find((call) => call.method === "DELETE")?.path).toBe(
      `/collections/${collection}/items/live`,
    );
  });
  it("keeps the event and unlocks it when unpublishing fails", async () => {
    await sync();
    unpublishFails = 403;
    const result = await remove();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("403");
    expect(row()).toMatchObject({ webflow_id: "item-id", webflow_sync_lock: null });
    unpublishFails = 0;
    expect((await remove()).ok).toBe(true);
  });
  it("deletes never-linked events without credentials or external calls", async () => {
    expect((await remove({ ...config, WEBFLOW_ACCESS_TOKEN: "" })).ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(row()).toBeUndefined();
  });
  it("keeps linked events if credentials are missing", async () => {
    await sync();
    expect((await remove({ ...config, WEBFLOW_ACCESS_TOKEN: "" })).ok).toBe(false);
    expect(row()).toBeDefined();
  });
  it("handles an already-unpublished item without attempting a permanent CMS deletion", async () => {
    await sync();
    liveAbsent = true;
    expect((await remove()).ok).toBe(true);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });
  it("refuses deletion during an active publish", async () => {
    sqlite
      .prepare("UPDATE events SET webflow_sync_lock='other',webflow_sync_lock_until=?")
      .run(Date.now() + 60000);
    expect((await remove()).ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(row()?.webflow_sync_lock).toBe("other");
  });
  it("keeps an event edited during unpublishing instead of deleting the newer version", async () => {
    await sync();
    beforeUnpublish = () =>
      saveEventContent(database(), "EVT-TEST", { ...content, name: "Newer edit" }).then(
        () => undefined,
      );
    expect((await remove()).ok).toBe(false);
    expect(row()).toMatchObject({
      name: "Newer edit",
      webflow_sync_status: "pending",
      webflow_sync_lock: null,
    });
  });
  it("blocks deletion when a previous create has an uncertain outcome", async () => {
    createFails = 500;
    await sync();
    const count = calls.length;
    expect((await remove()).message).toContain("unconfirmed");
    expect(calls).toHaveLength(count);
    expect(row()).toBeDefined();
  });
  it("preserves the event if local deletion fails after remote unpublishing", async () => {
    await sync();
    sqlite.exec(
      "CREATE TRIGGER block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'blocked'); END;",
    );
    expect((await remove()).message).toContain("local deletion failed");
    expect(row()).toMatchObject({
      webflow_sync_status: "pending",
      webflow_sync_lock: null,
      webflow_synced_at: null,
    });
    sqlite.exec("DROP TRIGGER block_delete");
    expect((await remove()).ok).toBe(true);
  });
});

describe("automatic Webflow event publishing", () => {
  it("supports multi-reference values and explicit removal of optional fields", () => {
    expect(referenceFieldValue({ ...fields[7], type: "MultiReference" }, ["one", "two"])).toEqual([
      "one",
      "two",
    ]);
    expect(referenceFieldValue(fields[7], [])).toBeNull();
    const data = mapEventContent(
      { ...content, summary: null, description: null },
      eventFields(fields),
      "https://app.example.com",
    );
    expect(data).toMatchObject({ desc: "", "description-2": "", image: null });
    expect(data).not.toHaveProperty("profile-avatars");
  });
  it("detects missing or incompatible fields before writing to CMS", () => {
    expect(() => eventFields(fields.filter((field) => field.slug !== "date"))).toThrow("DateTime");
    expect(() =>
      eventFields(
        fields.map((field) => (field.slug === "date" ? { ...field, type: "PlainText" } : field)),
      ),
    ).toThrow("DateTime");
    expect(() => eventFields([...fields, { ...fields[2], slug: "another-date" }])).toThrow(
      "ambiguous",
    );
  });
  it("blocks a collection configuration change for an already linked event", async () => {
    await sync();
    const count = calls.length;
    expect(
      (await sync({ ...config, WEBFLOW_EVENT_COLLECTION_ID: "d".repeat(24) })).message,
    ).toContain("another Webflow collection");
    expect(calls).toHaveLength(count);
    expect(row()?.webflow_id).toBe("item-id");
  });
  it("records transport errors while preserving saved data", async () => {
    const brokenFetch: typeof fetch = async () => {
      throw new Error("Network down");
    };
    const result = await syncEventToWebflow(
      database(),
      "EVT-TEST",
      config,
      "https://app.example.com",
      brokenFetch,
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("did not respond");
    expect(row()).toMatchObject({
      name: content.name,
      webflow_sync_status: "failed",
      webflow_sync_lock: null,
    });
  });
  it("maps actual API slugs, resolves reference IDs, creates and publishes", async () => {
    expect((await sync()).status).toBe("synced");
    const created = calls.find((call) => call.method === "POST" && call.path.endsWith("/items"));
    expect(created?.body).toMatchObject({
      isDraft: true,
      fieldData: {
        name: content.name,
        date: "2026-10-02T00:00:00.000Z",
        desc: "Summary",
        "location-2": "ref-id",
        "description-2": "<p>Hello</p>",
      },
    });
    expect(created?.body.fieldData).not.toHaveProperty("category");
    expect(row()).toMatchObject({
      webflow_id: "item-id",
      webflow_sync_status: "synced",
      webflow_collection_id: collection,
      webflow_sync_lock: null,
    });
  });
  it("updates the saved item ID after a slug change, without another create", async () => {
    await sync();
    await saveEventContent(database(), "EVT-TEST", { ...content, slug: "new-slug" });
    expect((await sync()).status).toBe("synced");
    expect(
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/items")),
    ).toHaveLength(1);
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      fieldData: { slug: "new-slug" },
    });
  });
  it("preserves the event and records missing configuration without network calls", async () => {
    expect((await sync({ ...config, WEBFLOW_ACCESS_TOKEN: "" })).status).toBe("failed");
    expect(row()?.name).toBe(content.name);
    expect(row()?.webflow_sync_error).toContain("Configure");
    expect(calls).toHaveLength(0);
  });
  it("persists item ID before publish errors and retries that same item", async () => {
    publishFails = true;
    expect((await sync()).status).toBe("failed");
    expect(row()?.webflow_id).toBe("item-id");
    publishFails = false;
    expect((await sync()).status).toBe("synced");
    expect(
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/items")),
    ).toHaveLength(1);
  });
  it("reports missing reference items before any writes", async () => {
    referenceMissing = true;
    expect((await sync()).message).toContain('CMS item named "Melbourne"');
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("rejects multiple values in single references", async () => {
    await saveEventContent(database(), "EVT-TEST", {
      ...content,
      references: { ...content.references, location: ["Melbourne", "Sydney"] },
    });
    expect((await sync()).message).toContain("accepts only one");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("rejects local images and maps public HTTPS image URLs", () => {
    const event = { ...content, image: "/event-assets/image.png" };
    expect(() => mapEventContent(event, eventFields(fields), "http://localhost:5173")).toThrow(
      "public HTTPS",
    );
    expect(mapEventContent(event, eventFields(fields), "https://app.example.com").image).toEqual({
      url: "https://app.example.com/event-assets/image.png",
      alt: content.name,
    });
  });
  it("never overwrites an unlinked CMS item", async () => {
    remoteId = "unrelated-item";
    expect((await sync()).message).toContain("unlinked Webflow item");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("serializes concurrent requests with a DB lease", async () => {
    sqlite
      .prepare("UPDATE events SET webflow_sync_lock='other',webflow_sync_lock_until=?")
      .run(Date.now() + 60000);
    expect((await sync()).status).toBe("pending");
    expect(calls).toHaveLength(0);
  });
  it("does not mark a newer edit synced by an older request", async () => {
    beforePublish = () =>
      saveEventContent(database(), "EVT-TEST", { ...content, name: "Newer edit" }).then(
        () => undefined,
      );
    expect((await sync()).status).toBe("pending");
    expect(row()).toMatchObject({
      name: "Newer edit",
      webflow_sync_status: "pending",
      webflow_id: "item-id",
    });
  });
  it("retries definitive rejections without exposing raw API bodies/tokens", async () => {
    createFails = 400;
    expect((await sync()).message).not.toContain("test-token");
    expect(row()?.webflow_create_slug).toBeNull();
    createFails = 0;
    expect((await sync()).status).toBe("synced");
  });
  it("recovers an uncertain create by the saved attempt slug, then uses its ID", async () => {
    createFails = 500;
    expect((await sync()).status).toBe("failed");
    remoteId = "recovered-item";
    createFails = 0;
    expect((await sync()).status).toBe("synced");
    expect(row()?.webflow_id).toBe("recovered-item");
    expect(
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/items")),
    ).toHaveLength(1);
  });
  it("never blindly retries an uncertain create with no matching CMS item", async () => {
    createFails = 500;
    await sync();
    createFails = 0;
    expect((await sync()).message).toContain("outcome is uncertain");
    expect(
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/items")),
    ).toHaveLength(1);
  });
});
