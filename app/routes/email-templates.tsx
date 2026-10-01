import { env } from "cloudflare:workers";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { data, Link, useBlocker, useFetcher, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  GripVertical,
  Heading,
  Image as ImageIcon,
  List,
  Loader2,
  Minus,
  MousePointerClick,
  Palette,
  Plus,
  ReceiptText,
  Redo2,
  RotateCcw,
  Send,
  Smartphone,
  Tag,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  Zap,
} from "lucide-react";

import type { Route } from "./+types/email-templates";
import { EventCombobox } from "~/components/event-combobox";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Slider } from "~/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { requireAdmin } from "~/lib/auth.server";
import { uploadEmailAsset } from "~/lib/email-assets.server";
import { sendEmail } from "~/lib/gmail.server";
import {
  BLOCK_LABELS,
  type BlockType,
  DEFAULT_TEMPLATES,
  type EmailBlock,
  type EmailBranding,
  MERGE_TAGS,
  normalizeEmailBranding,
  newBlock,
  reorderEmailBlocks,
  sampleContext,
  type BlockDropPosition,
  type TemplateContent,
  type TemplateKey,
  TEMPLATE_KEYS,
  TEMPLATE_META,
} from "~/lib/email-templates";
import {
  getAllTemplates,
  getBranding,
  isTemplateKey,
  publishEventTemplate,
  renderContent,
  saveTemplate,
} from "~/lib/email-templates.server";
import { getGoogleTokens } from "~/lib/google-tokens.server";
import { formatDueDate, getInvoiceSettings } from "~/lib/invoices.server";
import { getEvent, listEventsWithCounts } from "~/lib/events.server";
import { isEventAvailableForTemplates, type EventWithCounts } from "~/lib/events";
import { cn } from "~/lib/utils";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Email templates · Mellow" }];
}

const BLOCK_TYPES: BlockType[] = [
  "hero",
  "image",
  "heading",
  "paragraph",
  "list",
  "button",
  "summary",
  "bank",
  "divider",
  "spacer",
];

const TEMPLATE_ICONS = {
  approval: Check,
  confirmation: Clock3,
  rejection: X,
  waitlist: Clock3,
  withdrawn: RotateCcw,
} as const;

const TEMPLATE_OUTCOMES: Record<TemplateKey, { name: string; sub: string; tone: string }> = {
  approval: { name: "Approved", sub: "Welcome & next steps", tone: "bg-green-100 text-green-700" },
  confirmation: {
    name: "Pending",
    sub: "Application received",
    tone: "bg-stone-100 text-stone-600",
  },
  rejection: { name: "Rejected", sub: "A thoughtful update", tone: "bg-red-100 text-red-600" },
  waitlist: {
    name: "Waitlist",
    sub: "Keep the possibility open",
    tone: "bg-amber-100 text-amber-700",
  },
  withdrawn: {
    name: "Withdrawn",
    sub: "Confirmation & next steps",
    tone: "bg-violet-100 text-violet-700",
  },
};

const BLOCK_ICONS = {
  hero: Tag,
  image: ImageIcon,
  heading: Heading,
  paragraph: Type,
  list: List,
  button: MousePointerClick,
  summary: ReceiptText,
  bank: ReceiptText,
  divider: Minus,
  spacer: Minus,
} as const;

async function loadEmailTemplateData(request: Request, eventSlug?: string) {
  await requireAdmin(request);
  const allEvents = await listEventsWithCounts(env.DB);
  const events = allEvents.filter((event) => isEventAvailableForTemplates(event));
  const requestedEventId = new URL(request.url).searchParams.get("event");
  const event = eventSlug
    ? (events.find((item) => item.slug === eventSlug) ?? null)
    : (events.find((item) => item.id === requestedEventId) ?? events[0] ?? null);
  const [templates, branding, google] = await Promise.all([
    getAllTemplates(env.DB, event?.id),
    getBranding(env.DB, event?.id),
    getGoogleTokens(env.DB),
  ]);
  return {
    events,
    event,
    templates,
    branding,
    thumbnails: Object.fromEntries(
      TEMPLATE_KEYS.map((key) => [
        key,
        renderContent(templates[key], branding, {
          ...sampleContext(key),
          eventName: event?.name ?? "",
        }).html,
      ]),
    ) as Record<TemplateKey, string>,
    gmail: {
      configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      connected: google !== null,
      email: google?.email ?? null,
    },
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const eventSlug = params.eventSlug;
  const templateKey = params.templateKey;
  if (eventSlug && !isTemplateKey(templateKey ?? ""))
    throw data("Template not found", { status: 404 });
  const result = await loadEmailTemplateData(request, eventSlug);
  if (eventSlug && !result.event)
    throw data("Event not found or no longer active", { status: 404 });
  return { ...result, detailKey: eventSlug ? (templateKey as TemplateKey) : null };
}

export const templateDetailPath = (eventSlug: string, key: TemplateKey) =>
  `/email-templates/${encodeURIComponent(eventSlug)}/${key}`;

function parseContent(form: FormData): TemplateContent {
  const blocks = JSON.parse(String(form.get("blocks") ?? "[]")) as unknown;
  if (!Array.isArray(blocks)) throw new Error("Blocks must be an array.");
  return {
    subject: String(form.get("subject") ?? ""),
    preheader: String(form.get("preheader") ?? ""),
    blocks: blocks as EmailBlock[],
  };
}

/**
 * Merge context for previews / test sends. Starts from the sample values, then
 * — for the approval email — overlays the real saved invoice settings (bank
 * details, confirmation form, payment due date) so the preview faithfully shows
 * what recipients actually receive rather than placeholders.
 */
async function previewContext(
  key: TemplateKey,
  eventName: string,
): Promise<Record<string, string>> {
  const ctx = sampleContext(key);
  ctx.eventName = eventName;
  if (key === "approval") {
    const s = await getInvoiceSettings(env.DB);
    ctx.bankAccountName = s.bankAccountName ?? "";
    ctx.bankBsb = s.bankBsb ?? "";
    ctx.bankAccountNumber = s.bankAccountNumber ?? "";
    ctx.confirmationFormUrl = s.confirmationFormUrl ?? "";
    ctx.dueDate = formatDueDate(s.dueDays);
  }
  return ctx;
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "upload_image") {
      const image = form.get("image");
      if (!(image instanceof File)) {
        return { ok: false, intent: "upload_image" as const, message: "Choose an image first." };
      }
      const { key } = await uploadEmailAsset(env.BUCKET, image, session.email);
      return {
        ok: true,
        intent: "upload_image" as const,
        message: "Image uploaded.",
        imageUrl: `${new URL(request.url).origin}/${key}`,
      };
    }

    const eventId = String(form.get("eventId") ?? "");
    const event = eventId ? await getEvent(env.DB, eventId) : null;
    if (!event) return { ok: false, message: "Choose an event before editing templates." };

    if (intent === "preview") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      const brandingJson = form.get("branding");
      const branding = brandingJson
        ? (JSON.parse(String(brandingJson)) as EmailBranding)
        : await getBranding(env.DB, eventId);
      const rendered = renderContent(content, branding, await previewContext(key, event.name), {
        includeBlockMarkers: true,
      });
      return {
        ok: true,
        intent: "preview" as const,
        previewHtml: rendered.html,
        previewSubject: rendered.subject,
      };
    }

    if (intent === "save_template") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      if (!content.subject.trim()) return { ok: false, message: "Subject can't be empty." };
      await saveTemplate(env.DB, key, content, session.email, eventId);
      return { ok: true, message: `Saved “${TEMPLATE_META[key].label}”.` };
    }

    if (intent === "publish_template") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      if (!content.subject.trim()) return { ok: false, message: "Subject can't be empty." };
      const rawBranding = JSON.parse(
        String(form.get("branding") ?? "null"),
      ) as EmailBranding | null;
      if (!rawBranding) return { ok: false, message: "Brand style is missing." };
      const branding = normalizeEmailBranding(rawBranding);
      await publishEventTemplate(env.DB, eventId, key, content, branding, session.email);
      return { ok: true, message: `Published “${TEMPLATE_META[key].label}” for ${event.name}.` };
    }

    if (intent === "send_test") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      const brandingJson = form.get("branding");
      const branding = brandingJson
        ? (JSON.parse(String(brandingJson)) as EmailBranding)
        : await getBranding(env.DB, eventId);
      const rendered = renderContent(content, branding, await previewContext(key, event.name));
      await sendEmail(env, {
        to: session.email,
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        fromName: branding.fromName,
      });
      return { ok: true, message: `Test sent to ${session.email}.` };
    }

    return { ok: false, message: "Unknown action." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function EmailTemplates({ loaderData }: Route.ComponentProps) {
  const { events, event, templates, branding, thumbnails, gmail, detailKey } = loaderData;
  const [, setSearchParams] = useSearchParams();
  if (detailKey && event) {
    return (
      <EventTemplateWorkspace
        key={`${event.id}:${detailKey}`}
        event={event}
        events={events}
        templates={templates}
        thumbnails={thumbnails}
        initialBranding={branding}
        gmail={gmail}
        initialSelected={detailKey}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {event?.name ?? "Email templates"}
          </h1>
          <p className="text-sm text-muted-foreground">Status-linked templates for this event.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Event</span>
          <EventCombobox
            events={events}
            value={event?.id}
            disabled={events.length === 0}
            showPhase
            onValueChange={(eventId) => setSearchParams({ event: eventId })}
            className="w-72 max-w-full bg-background"
          />
        </div>
      </div>
      {event ? (
        <EventTemplateWorkspace
          key={event.id}
          event={event}
          templates={templates}
          thumbnails={thumbnails}
          initialBranding={branding}
          gmail={gmail}
        />
      ) : (
        <div className="rounded-xl border bg-card p-10 text-center">
          <h2 className="text-lg font-semibold">No current or upcoming event found</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Create an event, or update an existing event’s dates, before editing its email
            templates.
          </p>
          <Button asChild className="mt-5">
            <Link to="/events">Create event</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

export function EventTemplateWorkspace({
  event,
  events,
  templates,
  thumbnails,
  initialBranding,
  gmail,
  initialSelected,
}: {
  event: EventWithCounts;
  events?: EventWithCounts[];
  templates: Record<TemplateKey, TemplateContent>;
  thumbnails: Record<TemplateKey, string>;
  initialBranding: EmailBranding;
  gmail: { configured: boolean; connected: boolean; email: string | null };
  initialSelected?: TemplateKey;
}) {
  const navigate = useNavigate();
  const [selected] = useState<TemplateKey>(initialSelected ?? TEMPLATE_KEYS[0]);
  const detailMode = initialSelected !== undefined;
  const [drafts, setDrafts] = useState<Record<TemplateKey, TemplateContent>>(() =>
    structuredClone(templates),
  );
  const [savedTemplates, setSavedTemplates] = useState<Record<TemplateKey, TemplateContent>>(() =>
    structuredClone(templates),
  );
  const [branding, setBranding] = useState<EmailBranding>(initialBranding);
  const [savedBranding, setSavedBranding] = useState<EmailBranding>(() =>
    structuredClone(initialBranding),
  );
  const hasUnsavedChanges = useMemo(
    () =>
      TEMPLATE_KEYS.some(
        (key) => JSON.stringify(drafts[key]) !== JSON.stringify(savedTemplates[key]),
      ) || JSON.stringify(branding) !== JSON.stringify(savedBranding),
    [branding, drafts, savedBranding, savedTemplates],
  );

  const markTemplateSaved = useCallback((key: TemplateKey, saved: TemplateContent) => {
    setSavedTemplates((current) => ({ ...current, [key]: saved }));
  }, []);

  const markBrandingSaved = useCallback((saved: EmailBranding) => {
    setSavedBranding(saved);
  }, []);
  const navigationBlocker = useBlocker(hasUnsavedChanges);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  return (
    <div className="flex flex-col gap-6">
      {!detailMode ? (
        <div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">
          {TEMPLATE_KEYS.map((key) => (
            <Card
              key={key}
              className="h-full gap-0 py-0 shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                className="flex h-full w-full flex-col text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                onClick={() => navigate(templateDetailPath(event.slug, key))}
              >
                <div className="h-44 w-full shrink-0 overflow-hidden border-b bg-[#F5F5F0]">
                  <iframe
                    title={TEMPLATE_META[key].label + " thumbnail"}
                    srcDoc={thumbnails[key]}
                    sandbox=""
                    tabIndex={-1}
                    aria-hidden="true"
                    className="pointer-events-none block h-88 w-[200%] origin-top-left scale-50 border-0 bg-[#F5F5F0]"
                  />
                </div>
                <div className="flex min-h-40 w-full flex-1 flex-col gap-2 p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="size-2 shrink-0 rounded-full bg-green-600" />
                    {TEMPLATE_META[key].label}
                  </div>
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                    {templates[key].subject}
                  </p>
                  <span className="mt-auto self-start rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {TEMPLATE_META[key].trigger}
                  </span>
                </div>
              </button>
            </Card>
          ))}
        </div>
      ) : (
        <TemplateEditor
          key={selected}
          event={event}
          templateKey={selected}
          content={drafts[selected]}
          branding={branding}
          gmail={gmail}
          events={events ?? []}
          isDirty={JSON.stringify(drafts[selected]) !== JSON.stringify(savedTemplates[selected])}
          isBrandingDirty={JSON.stringify(branding) !== JSON.stringify(savedBranding)}
          onBack={() => navigate(`/email-templates?event=${encodeURIComponent(event.id)}`)}
          onSelectTemplate={(key) => navigate(templateDetailPath(event.slug, key))}
          onSelectEvent={(slug) => navigate(templateDetailPath(slug, selected))}
          onBrandingChange={setBranding}
          onBrandingSaved={markBrandingSaved}
          onChange={(next) => setDrafts((d) => ({ ...d, [selected]: next }))}
          onSaved={markTemplateSaved}
        />
      )}

      <Dialog
        open={navigationBlocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && navigationBlocker.state === "blocked") navigationBlocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this page?</DialogTitle>
            <DialogDescription>
              You have unsaved template or branding changes. If you leave now, those changes will be
              lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => navigationBlocker.state === "blocked" && navigationBlocker.reset()}
            >
              Stay on page
            </Button>
            <Button
              variant="destructive"
              onClick={() => navigationBlocker.state === "blocked" && navigationBlocker.proceed()}
            >
              Leave without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ActionData = {
  ok: boolean;
  message?: string;
  intent?: "preview" | "upload_image";
  previewHtml?: string;
  previewSubject?: string;
  imageUrl?: string;
};

function TemplateEditor({
  event,
  events,
  templateKey,
  content,
  branding,
  gmail,
  isDirty,
  isBrandingDirty,
  onBack,
  onSelectTemplate,
  onSelectEvent,
  onBrandingChange,
  onBrandingSaved,
  onChange,
  onSaved,
}: {
  event: EventWithCounts;
  events: EventWithCounts[];
  templateKey: TemplateKey;
  content: TemplateContent;
  branding: EmailBranding;
  gmail: { configured: boolean; connected: boolean; email: string | null };
  isDirty: boolean;
  isBrandingDirty: boolean;
  onBack: () => void;
  onSelectTemplate: (key: TemplateKey) => void;
  onSelectEvent: (slug: string) => void;
  onBrandingChange: (branding: EmailBranding) => void;
  onBrandingSaved: (branding: EmailBranding) => void;
  onChange: (next: TemplateContent) => void;
  onSaved: (key: TemplateKey, saved: TemplateContent) => void;
}) {
  const meta = TEMPLATE_META[templateKey];
  const tags = MERGE_TAGS[templateKey];
  const previewFetcher = useFetcher<ActionData>();
  const saveFetcher = useFetcher<ActionData>();
  const testFetcher = useFetcher<ActionData>();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    () => content.blocks[0]?.id ?? null,
  );
  const selectedBlockRef = useRef<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"block" | "brand">("block");
  const [paletteMode, setPaletteMode] = useState<"add" | "outline">("add");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewMode, setPreviewMode] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewDocumentVersion, setPreviewDocumentVersion] = useState(0);
  const [history, setHistory] = useState<{
    past: { content: TemplateContent; branding: EmailBranding }[];
    future: { content: TemplateContent; branding: EmailBranding }[];
  }>({ past: [], future: [] });
  const selectedBlock = content.blocks.find((block) => block.id === selectedBlockId);
  selectedBlockRef.current = selectedBlockId;
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: BlockDropPosition;
  } | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const [pendingAction, setPendingAction] = useState<
    { type: "remove"; block: EmailBlock } | { type: "reset" } | null
  >(null);
  const previewIframe = useRef<HTMLIFrameElement | null>(null);
  const previewActionRef = useRef<(id: string, action: string) => void>(() => {});
  const reorderPreviewRef = useRef<
    (sourceId: string, targetId: string, position: BlockDropPosition) => void
  >(() => {});
  const previewScrollTop = useRef(0);
  const pendingPreviewBlockId = useRef<string | null | undefined>(undefined);
  const pendingSavedContent = useRef<TemplateContent | null>(null);
  const pendingSavedBranding = useRef<EmailBranding | null>(null);

  const recordChange = (nextContent: TemplateContent, nextBranding = branding) => {
    setHistory((current) => ({
      past: [
        ...current.past,
        { content: structuredClone(content), branding: structuredClone(branding) },
      ].slice(-50),
      future: [],
    }));
    if (nextContent !== content) onChange(nextContent);
    if (nextBranding !== branding) onBrandingChange(nextBranding);
  };

  const undo = () => {
    const previous = history.past.at(-1);
    if (!previous) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [
        { content: structuredClone(content), branding: structuredClone(branding) },
        ...history.future,
      ],
    });
    onChange(previous.content);
    onBrandingChange(previous.branding);
  };

  const redo = () => {
    const next = history.future[0];
    if (!next) return;
    setHistory({
      past: [
        ...history.past,
        { content: structuredClone(content), branding: structuredClone(branding) },
      ],
      future: history.future.slice(1),
    });
    onChange(next.content);
    onBrandingChange(next.branding);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const scrollPreviewToPendingBlock = useCallback(() => {
    const blockId = pendingPreviewBlockId.current;
    const frame = previewIframe.current;
    const document = frame?.contentDocument;
    const frameWindow = frame?.contentWindow;
    if (!document || !frameWindow) return;

    const style = document.createElement("style");
    style.textContent = `[data-email-block-id]{cursor:grab;position:relative} [data-email-block-id]:active{cursor:grabbing} [data-email-block-id]:hover{outline:2px solid #a3a3a3;outline-offset:-2px} [data-email-block-id].email-block-selected{outline:2px solid #2C2422;outline-offset:-2px} [data-email-block-id].email-drop-before{box-shadow:inset 0 4px #7c3aed} [data-email-block-id].email-drop-after{box-shadow:inset 0 -4px #7c3aed} [data-email-branding]{position:relative;cursor:pointer} [data-email-branding]:hover{outline:2px dashed #a8a29e;outline-offset:-2px} [data-email-branding]:hover:after{content:'Shared branding — click to edit';position:absolute;right:8px;top:8px;background:white;color:#2C2422;border:1px solid #ddd;border-radius:99px;padding:5px 9px;font:11px Arial;box-shadow:0 2px 8px #0002} [data-editor-toolbar]{position:absolute;right:0;top:-30px;z-index:10;display:flex;gap:2px;background:#2C2422;color:white;border-radius:8px 8px 0 0;padding:3px} [data-editor-toolbar] button{display:flex;align-items:center;justify-content:center;width:26px;height:24px;border:0;background:transparent;color:white;cursor:pointer} [data-editor-toolbar] button:hover{background:#ffffff30;border-radius:4px} [data-editor-label]{position:absolute;left:0;top:-30px;z-index:10;background:#2C2422;color:white;border-radius:8px 8px 0 0;padding:7px 9px;font:11px Arial}`;
    document.head.appendChild(style);
    const previewBlocks = Array.from(
      document.querySelectorAll<HTMLElement>("[data-email-block-id]"),
    );
    const clearDropIndicators = () => {
      previewBlocks.forEach((element) =>
        element.classList.remove("email-drop-before", "email-drop-after"),
      );
    };
    previewBlocks.forEach((element) => {
      element.classList.toggle(
        "email-block-selected",
        element.dataset.emailBlockId === selectedBlockRef.current,
      );
      element.draggable = true;
      element.addEventListener("dragstart", (event) => {
        const id = element.dataset.emailBlockId;
        if (!id || !event.dataTransfer) return;
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
        setDraggedBlockId(id);
      });
      element.addEventListener("dragover", (event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearDropIndicators();
        const position =
          event.clientY <
          element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
            ? "before"
            : "after";
        element.classList.add(position === "before" ? "email-drop-before" : "email-drop-after");
      });
      element.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = event.dataTransfer?.getData("text/plain");
        const targetId = element.dataset.emailBlockId;
        const position = element.classList.contains("email-drop-after") ? "after" : "before";
        clearDropIndicators();
        if (sourceId && targetId) reorderPreviewRef.current(sourceId, targetId, position);
        setDraggedBlockId(null);
      });
      element.addEventListener("dragend", () => {
        clearDropIndicators();
        setDraggedBlockId(null);
      });
    });
    document.addEventListener("click", (event) => {
      event.preventDefault();
      const target = event.target as Element | null;
      const block = target?.closest<HTMLElement>("[data-email-block-id]");
      if (block?.dataset.emailBlockId) {
        setSelectedBlockId(block.dataset.emailBlockId);
        setInspectorTab("block");
      } else {
        setSelectedBlockId(null);
        setInspectorTab("brand");
        if (target?.closest("[data-email-branding]"))
          toast.message("Header and footer branding is shared across this event's templates.");
      }
    });

    // Updating srcDoc creates a new document at scroll position 0. Restore the
    // previous position before moving to a changed block so the preview does
    // not visibly restart from the top after every edit.
    frameWindow.scrollTo({ top: previewScrollTop.current, behavior: "auto" });
    if (blockId === undefined) return;

    if (blockId === null) {
      frameWindow.scrollTo({ top: 0, behavior: "auto" });
    } else {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>("[data-email-block-id]"),
      ).find((element) => element.dataset.emailBlockId === blockId);
      frameWindow.requestAnimationFrame(() => {
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.animate(
          [
            { boxShadow: "inset 0 0 0 2px transparent" },
            { boxShadow: "inset 0 0 0 2px #7c3aed" },
            { boxShadow: "inset 0 0 0 2px transparent" },
          ],
          { duration: 1200, easing: "ease-out" },
        );
      });
    }

    pendingPreviewBlockId.current = undefined;
  }, []);

  useEffect(() => {
    const document = previewIframe.current?.contentDocument;
    if (!document) return;
    let toolbarRoot: ReturnType<typeof createRoot> | null = null;
    document
      .querySelectorAll("[data-editor-toolbar],[data-editor-label]")
      .forEach((element) => element.remove());
    document.querySelectorAll("[data-email-block-id]").forEach((element) => {
      const selected = (element as HTMLElement).dataset.emailBlockId === selectedBlockId;
      element.classList.toggle("email-block-selected", selected);
      if (selected) {
        const block = content.blocks.find((item) => item.id === selectedBlockId);
        if (!block) return;
        const label = document.createElement("span");
        label.dataset.editorLabel = "";
        label.textContent = BLOCK_LABELS[block.type];
        const toolbar = document.createElement("span");
        toolbar.dataset.editorToolbar = "";
        element.appendChild(label);
        element.appendChild(toolbar);
        toolbarRoot = createRoot(toolbar);
        toolbarRoot.render(
          <>
            {(
              [
                ["up", "Move up", ArrowUp],
                ["down", "Move down", ArrowDown],
                ["copy", "Copy block", Copy],
                ["delete", "Delete block", Trash2],
              ] as const
            ).map(([action, title, Icon]) => (
              <button
                key={action}
                type="button"
                title={title}
                aria-label={title}
                onClick={(event) => {
                  event.stopPropagation();
                  previewActionRef.current(block.id, action);
                }}
              >
                <Icon size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            ))}
          </>,
        );
      }
    });
    return () => {
      toolbarRoot?.unmount();
    };
  }, [selectedBlockId, previewFetcher.data?.previewHtml, previewDocumentVersion, content.blocks]);

  // Debounced live preview whenever the working copy changes.
  const refreshPreview = useCallback(() => {
    const frameWindow = previewIframe.current?.contentWindow;
    if (frameWindow) previewScrollTop.current = frameWindow.scrollY;

    previewFetcher.submit(
      {
        intent: "preview",
        eventId: event.id,
        key: templateKey,
        subject: content.subject,
        preheader: content.preheader,
        blocks: JSON.stringify(content.blocks),
        branding: JSON.stringify(branding),
      },
      { method: "post" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, content, branding, event.id]);

  useEffect(() => {
    const t = setTimeout(refreshPreview, 500);
    return () => clearTimeout(t);
  }, [refreshPreview]);

  useEffect(() => {
    const d = saveFetcher.data;
    if (!d || saveFetcher.state !== "idle") return;

    if (d.ok) {
      toast.success(d.message);
      if (pendingSavedContent.current) onSaved(templateKey, pendingSavedContent.current);
      if (pendingSavedBranding.current) onBrandingSaved(pendingSavedBranding.current);
      setReviewOpen(false);
    } else {
      toast.error(d.message);
    }
    pendingSavedContent.current = null;
    pendingSavedBranding.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data, saveFetcher.state, onSaved, templateKey]);

  useEffect(() => {
    const d = testFetcher.data;
    if (d && testFetcher.state === "idle") d.ok ? toast.success(d.message) : toast.error(d.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testFetcher.data, testFetcher.state]);

  const update = (patch: Partial<TemplateContent>) => recordChange({ ...content, ...patch });

  const setBlocks = (blocks: EmailBlock[]) => update({ blocks });

  const reorderBlock = (sourceId: string, targetId: string, position: BlockDropPosition) => {
    const next = reorderEmailBlocks(content.blocks, sourceId, targetId, position);
    if (
      next === content.blocks ||
      next.every((block, index) => block.id === content.blocks[index].id)
    )
      return;
    const block = next.find((item) => item.id === sourceId);
    setSelectedBlockId(sourceId);
    setInspectorTab("block");
    pendingPreviewBlockId.current = sourceId;
    if (block) {
      setMoveAnnouncement(
        `${BLOCK_LABELS[block.type]} block moved to position ${next.findIndex((item) => item.id === sourceId) + 1} of ${next.length}.`,
      );
    }
    setBlocks(next);
  };
  reorderPreviewRef.current = reorderBlock;

  const updateBlock = (id: string, patch: Record<string, unknown>) => {
    pendingPreviewBlockId.current = id;
    setBlocks(content.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));
  };

  const moveBlock = (block: EmailBlock, idx: number, dir: -1 | 1) => {
    const next = [...content.blocks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    pendingPreviewBlockId.current = block.id;
    setMoveAnnouncement(
      `${BLOCK_LABELS[block.type]} block moved to position ${j + 1} of ${next.length}.`,
    );
    setBlocks(next);
  };

  const removeBlock = (id: string) => {
    const index = content.blocks.findIndex((block) => block.id === id);
    pendingPreviewBlockId.current =
      content.blocks[index + 1]?.id ?? content.blocks[index - 1]?.id ?? null;
    setBlocks(content.blocks.filter((block) => block.id !== id));
  };

  const addBlock = (type: BlockType) => {
    const block = newBlock(type);
    setSelectedBlockId(block.id);
    setInspectorTab("block");
    pendingPreviewBlockId.current = block.id;
    setBlocks([...content.blocks, block]);
  };

  previewActionRef.current = (id, action) => {
    const index = content.blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const block = content.blocks[index];
    if (action === "up" || action === "down") moveBlock(block, index, action === "up" ? -1 : 1);
    if (action === "copy") {
      const copied = { ...structuredClone(block), id: crypto.randomUUID() } as EmailBlock;
      const next = [...content.blocks];
      next.splice(index + 1, 0, copied);
      setSelectedBlockId(copied.id);
      pendingPreviewBlockId.current = copied.id;
      setBlocks(next);
    }
    if (action === "delete") setPendingAction({ type: "remove", block });
  };

  const submitPayload = (intent: string) => ({
    intent,
    eventId: event.id,
    key: templateKey,
    subject: content.subject,
    preheader: content.preheader,
    blocks: JSON.stringify(content.blocks),
    branding: JSON.stringify(branding),
  });

  const publishCurrentTemplate = () => {
    pendingSavedContent.current = structuredClone(content);
    pendingSavedBranding.current = structuredClone(branding);
    saveFetcher.submit(submitPayload("publish_template"), { method: "post" });
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;

    if (pendingAction.type === "remove") {
      removeBlock(pendingAction.block.id);
      toast.message(`${BLOCK_LABELS[pendingAction.block.type]} block removed from the draft.`);
    } else {
      const defaultBlockId = DEFAULT_TEMPLATES[templateKey].blocks[0]?.id ?? null;
      setSelectedBlockId(defaultBlockId);
      setInspectorTab("block");
      pendingPreviewBlockId.current = defaultBlockId;
      recordChange(structuredClone(DEFAULT_TEMPLATES[templateKey]));
      toast.message("Reset to default (not yet saved).");
    }

    setPendingAction(null);
  };

  const copyTag = (tag: string) => {
    navigator.clipboard.writeText(`{{${tag}}}`);
    toast.success(`Copied {{${tag}}}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" /> All templates
        </Button>
        <span className="hidden h-6 border-l sm:block" />
        <span className="font-semibold">{meta.label}</span>
        <Badge variant="secondary">Active</Badge>
        <span className="ml-2 text-xs text-muted-foreground">Event</span>
        <EventCombobox
          events={events}
          value={event.id}
          showPhase
          onValueChange={(id) => {
            const selected = events.find((option) => option.id === id);
            if (selected) onSelectEvent(selected.slug);
          }}
          className="h-8 max-w-72 text-xs"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(isDirty || isBrandingDirty) && <Badge variant="outline">Unsaved changes</Badge>}
          <Button variant="outline" size="sm" onClick={() => setPreviewMode((value) => !value)}>
            <Eye className="size-4" /> {previewMode ? "Exit preview" : "Preview"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testFetcher.submit(submitPayload("send_test"), { method: "post" })}
            disabled={!gmail.connected || testFetcher.state !== "idle"}
            title={
              gmail.connected
                ? "Send a sample to your signed-in admin email"
                : gmail.configured
                  ? "Connect Gmail in Invoice settings to send tests"
                  : "Configure Google OAuth credentials and restart the local server"
            }
          >
            <Send className="size-4" /> {testFetcher.state !== "idle" ? "Sending…" : "Send test"}
          </Button>
          {!gmail.connected &&
            (gmail.configured ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/invoice-settings">Connect Gmail</Link>
              </Button>
            ) : (
              <span className="max-w-40 text-xs text-muted-foreground">
                Add Google OAuth credentials, then restart the server.
              </span>
            ))}
          <Button
            size="sm"
            onClick={() => setReviewOpen(true)}
            disabled={saveFetcher.state !== "idle"}
          >
            Review email <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid min-h-[calc(100vh-57px)]",
          previewMode ? "grid-cols-1" : "lg:grid-cols-[260px_minmax(0,1fr)_380px]",
        )}
      >
        {!previewMode && (
          <aside className="border-b bg-background lg:border-b-0 lg:border-r">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Application emails</h3>
              <p className="text-xs text-muted-foreground">The right message for every outcome.</p>
            </div>
            <div className="grid gap-1 p-2">
              {TEMPLATE_KEYS.map((key) => {
                const Icon = TEMPLATE_ICONS[key];
                const outcome = TEMPLATE_OUTCOMES[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectTemplate(key)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted",
                      templateKey === key && "bg-muted font-semibold",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        outcome.tone,
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block">{outcome.name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {outcome.sub}
                      </span>
                    </span>
                    {templateKey === key && (
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t p-2">
              <div className="grid grid-cols-2 rounded-lg bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded-md py-1.5",
                    paletteMode === "add" && "bg-background shadow-sm",
                  )}
                  onClick={() => setPaletteMode("add")}
                >
                  Add blocks
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md py-1.5",
                    paletteMode === "outline" && "bg-background shadow-sm",
                  )}
                  onClick={() => setPaletteMode("outline")}
                >
                  Outline
                </button>
              </div>
              {paletteMode === "add" ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {BLOCK_TYPES.map((type) => {
                    const Icon = BLOCK_ICONS[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => addBlock(type)}
                        className="min-h-16 rounded-lg border px-2 py-2 text-center text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon className="mx-auto mb-1 size-4" />
                        {BLOCK_LABELS[type]}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 grid gap-1">
                  {content.blocks.map((block, index) => (
                    <button
                      key={block.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", block.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedBlockId(block.id);
                      }}
                      onDragEnd={() => {
                        setDraggedBlockId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const position =
                          event.clientY <
                          event.currentTarget.getBoundingClientRect().top +
                            event.currentTarget.getBoundingClientRect().height / 2
                            ? "before"
                            : "after";
                        setDropTarget({ id: block.id, position });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = draggedBlockId || event.dataTransfer.getData("text/plain");
                        const position =
                          event.clientY <
                          event.currentTarget.getBoundingClientRect().top +
                            event.currentTarget.getBoundingClientRect().height / 2
                            ? "before"
                            : "after";
                        reorderBlock(sourceId, block.id, position);
                        setDraggedBlockId(null);
                        setDropTarget(null);
                      }}
                      onClick={() => {
                        setSelectedBlockId(block.id);
                        setInspectorTab("block");
                        pendingPreviewBlockId.current = block.id;
                        previewIframe.current?.contentDocument
                          ?.querySelector('[data-email-block-id="' + block.id + '"]')
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted",
                        selectedBlockId === block.id && "bg-muted font-semibold",
                        dropTarget?.id === block.id &&
                          (dropTarget.position === "before"
                            ? "border-t-2 border-t-primary"
                            : "border-b-2 border-b-primary"),
                      )}
                    >
                      <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />{" "}
                      <span className="truncate">
                        {index + 1}. {BLOCK_LABELS[block.type]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        <main className="min-w-0 bg-muted/40">
          <div className="relative flex items-center justify-center gap-1 border-b bg-background p-2 text-xs">
            {!previewMode && (
              <div className="absolute left-2 flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={!history.past.length}
                  onClick={undo}
                  aria-label="Undo"
                  title="Undo"
                >
                  <Undo2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={!history.future.length}
                  onClick={redo}
                  aria-label="Redo"
                  title="Redo"
                >
                  <Redo2 className="size-4" />
                </Button>
              </div>
            )}
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5",
                device === "desktop" && "bg-muted font-medium",
              )}
              onClick={() => setDevice("desktop")}
            >
              <span className="flex items-center gap-1">
                <Eye className="size-3.5" /> Desktop
              </span>
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5",
                device === "mobile" && "bg-muted font-medium",
              )}
              onClick={() => setDevice("mobile")}
            >
              <span className="flex items-center gap-1">
                <Smartphone className="size-3.5" /> Mobile
              </span>
            </button>
          </div>
          <div className="mx-auto max-w-[720px] p-4 sm:p-6">
            <h2 className="text-xl font-semibold">{meta.label}</h2>
            <p className="mb-4 text-sm text-muted-foreground">· {meta.trigger}</p>
            <div className="overflow-hidden rounded-lg border bg-background">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
                onClick={() => setDetailsExpanded((value) => !value)}
                aria-expanded={detailsExpanded}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">
                    {previewFetcher.data?.previewSubject ?? content.subject}
                  </strong>
                  <span className="block truncate text-xs text-muted-foreground">
                    {content.preheader}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    detailsExpanded && "rotate-180",
                  )}
                />
              </button>
              {detailsExpanded && (
                <div className="grid gap-3 border-t p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Status</p>
                      <Badge
                        variant="outline"
                        className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-800"
                      >
                        <span className="size-1.5 rounded-full bg-emerald-600" /> Active
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        Ready for this event after publishing.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Trigger</p>
                      <p className="inline-flex max-w-full items-start gap-1.5 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">
                        <Zap className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        {meta.trigger}
                      </p>
                    </div>
                  </div>
                  <Field label="Subject">
                    <Input
                      value={content.subject}
                      onChange={(event) => update({ subject: event.target.value })}
                    />
                  </Field>
                  <Field label="Preheader (inbox preview text)">
                    <Input
                      value={content.preheader}
                      onChange={(event) => update({ preheader: event.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
            {!previewMode && (
              <p className="my-4 text-center text-xs text-muted-foreground">
                Click any block to edit it. Click the header or footer to edit brand style.
              </p>
            )}
            <div
              className={cn(
                "mx-auto mt-4 overflow-hidden border bg-white shadow-sm transition-[max-width] duration-300 ease-in-out motion-reduce:transition-none",
                device === "mobile" ? "max-w-[390px]" : "max-w-[720px]",
              )}
            >
              <iframe
                ref={previewIframe}
                title="Email preview"
                sandbox="allow-same-origin"
                className="h-[72vh] w-full bg-white"
                srcDoc={previewFetcher.data?.previewHtml ?? ""}
                onLoad={() => {
                  scrollPreviewToPendingBlock();
                  setPreviewDocumentVersion((version) => version + 1);
                }}
              />
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Preview uses sample applicant data. Conditional blocks may be hidden in real sends.
            </p>
          </div>
        </main>

        {!previewMode && (
          <aside className="min-w-0 border-t bg-background lg:border-l lg:border-t-0">
            <div className="grid grid-cols-2 border-b text-sm">
              <button
                type="button"
                className={cn(
                  "flex items-center justify-center gap-1.5 border-b-2 py-3",
                  inspectorTab === "block"
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => setInspectorTab("block")}
              >
                <ReceiptText className="size-4" /> Block
              </button>
              <button
                type="button"
                className={cn(
                  "flex items-center justify-center gap-1.5 border-b-2 py-3",
                  inspectorTab === "brand"
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => setInspectorTab("brand")}
              >
                <Palette className="size-4" /> Brand style
              </button>
            </div>
            <div className="max-h-[85vh] overflow-y-auto p-3">
              {inspectorTab === "brand" ? (
                <BrandingEditor
                  branding={branding}
                  onChange={(next) => recordChange(content, next)}
                />
              ) : selectedBlock ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">Selected block</h3>
                    <p className="text-xs text-muted-foreground">Make this block your own.</p>
                  </div>
                  <BlockInspector
                    block={selectedBlock}
                    onRemove={() => setPendingAction({ type: "remove", block: selectedBlock })}
                    onChange={(patch) => updateBlock(selectedBlock.id, patch)}
                  />
                  <div className="border-t pt-3">
                    <p className="mb-2 text-xs font-semibold">Personalize & link</p>
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <button
                          key={tag.tag}
                          type="button"
                          onClick={() => copyTag(tag.tag)}
                          className="rounded border bg-muted/30 px-1.5 py-1 font-mono text-[11px] hover:bg-muted"
                          title={tag.label}
                        >
                          {"{{" + tag.tag + "}}"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => setPendingAction({ type: "reset" })}
                  >
                    <RotateCcw className="size-4" />
                    Reset template to default
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    No block selected. Click any block in the email preview, or add one on the left.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => setPendingAction({ type: "reset" })}
                  >
                    <RotateCcw className="size-4" />
                    Reset template to default
                  </Button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {moveAnnouncement}
      </p>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Review {TEMPLATE_OUTCOMES[templateKey].name} application</DialogTitle>
            <DialogDescription>
              Check the essentials before this template is used by the dashboard.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 border-t py-4 text-sm">
            <dt className="text-muted-foreground">Template</dt>
            <dd className="font-medium">{meta.label}</dd>
            <dt className="text-muted-foreground">Event</dt>
            <dd className="font-medium">{event.name}</dd>
            <dt className="text-muted-foreground">Trigger</dt>
            <dd className="font-medium">{meta.trigger}</dd>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="font-medium">
              {previewFetcher.data?.previewSubject ?? content.subject}
            </dd>
            <dt className="text-muted-foreground">Content</dt>
            <dd className="font-medium">
              {content.blocks.length} blocks · Desktop and mobile ready
            </dd>
          </dl>
          {isBrandingDirty && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Your brand style changes will also be published and shared by every template for this
              event.
            </p>
          )}
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Publishing saves this template for the selected event. It does not send an applicant
            email now; future matching actions use the published version.
          </p>
          {!gmail.connected && (
            <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
              {gmail.configured ? (
                <>
                  Google OAuth credentials are configured, but no Gmail account is connected yet. Go
                  to{" "}
                  <Link
                    to="/invoice-settings"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Invoice settings
                  </Link>{" "}
                  and select Connect Gmail before sending a test.
                </>
              ) : (
                "Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, restart the local server, then connect Gmail in Invoice settings."
              )}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Back to edit
            </Button>
            <Button
              variant="outline"
              disabled={!gmail.connected || testFetcher.state !== "idle"}
              onClick={() => testFetcher.submit(submitPayload("send_test"), { method: "post" })}
            >
              Send test
            </Button>
            <Button disabled={saveFetcher.state !== "idle"} onClick={publishCurrentTemplate}>
              {saveFetcher.state !== "idle" ? "Publishing…" : "Publish changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === "remove" ? "Remove this block?" : "Reset this template?"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.type === "remove"
                ? "This block will be removed from the draft. Save changes to publish the removal."
                : "The subject, preheader, and all blocks will return to the default draft. Save changes to publish the reset."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmPendingAction}>
              {pendingAction?.type === "remove" ? "Remove block" : "Reset template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block editors
// ---------------------------------------------------------------------------

function BlockInspector({
  block,
  onRemove,
  onChange,
}: {
  block: EmailBlock;
  onRemove: () => void;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const Icon = BLOCK_ICONS[block.type];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <Badge variant="outline" className="gap-1">
          <Icon className="size-3.5" />
          {BLOCK_LABELS[block.type]}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-label="Remove block"
          onClick={onRemove}
        >
          <Trash2 className="size-4" /> Remove
        </Button>
      </div>
      <div className="grid gap-4">
        <BlockFields block={block} onChange={onChange} />
        {block.type !== "spacer" && block.type !== "divider" && (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Hide this block if this variable is empty (optional)
            </Label>
            <Input
              className="font-mono text-xs"
              placeholder="e.g. {{invoiceUrl}}"
              value={block.hideIfEmpty ?? ""}
              onChange={(e) => onChange({ hideIfEmpty: e.target.value || undefined })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function EmailImageInput({
  label,
  url,
  onChange,
}: {
  label: string;
  url: string;
  onChange: (url: string) => void;
}) {
  const uploadFetcher = useFetcher<ActionData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const handledResult = useRef<ActionData | undefined>(undefined);

  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result || uploadFetcher.state !== "idle" || handledResult.current === result) return;
    handledResult.current = result;
    if (result.ok && result.imageUrl) {
      onChange(result.imageUrl);
      toast.success(result.message);
    } else if (!result.ok) {
      toast.error(result.message ?? "Could not upload the image.");
    }
  }, [onChange, uploadFetcher.data, uploadFetcher.state]);

  const uploading = uploadFetcher.state !== "idle";

  return (
    <Field label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 p-2">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
          {url ? (
            <img src={url} alt="" className="max-h-12 max-w-12 object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {url ? "Image ready" : "No image uploaded"}
          </p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            PNG, JPG, GIF or WebP · max 5 MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          aria-label={`Upload ${label.toLowerCase()}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const data = new FormData();
            data.set("intent", "upload_image");
            data.set("image", file);
            uploadFetcher.submit(data, { method: "post", encType: "multipart/form-data" });
            event.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {url ? "Replace" : "Upload"}
        </Button>
        {url && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange("")}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </Field>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  switch (block.type) {
    case "hero":
      return (
        <>
          <Field label="Tag / badge">
            <Input value={block.tag ?? ""} onChange={(e) => onChange({ tag: e.target.value })} />
          </Field>
          <Field label="Heading">
            <Input value={block.heading} onChange={(e) => onChange({ heading: e.target.value })} />
          </Field>
          <Field label="Subtext">
            <Textarea
              value={block.subtext ?? ""}
              onChange={(e) => onChange({ subtext: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`show-reference-${block.id}`}
              checked={block.showReference ?? false}
              onCheckedChange={(checked) => onChange({ showReference: checked === true })}
            />
            <Label htmlFor={`show-reference-${block.id}`} className="cursor-pointer">
              Show submission reference chip
            </Label>
          </div>
        </>
      );
    case "image":
      return (
        <>
          <EmailImageInput label="Image" url={block.url} onChange={(url) => onChange({ url })} />
          <Field label="Alternative text">
            <Input
              value={block.alt}
              onChange={(event) => onChange({ alt: event.target.value })}
              placeholder="Describe the image for screen readers"
            />
          </Field>
          <Field label="Link URL (optional)">
            <Input
              type="url"
              value={block.linkUrl ?? ""}
              onChange={(event) => onChange({ linkUrl: event.target.value })}
              placeholder="https://…"
            />
          </Field>
        </>
      );
    case "heading":
      return (
        <Field label="Text">
          <Input value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
        </Field>
      );
    case "paragraph":
      return (
        <Field label="Text (**bold**, [link](url), new lines)">
          <Textarea
            className="min-h-24"
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </Field>
      );
    case "list":
      return (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`numbered-list-${block.id}`}
              checked={block.ordered}
              onCheckedChange={(checked) => onChange({ ordered: checked === true })}
            />
            <Label htmlFor={`numbered-list-${block.id}`} className="cursor-pointer">
              Numbered list
            </Label>
          </div>
          <Field label="Items (one per line)">
            <Textarea
              className="min-h-24"
              value={block.items.join("\n")}
              onChange={(e) => onChange({ items: e.target.value.split("\n") })}
            />
          </Field>
        </>
      );
    case "button":
      return (
        <>
          <Field label="Label">
            <Input value={block.label} onChange={(e) => onChange({ label: e.target.value })} />
          </Field>
          <Field label="URL">
            <Input value={block.url} onChange={(e) => onChange({ url: e.target.value })} />
          </Field>
          <Field label="Style">
            <Select value={block.variant} onValueChange={(v) => onChange({ variant: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solid">Solid</SelectItem>
                <SelectItem value="outline">Outline</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      );
    case "summary":
      return (
        <>
          <Field label="Section label">
            <Input
              value={block.label ?? ""}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </Field>
          <Field label="Rows (Label | Value per line; omit label for full-width)">
            <Textarea
              className="min-h-24 font-mono text-xs"
              value={block.rows
                .map((r) => (r.label ? `${r.label} | ${r.value}` : r.value))
                .join("\n")}
              onChange={(e) =>
                onChange({
                  rows: e.target.value.split("\n").map((line) => {
                    const i = line.indexOf("|");
                    return i === -1
                      ? { label: "", value: line.trim() }
                      : {
                          label: line.slice(0, i).trim(),
                          value: line.slice(i + 1).trim(),
                        };
                  }),
                })
              }
            />
          </Field>
        </>
      );
    case "bank":
      return (
        <p className="text-xs text-muted-foreground">
          Renders the EFT bank-transfer details from Invoice settings (account, BSB, amount,
          reference). Nothing to edit here — use “hide if empty” to drop it when no BSB is
          configured.
        </p>
      );
    case "spacer":
      return (
        <Field label="Size">
          <Select value={block.size} onValueChange={(v) => onChange({ size: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Small</SelectItem>
              <SelectItem value="md">Medium</SelectItem>
              <SelectItem value="lg">Large</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      );
    case "divider":
      return <p className="text-xs text-muted-foreground">A horizontal divider line.</p>;
  }
}

// ---------------------------------------------------------------------------
// Branding editor
// ---------------------------------------------------------------------------

function BrandLogoInput({
  label,
  url,
  background,
  onChange,
}: {
  label: string;
  url: string;
  background: string;
  onChange: (url: string) => void;
}) {
  const uploadFetcher = useFetcher<ActionData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const handledResult = useRef<ActionData | undefined>(undefined);

  useEffect(() => {
    const result = uploadFetcher.data;
    if (!result || uploadFetcher.state !== "idle" || handledResult.current === result) return;
    handledResult.current = result;
    if (result.ok && result.imageUrl) {
      onChange(result.imageUrl);
      toast.success(`${label} uploaded. Publish changes to use it in future emails.`);
    } else if (!result.ok) {
      toast.error(result.message ?? "Could not upload the logo.");
    }
  }, [label, onChange, uploadFetcher.data, uploadFetcher.state]);

  return (
    <Field label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 p-2">
        <div
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background"
          style={{ background }}
        >
          {url ? (
            <img src={url} alt="" className="max-h-12 max-w-12 object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {url ? "Logo ready" : "No logo uploaded"}
          </p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            PNG, JPG, GIF or WebP · max 5 MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          aria-label={`Upload ${label.toLowerCase()}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set("intent", "upload_image");
            form.set("image", file);
            uploadFetcher.submit(form, { method: "post", encType: "multipart/form-data" });
            event.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={uploadFetcher.state !== "idle"}
          onClick={() => inputRef.current?.click()}
        >
          {uploadFetcher.state !== "idle" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {url ? "Replace" : "Upload"}
        </Button>
        {url && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange("")}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </Field>
  );
}

function BrandSection({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span>{title}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function BrandingEditor({
  branding,
  onChange,
}: {
  branding: EmailBranding;
  onChange: (b: EmailBranding) => void;
}) {
  const set = (patch: Partial<EmailBranding>) => onChange({ ...branding, ...patch });
  const colorField = (
    key: "brandColor" | "accentColor" | "buttonColor" | "headerBg" | "footerBg",
    label: string,
  ) => (
    <Field label={label}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={branding[key]}
          onChange={(event) => set({ [key]: event.target.value })}
          className="size-9 shrink-0 cursor-pointer rounded border bg-background p-1"
        />
        <Input
          aria-label={`${label} hex color`}
          value={branding[key]}
          onChange={(event) => set({ [key]: event.target.value })}
          className="min-w-0 flex-1 font-mono text-xs"
        />
      </div>
    </Field>
  );
  const updateSocial = (id: string, patch: { label?: string; url?: string }) =>
    set({
      socialLinks: branding.socialLinks.map((link) =>
        link.id === id ? { ...link, ...patch } : link,
      ),
    });

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
        <Palette className="mr-2 inline size-4 align-text-bottom" />
        <strong>Shared across all {TEMPLATE_KEYS.length} templates.</strong> Logo, colors, footer
        and social links update every email for this event. The preview changes live; use Review
        email → Publish changes to save.
      </div>
      <BrandSection title="Identity" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="From name">
          <Input
            value={branding.fromName}
            onChange={(event) => set({ fromName: event.target.value })}
          />
        </Field>
        <Field label="Contact email">
          <Input
            type="email"
            value={branding.contactEmail}
            onChange={(event) => set({ contactEmail: event.target.value })}
          />
        </Field>
      </div>
      <BrandLogoInput
        label="Header logo"
        url={branding.logoUrl}
        background={branding.headerBg}
        onChange={(logoUrl) => set({ logoUrl })}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="custom-header-logo-width"
          checked={branding.headerLogoWidth !== null}
          onCheckedChange={(checked) => set({ headerLogoWidth: checked === true ? 180 : null })}
        />
        <Label htmlFor="custom-header-logo-width" className="cursor-pointer text-xs font-normal">
          Set a custom header logo width
        </Label>
      </div>
      {branding.headerLogoWidth !== null && (
        <Field label="Header logo width">
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Header logo width"
              min={80}
              max={320}
              step={1}
              value={[branding.headerLogoWidth]}
              onValueChange={([width]) => set({ headerLogoWidth: width })}
            />
            <output className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {branding.headerLogoWidth}px
            </output>
          </div>
        </Field>
      )}
      <BrandSection title="Colors" />
      <div className="grid grid-cols-2 gap-3">
        {colorField("brandColor", "Brand / hero")}
        {colorField("accentColor", "Accent (pill)")}
        {colorField("buttonColor", "Button")}
        {colorField("headerBg", "Header background")}
        {colorField("footerBg", "Footer background")}
      </div>
      <BrandSection title="Footer & links" />
      <BrandLogoInput
        label="Footer logo"
        url={branding.footerLogoUrl}
        background={branding.footerBg || branding.brandColor}
        onChange={(footerLogoUrl) => set({ footerLogoUrl })}
      />
      <div className="space-y-2">
        <p className="text-xs font-semibold">
          Social accounts{" "}
          <span className="font-normal text-muted-foreground">(add any platform or profile)</span>
        </p>
        {branding.socialLinks.map((link) => (
          <div key={link.id} className="flex items-center gap-1.5">
            <Input
              aria-label="Social platform"
              placeholder="Platform"
              value={link.label}
              onChange={(event) => updateSocial(link.id, { label: event.target.value })}
              className="w-28 shrink-0"
            />
            <Input
              aria-label={`${link.label || "Social"} URL`}
              type="url"
              placeholder="https://…"
              value={link.url}
              onChange={(event) => updateSocial(link.id, { url: event.target.value })}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              aria-label={`Remove ${link.label || "social"} link`}
              onClick={() =>
                set({ socialLinks: branding.socialLinks.filter((item) => item.id !== link.id) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            set({
              socialLinks: [
                ...branding.socialLinks,
                { id: crypto.randomUUID(), label: "", url: "" },
              ],
            })
          }
        >
          <Plus className="size-4" /> Add social link
        </Button>
      </div>
      <Field label="Footer text">
        <Textarea
          value={branding.footerText}
          onChange={(event) => set({ footerText: event.target.value })}
        />
      </Field>
    </div>
  );
}
