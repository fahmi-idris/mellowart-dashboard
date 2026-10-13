import { env } from "cloudflare:workers";
import type { Route } from "./+types/event-assets.$";

/** Only public event artwork is exposed; private applicant images stay protected. */
export async function loader({ params }: Route.LoaderArgs) {
  const name = params["*"];
  if (!name || !/^[0-9a-f-]+\.(?:jpg|png|gif|webp)$/.test(name))
    return new Response("Not found", { status: 404 });
  const object = await env.BUCKET.get(`event-assets/${name}`);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
