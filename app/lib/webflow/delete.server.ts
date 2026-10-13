import { z } from "zod";
import { WebflowApiError, WebflowClient, itemSchema } from "./client.server";
import type { WebflowConfig } from "./sync.server";

interface DeletingEvent {
  webflowId: string | null;
  collectionId: string | null;
  createSlug: string | null;
  version: string | null;
}

/** Unpublish, then delete only the confirmed event version. Never permanently delete CMS content. */
export async function unpublishAndDeleteEvent(
  db: D1Database,
  id: string,
  config: WebflowConfig,
  send: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const lock = crypto.randomUUID();
  let event: DeletingEvent | null = null;
  let unpublished = false;
  try {
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
        ok: false,
        message:
          "Event not found or Webflow sync is in progress. Wait for sync to finish, then retry deletion.",
      };
    event = await db
      .prepare(
        `SELECT webflow_id AS webflowId, webflow_collection_id AS collectionId,
      webflow_create_slug AS createSlug, webflow_sync_version AS version FROM events WHERE id=?`,
      )
      .bind(id)
      .first<DeletingEvent>();
    if (!event) return { ok: false, message: "Event not found." };
    if (!event.webflowId && event.createSlug)
      throw new Error(
        "A previous Webflow creation is unconfirmed. Retry sync to resolve its CMS item before deleting this event.",
      );
    if (event.webflowId) {
      const {
        WEBFLOW_ACCESS_TOKEN: token,
        WEBFLOW_SITE_ID: site,
        WEBFLOW_EVENT_COLLECTION_ID: configuredCollection,
      } = config;
      const collection = event.collectionId ?? configuredCollection;
      if (!token || !site || !collection)
        throw new Error(
          "Configure the Webflow token, site ID and collection ID before deleting this linked event.",
        );
      if (![site, collection].every((value) => /^[a-f0-9]{24}$/i.test(value)))
        throw new Error("Check the Webflow site and collection IDs before deleting this event.");
      const shared = await db
        .prepare("SELECT id FROM events WHERE webflow_id=? AND id<>? LIMIT 1")
        .bind(event.webflowId, id)
        .first();
      if (shared)
        throw new Error(
          "Another event is linked to the same Webflow item. Resolve the duplicate link before deleting.",
        );
      const client = new WebflowClient(token, AbortSignal.timeout(45000), send);
      const collections = await client.request(
        `/sites/${site}/collections`,
        z.object({ collections: z.array(z.object({ id: z.string() })) }),
      );
      if (!collections.collections.some((value) => value.id === collection))
        throw new Error(
          "The linked collection does not belong to the configured Webflow site. The event was kept.",
        );
      // Validate collection access before treating an item-level 404 as already unpublished.
      await client.collection(collection);
      let live = true;
      try {
        await client.request(
          `/collections/${collection}/items/${encodeURIComponent(event.webflowId)}/live`,
          itemSchema,
        );
      } catch (error) {
        if (error instanceof WebflowApiError && error.status === 404) live = false;
        else throw error;
      }
      if (live) await client.unpublish(collection, event.webflowId);
      unpublished = true;
      // If local deletion later fails, do not keep displaying a stale "Published" status.
      await db
        .prepare(
          `UPDATE events SET webflow_sync_status='pending', webflow_synced_at=NULL,
        webflow_sync_error='Webflow item is unpublished. Retry deletion or sync to publish again.'
        WHERE id=? AND webflow_sync_lock=? AND webflow_sync_version IS ?`,
        )
        .bind(id, lock, event.version)
        .run();
    }
    const deleted = await db
      .prepare(
        "DELETE FROM events WHERE id=? AND webflow_sync_lock=? AND webflow_sync_version IS ?",
      )
      .bind(id, lock, event.version)
      .run();
    if (!deleted.meta.changes)
      return {
        ok: false,
        message:
          "The event changed while deleting and was kept. Review the latest changes before retrying.",
      };
    return {
      ok: true,
      message: unpublished
        ? "Event unpublished from Webflow and deleted. Applications were kept."
        : "Event deleted. Applications were kept.",
    };
  } catch (error) {
    const message = unpublished
      ? "Webflow is unpublished, but local deletion failed. The event was kept; retry deletion."
      : `Event was kept. ${error instanceof Error ? error.message.slice(0, 500) : "Could not unpublish from Webflow. Retry deletion."}`;
    return { ok: false, message };
  } finally {
    // Unlock even when remote unpublishing fails. A storage failure must not mask the original result.
    try {
      await db
        .prepare(
          "UPDATE events SET webflow_sync_lock=NULL, webflow_sync_lock_until=NULL WHERE id=? AND webflow_sync_lock=?",
        )
        .bind(id, lock)
        .run();
    } catch {
      console.error(JSON.stringify({ message: "Event deletion unlock failed", eventId: id }));
    }
  }
}
