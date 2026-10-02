import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Pencil, Plus, Settings2, Trash2, RefreshCw } from "lucide-react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";

import type { Route } from "./+types/events";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { EventEditor } from "~/components/event-editor";
import { parseEventForm } from "~/lib/event-form";
import { uploadEmailAsset } from "~/lib/email-assets.server";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { requireAdmin } from "~/lib/auth.server";
import { syncEventToWebflow } from "~/lib/webflow/sync.server";
import { unpublishAndDeleteEvent } from "~/lib/webflow/delete.server";
import { getEventPhase, type EventWithCounts } from "~/lib/events";
import { listEventsWithCounts, listEventReferences, saveEventContent } from "~/lib/events.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Events · Mellow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [events, references] = await Promise.all([
    listEventsWithCounts(env.DB),
    listEventReferences(env.DB),
  ]);
  return { events, references };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireAdmin(request);
  if (Number(request.headers.get("content-length")) > 6 * 1024 * 1024)
    return { ok: false, message: "The upload is too large." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "upload_image") {
    const file = form.get("image");
    if (!(file instanceof File)) return { ok: false, message: "Choose an image first." };
    try {
      const { key } = await uploadEmailAsset(env.BUCKET, file, session.email, "event-assets");
      return { ok: true, message: "Image uploaded.", image: `/${key}` };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  if (intent === "delete") {
    const id = String(form.get("eventId") ?? "");
    return unpublishAndDeleteEvent(env.DB, id, env);
  }

  if (intent === "webflow_sync") {
    const id = String(form.get("eventId") ?? "");
    const exists = await env.DB.prepare("SELECT id FROM events WHERE id=?").bind(id).first();
    if (!exists) return { ok: false, message: "Event not found." };
    const sync = await syncEventToWebflow(env.DB, id, env, new URL(request.url).origin);
    return { ok: sync.status === "synced", message: sync.message, syncStatus: sync.status };
  }

  const parsed = parseEventForm(form);
  if (parsed.errors)
    return { ok: false, message: "Please check the highlighted fields.", errors: parsed.errors };

  try {
    if (intent === "create") {
      const id = `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await saveEventContent(env.DB, null, parsed.input, id);
      const sync = await syncEventToWebflow(env.DB, id, env, new URL(request.url).origin);
      return {
        ok: true,
        message:
          sync.status === "synced"
            ? "Event created and published to Webflow."
            : `Event created. ${sync.message}`,
        syncStatus: sync.status,
      };
    }
    if (intent === "update") {
      const id = String(form.get("eventId") ?? "");
      const ok = await saveEventContent(env.DB, id, parsed.input);
      if (!ok) return { ok: false, message: "Could not update event." };
      const sync = await syncEventToWebflow(env.DB, id, env, new URL(request.url).origin);
      return {
        ok: true,
        message:
          sync.status === "synced"
            ? "Event updated and published to Webflow."
            : `Event updated. ${sync.message}`,
        syncStatus: sync.status,
      };
    }
  } catch (err) {
    // Existing Webflow references are integration-owned and are preserved.
    const msg = String(err);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return {
        ok: false,
        message: "That slug is already in use.",
        errors: { slug: "That slug is already in use." },
      };
    }
    return { ok: false, message: "Could not save event." };
  }

  return { ok: false, message: "Unknown action." };
}

function dateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return "Dates TBC";
  if (!endsAt || endsAt === startsAt) return startsAt;
  return `${startsAt} – ${endsAt}`;
}

const EVENT_PHASE_UI = {
  upcoming: {
    label: "Upcoming",
    className:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  },
  ongoing: {
    label: "Ongoing",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  inactive: {
    label: "Inactive",
    className: "border-muted bg-muted text-muted-foreground",
  },
  unscheduled: {
    label: "Dates TBC",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
} as const;

export default function Events({ loaderData }: Route.ComponentProps) {
  const { events, references } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">
            Manage event content, dates, applicants, and stall options in one place.
          </p>
        </div>
        <EventEditor
          references={references}
          trigger={
            <Button size="sm">
              <Plus className="size-4" />
              Add event
            </Button>
          }
        />
      </div>

      {events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No events yet</CardTitle>
            <CardDescription>
              Add an event to start scoping applicants and stall options.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => {
            const phase = getEventPhase(e);
            const phaseUi = EVENT_PHASE_UI[phase];
            return (
              <Card key={e.id} className="flex min-w-0 flex-col">
                <CardHeader className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <CardTitle className="min-w-0 flex-1 text-base">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="block w-full truncate text-left">
                                {e.name}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="break-words" side="top">
                              {e.name}
                            </TooltipContent>
                          </Tooltip>
                        </CardTitle>
                        <Badge variant="outline" className={`shrink-0 ${phaseUi.className}`}>
                          {phaseUi.label}
                        </Badge>
                      </div>
                      <CardDescription className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" />
                        {dateRange(e.startsAt, e.endsAt)}
                        {e.location ? ` · ${e.location}` : ""}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <EventEditor
                        references={references}
                        event={e}
                        trigger={
                          <Button variant="ghost" size="icon" className="size-8">
                            <Pencil className="size-4" />
                            <span className="sr-only">Edit event</span>
                          </Button>
                        }
                      />
                      <DeleteEventButton event={e} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="flex items-baseline gap-4">
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">{e.applicants}</p>
                      <p className="text-xs text-muted-foreground">Applicants</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                        {e.awaitingReview}
                      </p>
                      <p className="text-xs text-muted-foreground">Awaiting Review</p>
                    </div>
                  </div>
                  <WebflowSyncStatus event={e} />
                </CardContent>
                <CardFooter className="gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <Link to={`/inquiry?event=${e.id}`}>
                      View applicants
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/events/${e.id}`} aria-label="Stall options">
                      <Settings2 className="size-4" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebflowSyncStatus({ event }: { event: EventWithCounts }) {
  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.warning(fetcher.data.message);
  }, [fetcher.state, fetcher.data]);
  const busy = fetcher.state !== "idle";
  return (
    <div className="mt-4 space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={
            event.webflowSyncStatus === "failed" ? "text-destructive" : "text-muted-foreground"
          }
        >
          {event.webflowSyncStatus === "synced"
            ? "Published to Webflow"
            : event.webflowSyncStatus === "failed"
              ? "Webflow sync failed"
              : event.webflowSyncStatus === "pending"
                ? "Webflow sync pending"
                : "Not published to Webflow"}
        </Badge>
        {event.webflowSyncStatus !== "synced" && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="webflow_sync" />
            <input type="hidden" name="eventId" value={event.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={busy}>
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Syncing…" : "Retry sync"}
            </Button>
          </fetcher.Form>
        )}
      </div>
      {event.webflowSyncError && (
        <p className="break-words text-xs text-destructive">{event.webflowSyncError}</p>
      )}
    </div>
  );
}

// Toast + auto-close once a fetcher settles successfully.
function useEventFetcher(onSuccess: () => void) {
  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      onSuccess();
    } else {
      toast.error(fetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  return fetcher;
}

function DeleteEventButton({ event }: { event: EventWithCounts }) {
  const [open, setOpen] = useState(false);
  const fetcher = useEventFetcher(() => setOpen(false));
  const busy = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <Trash2 className="size-4 text-destructive" />
          <span className="sr-only">Delete event</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete event</DialogTitle>
          <DialogDescription>
            Delete <span className="font-medium text-foreground">{event.name}</span>? Its stall
            options are removed. The {event.applicants} application
            {event.applicants === 1 ? "" : "s"} are kept but un-scoped from this event. A linked
            Webflow item will be unpublished first and kept as a CMS draft. If unpublishing fails,
            this event will not be deleted.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="eventId" value={event.id} />
          {fetcher.state === "idle" && fetcher.data && !fetcher.data.ok && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {fetcher.data.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Unpublishing & deleting…" : "Delete event"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
