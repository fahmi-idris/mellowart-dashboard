import { z } from "zod";
import { WebflowClient, WebflowApiError, itemSchema } from "./client.server";
import {
  eventFields,
  mapEventContent,
  referenceFieldValue,
  REFERENCE_KEYS,
  type PublishableEvent,
} from "./mapper.server";
import type { EventReferenceKind } from "../events";

export type WebflowConfig = Partial<
  Record<
    keyof Pick<
      Cloudflare.Env,
      | "WEBFLOW_ACCESS_TOKEN"
      | "WEBFLOW_SITE_ID"
      | "WEBFLOW_EVENT_COLLECTION_ID"
      | "WEBFLOW_ASSET_BASE_URL"
    >,
    string
  >
>;
interface SyncEvent extends PublishableEvent {
  id: string;
  webflowId: string | null;
  collectionId: string | null;
  version: string | null;
  createSlug: string | null;
}
export type SyncResult = { status: "synced" | "failed" | "pending"; message: string };

/** Awaited, bounded sync gives the admin immediate results. A DB lease serializes saves/retries. */
export async function syncEventToWebflow(
  db: D1Database,
  id: string,
  config: WebflowConfig,
  origin: string,
  send: typeof fetch = fetch,
): Promise<SyncResult> {
  try {
    return await runSync(db, id, config, origin, send);
  } catch {
    // A sync bookkeeping/storage failure must never turn a completed event save into a failed save.
    console.error(JSON.stringify({ message: "Webflow sync bookkeeping failed", eventId: id }));
    return {
      status: "failed",
      message: "The event is saved, but Webflow sync could not finish. Retry sync.",
    };
  }
}

async function runSync(
  db: D1Database,
  id: string,
  config: WebflowConfig,
  origin: string,
  send: typeof fetch,
): Promise<SyncResult> {
  const lock = crypto.randomUUID();
  const now = Date.now();
  const claim = await db
    .prepare(
      `UPDATE events SET webflow_sync_lock=?, webflow_sync_lock_until=?
    WHERE id=? AND (webflow_sync_lock IS NULL OR webflow_sync_lock_until < ?)`,
    )
    .bind(lock, now + 90000, id, now)
    .run();
  if (!claim.meta.changes)
    return {
      status: "pending",
      message:
        "Webflow sync is already running, or the event was removed. Refresh to check its status.",
    };
  let version: string | null = null;
  try {
    const event = await db
      .prepare(
        `SELECT id, name, slug, starts_at AS startsAt, ends_at AS endsAt,
      summary, description, image, webflow_id AS webflowId, webflow_collection_id AS collectionId,
      webflow_sync_version AS version, webflow_create_slug AS createSlug FROM events WHERE id=?`,
      )
      .bind(id)
      .first<SyncEvent>();
    if (!event) throw new Error("Event not found.");
    version = event.version;
    await db
      .prepare(
        "UPDATE events SET webflow_sync_status='pending', webflow_sync_error=NULL WHERE id=? AND webflow_sync_lock=?",
      )
      .bind(id, lock)
      .run();
    const {
      WEBFLOW_ACCESS_TOKEN: token,
      WEBFLOW_SITE_ID: site,
      WEBFLOW_EVENT_COLLECTION_ID: collection,
    } = config;
    if (!token || !site || !collection)
      throw new Error(
        "Configure WEBFLOW_ACCESS_TOKEN, WEBFLOW_SITE_ID, and WEBFLOW_EVENT_COLLECTION_ID, then retry.",
      );
    if (![site, collection].every((value) => /^[a-f0-9]{24}$/i.test(value)))
      throw new Error("Webflow site and collection IDs must be 24-character IDs.");
    if (event.collectionId && event.collectionId !== collection)
      throw new Error(
        "This event is linked to another Webflow collection. Restore that collection configuration before retrying.",
      );
    const client = new WebflowClient(token, AbortSignal.timeout(45000), send);
    const collections = await client.request(
      `/sites/${site}/collections`,
      z.object({ collections: z.array(z.object({ id: z.string() })) }),
    );
    if (!collections.collections.some((entry) => entry.id === collection))
      throw new Error("The configured Events collection does not belong to WEBFLOW_SITE_ID.");
    const schema = await client.collection(collection);
    const fields = eventFields(schema.fields);
    const data = mapEventContent(event, fields, config.WEBFLOW_ASSET_BASE_URL || origin);
    const references = (
      await db
        .prepare(
          `SELECT r.kind, r.name FROM event_reference_links l
      JOIN event_references r ON r.id=l.reference_id WHERE l.event_id=? ORDER BY r.name`,
        )
        .bind(id)
        .all<{ kind: EventReferenceKind; name: string }>()
    ).results;
    for (const key of REFERENCE_KEYS) {
      const field = fields[key];
      const values = references.filter((reference) => reference.kind === key);
      // Category is intentionally app-only when the CMS has no category field.
      if (!field) {
        if (key !== "category" && values.length)
          throw new Error(`Add a ${key} reference field to the Webflow collection.`);
        continue;
      }
      referenceFieldValue(
        field,
        values.map((value) => value.name),
      ); // Validate cardinality before network I/O.
      const linkedCollection = field.validations?.collectionId;
      if (!linkedCollection)
        throw new Error(`Webflow ${field.displayName} is missing its linked collection.`);
      const ids: string[] = [];
      for (const value of values) {
        const matches = (await client.items(linkedCollection, { name: value.name })).filter(
          (item) => item.fieldData.name === value.name && !item.isArchived,
        );
        if (matches.length !== 1)
          throw new Error(
            `Webflow ${field.displayName}: create one CMS item named "${value.name}" in its linked collection, then retry.`,
          );
        ids.push(matches[0].id);
      }
      data[field.slug] = referenceFieldValue(field, ids);
    }
    for (const field of schema.fields) {
      const value = data[field.slug];
      if (
        field.isRequired &&
        (value === null || value === "" || (Array.isArray(value) && !value.length))
      )
        throw new Error(`Webflow requires ${field.displayName}. Fill it in before retrying.`);
      if (!event.webflowId && field.isRequired && !(field.slug in data))
        throw new Error(
          `Webflow requires an unmapped field: ${field.displayName}. Update the integration mapping.`,
        );
    }
    let itemId = event.webflowId;
    if (!itemId && event.createSlug) {
      // Only recover after our own create attempt, never adopt a pre-existing item on a normal save.
      const found = (await client.items(collection, { slug: event.createSlug })).filter(
        (item) => item.fieldData.slug === event.createSlug,
      );
      if (found.length !== 1)
        throw new Error(
          "Previous Webflow create outcome is uncertain. Check the CMS item before retrying; no duplicate was created.",
        );
      itemId = found[0].id;
    }
    if (itemId) {
      await client.request(
        `/collections/${collection}/items/${encodeURIComponent(itemId)}`,
        itemSchema,
        "PATCH",
        { fieldData: data },
      );
    } else {
      const existing = await client.items(collection, { slug: event.slug });
      if (existing.some((item) => item.fieldData.slug === event.slug))
        throw new Error(
          "An unlinked Webflow item already uses this slug. Choose a different slug; no existing item was overwritten.",
        );
      await db
        .prepare(
          "UPDATE events SET webflow_create_slug=?, webflow_collection_id=? WHERE id=? AND webflow_sync_lock=?",
        )
        .bind(event.slug, collection, id, lock)
        .run();
      try {
        const item = await client.request(`/collections/${collection}/items`, itemSchema, "POST", {
          isDraft: true,
          isArchived: false,
          fieldData: data,
        });
        itemId = item.id;
      } catch (error) {
        // Definitive rejections can retry; network/5xx outcomes require reconciliation.
        if (error instanceof WebflowApiError && error.status < 500)
          await db
            .prepare(
              "UPDATE events SET webflow_create_slug=NULL WHERE id=? AND webflow_sync_lock=?",
            )
            .bind(id, lock)
            .run();
        throw error;
      }
    }
    // Persist the ID before publishing so a publish failure retries the same item.
    await db
      .prepare(
        "UPDATE events SET webflow_id=?, webflow_collection_id=?, webflow_create_slug=NULL WHERE id=? AND webflow_sync_lock=?",
      )
      .bind(itemId, collection, id, lock)
      .run();
    await client.publish(collection, [itemId]);
    const done = await db
      .prepare(
        `UPDATE events SET webflow_sync_status='synced', webflow_sync_error=NULL,
      webflow_synced_at=? WHERE id=? AND webflow_sync_lock=? AND webflow_sync_version IS ?`,
      )
      .bind(new Date().toISOString(), id, lock, version)
      .run();
    if (!done.meta.changes)
      return {
        status: "pending",
        message:
          "A newer edit was saved during publishing. Retry sync to publish the latest version.",
      };
    return { status: "synced", message: "Published to Webflow." };
  } catch (error) {
    // Only messages we construct are returned; the client never includes raw API bodies or credentials.
    const message =
      error instanceof Error ? error.message.slice(0, 600) : "Webflow sync failed. Retry later.";
    const failed = await db
      .prepare(
        `UPDATE events SET webflow_sync_status='failed', webflow_sync_error=?
      WHERE id=? AND webflow_sync_lock=? AND webflow_sync_version IS ?`,
      )
      .bind(message, id, lock, version)
      .run();
    return failed.meta.changes
      ? { status: "failed", message }
      : {
          status: "pending",
          message: "A newer edit is waiting to sync. Retry to publish the latest version.",
        };
  } finally {
    await db
      .prepare(
        "UPDATE events SET webflow_sync_lock=NULL, webflow_sync_lock_until=NULL WHERE id=? AND webflow_sync_lock=?",
      )
      .bind(id, lock)
      .run();
  }
}
