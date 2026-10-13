import { env } from "cloudflare:workers";
import type { Route } from "./+types/api.events";
import { listPublicEvents, parseEventQuery } from "~/lib/public-events.server";

export async function loader({ request }: Route.LoaderArgs) {
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const url = new URL(request.url);
  let query: ReturnType<typeof parseEventQuery>;
  try {
    query = parseEventQuery(url.searchParams);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400, headers });
  }
  return Response.json(await listPublicEvents(env.DB, query, url.origin), { headers });
}
