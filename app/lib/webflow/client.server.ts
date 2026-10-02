import { z } from "zod";

export const fieldSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  type: z.string(),
  isRequired: z.boolean(),
  validations: z.object({ collectionId: z.string().optional() }).passthrough().nullish(),
});
export const collectionSchema = z.object({ id: z.string(), fields: z.array(fieldSchema) });
export type CmsField = z.infer<typeof fieldSchema>;
export const itemSchema = z.object({
  id: z.string(),
  isArchived: z.boolean().optional(),
  fieldData: z.record(z.string(), z.unknown()),
});
export type CmsItem = z.infer<typeof itemSchema>;

export class WebflowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Bounded responses, one deadline for the entire sync, and no raw token/API payload in errors. */
export class WebflowClient {
  constructor(
    private token: string,
    private signal: AbortSignal,
    private send: typeof fetch = fetch,
  ) {}

  async request<T>(path: string, schema: z.ZodType<T>, method = "GET", body?: unknown): Promise<T> {
    let response: Response;
    try {
      // Workers' native fetch rejects an arbitrary object as its `this` receiver.
      // Keep the injected transport, but invoke it as a standalone function.
      const send = this.send;
      response = await send(`https://api.webflow.com/v2${path}`, {
        method,
        signal: this.signal,
        // Workers supports follow/manual, not error. Refuse redirects via the
        // non-2xx handling below so the bearer token is never forwarded.
        redirect: "manual",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("Webflow did not respond. Retry sync; the saved event is safe.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      const help: Record<number, string> = {
        400: "Check CMS field validation and required fields.",
        401: "Check WEBFLOW_ACCESS_TOKEN.",
        403: "Give the token CMS read and write access to this site.",
        404: "Check the collection/item ID and token access.",
        409: "Check for a conflicting slug or publishing operation.",
        429: "Webflow rate limit reached. Retry later.",
      };
      throw new WebflowApiError(
        `Webflow returned ${response.status}. ${help[response.status] ?? "Retry later."}`,
        response.status,
      );
    }
    // Webflow's unpublish endpoint returns 204 with no JSON body.
    if (response.status === 204) return schema.parse(undefined);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Webflow returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Webflow response exceeded the safe size limit.");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw new Error("Webflow returned an unexpected response format.");
    }
  }

  collection(id: string) {
    return this.request(`/collections/${encodeURIComponent(id)}`, collectionSchema);
  }

  async items(collectionId: string, filter: { name?: string; slug?: string }): Promise<CmsItem[]> {
    const params = new URLSearchParams({ ...filter, limit: "100", offset: "0" });
    const schema = z.object({
      items: z.array(itemSchema),
      pagination: z.object({ total: z.number() }),
    });
    const results: CmsItem[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      params.set("offset", String(offset));
      const page = await this.request(
        `/collections/${encodeURIComponent(collectionId)}/items?${params}`,
        schema,
      );
      results.push(...page.items);
      if (results.length >= page.pagination.total) return results;
      if (!page.items.length) break;
    }
    throw new Error("Webflow reference lookup is too large. Narrow the CMS item names.");
  }

  async publish(collectionId: string, ids: string[]) {
    const result = await this.request(
      `/collections/${encodeURIComponent(collectionId)}/items/publish`,
      z.object({
        publishedItemIds: z.array(z.string()).optional(),
        errors: z.array(z.string()).optional(),
      }),
      "POST",
      { itemIds: ids },
    );
    if (result.errors?.length || ids.some((id) => !result.publishedItemIds?.includes(id)))
      throw new Error(
        "Webflow saved the CMS item but could not publish it. Check site publishing and retry.",
      );
  }

  async unpublish(collectionId: string, id: string) {
    await this.request(
      `/collections/${encodeURIComponent(collectionId)}/items/live`,
      z.void(),
      "DELETE",
      {
        items: [{ id }],
      },
    );
  }
}
