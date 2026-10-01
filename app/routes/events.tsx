import { env } from "cloudflare:workers";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CalendarDays, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireAdmin } from "~/lib/auth.server";
import { getEventPhase, type EventWithCounts } from "~/lib/events";
import {
  createEvent,
  deleteEvent,
  listEventsWithCounts,
  updateEvent,
  type EventInput,
} from "~/lib/events.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Events · Mellow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { events: await listEventsWithCounts(env.DB) };
}

function parseEventForm(form: FormData): EventInput | { error: string } {
  const name = String(form.get("name") ?? "").trim();
  const slug = String(form.get("slug") ?? "")
    .trim()
    .toLowerCase();
  if (!name) return { error: "Event name is required." };
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, and dashes." };
  }
  return {
    name,
    slug,
    webflowId: String(form.get("webflowId") ?? "").trim() || null,
    location: String(form.get("location") ?? "").trim() || null,
    startsAt: String(form.get("startsAt") ?? "").trim() || null,
    endsAt: String(form.get("endsAt") ?? "").trim() || null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    const id = String(form.get("eventId") ?? "");
    const ok = await deleteEvent(env.DB, id);
    return ok
      ? { ok: true, message: "Event deleted." }
      : { ok: false, message: "Could not delete event." };
  }

  const parsed = parseEventForm(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  try {
    if (intent === "create") {
      await createEvent(env.DB, parsed);
      return { ok: true, message: "Event created." };
    }
    if (intent === "update") {
      const id = String(form.get("eventId") ?? "");
      const ok = await updateEvent(env.DB, id, parsed);
      return ok
        ? { ok: true, message: "Event updated." }
        : { ok: false, message: "Could not update event." };
    }
  } catch (err) {
    // UNIQUE(slug) / UNIQUE(webflow_id) collisions land here.
    const msg = String(err);
    if (msg.includes("UNIQUE") && msg.includes("slug")) {
      return { ok: false, message: "That slug is already in use." };
    }
    if (msg.includes("UNIQUE")) {
      return { ok: false, message: "That Webflow Item ID is already in use." };
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
  const { events } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">
            Each event scopes its own applicants and stall options. The Webflow Item ID lets the
            public form link submissions to an event.
          </p>
        </div>
        <EventDialog
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
              <Card key={e.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{e.name}</CardTitle>
                        <Badge variant="outline" className={phaseUi.className}>
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
                      <EventDialog
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

function EventDialog({ event, trigger }: { event?: EventWithCounts; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const fetcher = useEventFetcher(() => setOpen(false));
  const busy = fetcher.state !== "idle";
  const editing = event != null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>
            Name and slug are required. The Webflow Item ID is optional — it's the reference the
            public submit form can pass as <code>event</code>.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value={editing ? "update" : "create"} />
          {editing && <input type="hidden" name="eventId" value={event.id} />}

          <div className="grid gap-2">
            <Label htmlFor="name">Event name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={event?.name}
              placeholder="e.g. Mellow Art & Stationery Fair - MEL.01"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                name="slug"
                defaultValue={event?.slug}
                placeholder="mellow-art-stationery-fair-mel-01"
                className="lowercase"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="webflowId">Webflow Item ID</Label>
              <Input
                id="webflowId"
                name="webflowId"
                defaultValue={event?.webflowId ?? ""}
                placeholder="6a223b24e44ab35ad710df07"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              name="location"
              defaultValue={event?.location ?? ""}
              placeholder="e.g. Melbourne"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="startsAt">Start date</Label>
              <Input
                id="startsAt"
                name="startsAt"
                type="date"
                defaultValue={event?.startsAt ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endsAt">End date</Label>
              <Input id="endsAt" name="endsAt" type="date" defaultValue={event?.endsAt ?? ""} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
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
            {event.applicants === 1 ? "" : "s"} are kept but un-scoped from this event.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="eventId" value={event.id} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? "Deleting…" : "Delete event"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
