import { env } from "cloudflare:workers";

import type { Route } from "./+types/email-assets.$";

const ASSET_NAME = /^[0-9a-f-]+\.(?:jpg|png|gif|webp)$/;

/**
 * Public R2 streamer for images embedded in sent emails. Filenames are random
 * UUIDs, and this route can only read the dedicated email-assets prefix.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const name = params["*"];
  if (!name || !ASSET_NAME.test(name)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.BUCKET.get(`email-assets/${name}`);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
