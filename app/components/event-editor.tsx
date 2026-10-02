import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { ImageIcon, Upload, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { action } from "~/routes/events";
import {
  EVENT_REFERENCE_KINDS,
  type EventReference,
  type EventReferenceKind,
  type EventWithCounts,
} from "~/lib/events";
import { parseEventForm, type EventFormErrors } from "~/lib/event-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { EventDatePicker } from "./event-date-picker";
import { EventReferencePicker } from "./event-reference-picker";
import { EventRichText } from "./event-rich-text";

export function EventEditor({
  event,
  references,
  trigger,
}: {
  event?: EventWithCounts;
  references: EventReference[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle className="text-xl">{event ? "Edit event" : "Create event"}</DialogTitle>
          <DialogDescription>
            Set the essentials, then add content for your event page. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <EditorForm event={event} references={references} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  event,
  references,
  onClose,
}: {
  event?: EventWithCounts;
  references: EventReference[];
  onClose: () => void;
}) {
  const fetcher = useFetcher<typeof action>();
  const upload = useFetcher<typeof action>();
  const handled = useRef<unknown>(null);
  const handledUpload = useRef<unknown>(null);
  const id = useId();
  const [name, setName] = useState(event?.name ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(!!event);
  const [start, setStart] = useState(event?.startsAt?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(event?.endsAt?.slice(0, 10) ?? "");
  const [image, setImage] = useState(event?.image ?? "");
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [selected, setSelected] = useState(
    () =>
      Object.fromEntries(
        EVENT_REFERENCE_KINDS.map((kind) => [
          kind,
          event?.references.filter((ref) => ref.kind === kind).map((ref) => ref.name) ?? [],
        ]),
      ) as Record<EventReferenceKind, string[]>,
  );
  const busy = fetcher.state !== "idle";
  const uploading = upload.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      if ("syncStatus" in fetcher.data && fetcher.data.syncStatus !== "synced")
        toast.warning(fetcher.data.message);
      else toast.success(fetcher.data.message);
      onClose();
    } else {
      setErrors("errors" in fetcher.data ? (fetcher.data.errors ?? {}) : {});
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, fetcher.state, onClose]);
  useEffect(() => {
    if (upload.state !== "idle" || !upload.data || handledUpload.current === upload.data) return;
    handledUpload.current = upload.data;
    if (upload.data.ok && "image" in upload.data && upload.data.image) setImage(upload.data.image);
    else toast.error(upload.data.message);
  }, [upload.data, upload.state]);
  const error = (field: keyof EventFormErrors) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;
  return (
    <fetcher.Form
      method="post"
      noValidate
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onSubmit={(event) => {
        const parsed = parseEventForm(new FormData(event.currentTarget));
        if (parsed.errors) {
          event.preventDefault();
          setErrors(parsed.errors);
          const field = Object.keys(parsed.errors)[0];
          document.getElementById(`${id}-${field}`)?.focus();
        } else setErrors({});
      }}
    >
      <input type="hidden" name="intent" value={event ? "update" : "create"} />
      {event && <input type="hidden" name="eventId" value={event.id} />}
      <input type="hidden" name="startsAt" value={start} />
      <input type="hidden" name="endsAt" value={end} />
      <input type="hidden" name="image" value={image} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={busy} className="min-w-0 space-y-6 px-6 py-5">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Event essentials</h3>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-name`}>Event name *</Label>
                <Input
                  id={`${id}-name`}
                  name="name"
                  value={name}
                  required
                  maxLength={200}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${id}-name-error` : undefined}
                  placeholder="Mellow Art Market — Debut 2026"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugEdited)
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .normalize("NFKD")
                          .replace(/[\u0300-\u036f]/g, "")
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, ""),
                      );
                  }}
                />
                {error("name")}
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-slug`}>Slug *</Label>
                <Input
                  id={`${id}-slug`}
                  name="slug"
                  value={slug}
                  required
                  maxLength={200}
                  aria-invalid={!!errors.slug}
                  aria-describedby={errors.slug ? `${id}-slug-error` : undefined}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                />
                {error("slug")}
                <p className="text-xs text-muted-foreground">
                  Public URL identifier, e.g. mellow-art-market-2026.
                </p>
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-startsAt`}>Start date *</Label>
                <EventDatePicker
                  id={`${id}-startsAt`}
                  value={start}
                  onChange={setStart}
                  max={end || undefined}
                  invalid={!!errors.startsAt}
                />
                {error("startsAt")}
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-endsAt`}>End date *</Label>
                <EventDatePicker
                  id={`${id}-endsAt`}
                  value={end}
                  onChange={setEnd}
                  min={start || undefined}
                  invalid={!!errors.endsAt}
                />
                {error("endsAt")}
              </div>
            </div>
          </section>
          <section className="space-y-4 border-t pt-5">
            <div>
              <h3 className="text-sm font-semibold">Organize your event</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose existing references or add new ones. New choices are available to every event
                after saving.
              </p>
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {EVENT_REFERENCE_KINDS.map((kind) => (
                <div key={kind} className="grid content-start gap-2">
                  <Label>
                    {kind[0].toUpperCase() + kind.slice(1)}{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <EventReferencePicker
                    kind={kind}
                    label={kind[0].toUpperCase() + kind.slice(1)}
                    options={references.filter((ref) => ref.kind === kind).map((ref) => ref.name)}
                    values={selected[kind]}
                    onChange={(values) =>
                      setSelected((previous) => ({ ...previous, [kind]: values }))
                    }
                  />
                </div>
              ))}
            </div>
            {error("references")}
          </section>
          <section className="space-y-4 border-t pt-5">
            <h3 className="text-sm font-semibold">
              Event content <span className="font-normal text-muted-foreground">(optional)</span>
            </h3>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-summary`}>Summary</Label>
              <Textarea
                id={`${id}-summary`}
                name="summary"
                maxLength={2000}
                defaultValue={event?.summary ?? ""}
                placeholder="A short introduction to your event…"
              />
              {error("summary")}
            </div>
            <div className="grid gap-2">
              <Label>Event image</Label>
              <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
                  {image ? (
                    <img
                      src={image}
                      alt="Event image preview"
                      className="size-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {image ? "Event image ready" : "No image uploaded"}
                  </p>
                  <p className="text-xs text-muted-foreground">PNG, JPG, GIF or WebP · Max 5 MB</p>
                </div>
                <Label
                  htmlFor={`${id}-upload`}
                  className={`cursor-pointer ${uploading ? "pointer-events-none opacity-50" : ""}`}
                >
                  <span className="flex items-center gap-1 rounded-lg border bg-background px-3 py-2 text-sm">
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {image ? "Replace" : "Upload"}
                  </span>
                </Label>
                <input
                  id={`${id}-upload`}
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("The image must be 5 MB or smaller.");
                      e.target.value = "";
                      return;
                    }
                    const data = new FormData();
                    data.set("intent", "upload_image");
                    data.set("image", file);
                    upload.submit(data, { method: "post", encType: "multipart/form-data" });
                    e.target.value = "";
                  }}
                />
                {image && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove event image"
                    onClick={() => setImage("")}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
              {error("image")}
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <EventRichText initialValue={event?.description ?? ""} />
              {error("description")}
            </div>
          </section>
        </fieldset>
      </div>
      <DialogFooter className="m-0 shrink-0 rounded-none px-6">
        <p className="mr-auto text-xs text-muted-foreground">Saving also publishes to Webflow.</p>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || uploading}>
          {busy ? "Saving & publishing…" : event ? "Save changes" : "Create event"}
        </Button>
      </DialogFooter>
    </fetcher.Form>
  );
}
