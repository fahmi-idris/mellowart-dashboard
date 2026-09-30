import { env } from "cloudflare:workers";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useBlocker, useFetcher } from "react-router";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Eye,
  GripVertical,
  Loader2,
  Palette,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react";

import type { Route } from "./+types/email-templates";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { useSidebar } from "~/components/ui/sidebar";
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
  renderContent,
  saveTemplate,
  updateBranding,
} from "~/lib/email-templates.server";
import { getGoogleTokens } from "~/lib/google-tokens.server";
import { formatDueDate, getInvoiceSettings } from "~/lib/invoices.server";

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

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [templates, branding, google] = await Promise.all([
    getAllTemplates(env.DB),
    getBranding(env.DB),
    getGoogleTokens(env.DB),
  ]);
  return {
    templates,
    branding,
    gmail: { connected: google !== null, email: google?.email ?? null },
  };
}

function parseContent(form: FormData): TemplateContent {
  const blocks = JSON.parse(String(form.get("blocks") ?? "[]")) as unknown;
  if (!Array.isArray(blocks)) throw new Error("Blocks must be an array.");
  return {
    subject: String(form.get("subject") ?? ""),
    preheader: String(form.get("preheader") ?? ""),
    blocks: blocks as EmailBlock[],
  };
}

function brandingFromForm(form: FormData): EmailBranding {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    fromName: s("fromName"),
    logoUrl: s("logoUrl"),
    brandColor: s("brandColor"),
    accentColor: s("accentColor"),
    buttonColor: s("buttonColor"),
    headerBg: s("headerBg"),
    footerBg: s("footerBg"),
    footerLogoUrl: s("footerLogoUrl"),
    footerText: String(form.get("footerText") ?? ""),
    contactEmail: s("contactEmail"),
    websiteUrl: s("websiteUrl"),
    instagramUrl: s("instagramUrl"),
    facebookUrl: s("facebookUrl"),
    tiktokUrl: s("tiktokUrl"),
  };
}

/**
 * Merge context for previews / test sends. Starts from the sample values, then
 * — for the approval email — overlays the real saved invoice settings (bank
 * details, confirmation form, payment due date) so the preview faithfully shows
 * what recipients actually receive rather than placeholders.
 */
async function previewContext(key: TemplateKey): Promise<Record<string, string>> {
  const ctx = sampleContext(key);
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

    if (intent === "preview") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      const brandingJson = form.get("branding");
      const branding = brandingJson
        ? (JSON.parse(String(brandingJson)) as EmailBranding)
        : await getBranding(env.DB);
      const rendered = renderContent(content, branding, await previewContext(key), {
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
      await saveTemplate(env.DB, key, content, session.email);
      return { ok: true, message: `Saved “${TEMPLATE_META[key].label}”.` };
    }

    if (intent === "save_branding") {
      await updateBranding(env.DB, brandingFromForm(form));
      return { ok: true, message: "Branding saved." };
    }

    if (intent === "send_test") {
      const key = String(form.get("key") ?? "");
      if (!isTemplateKey(key)) return { ok: false, message: "Unknown template." };
      const content = parseContent(form);
      const branding = await getBranding(env.DB);
      const rendered = renderContent(content, branding, await previewContext(key));
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
  const { templates, branding: initialBranding, gmail } = loaderData;
  const [selected, setSelected] = useState<TemplateKey>(TEMPLATE_KEYS[0]);
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
  const [brandingPanelOpen, setBrandingPanelOpen] = useState(false);
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Email templates</h1>
        <p className="text-sm text-muted-foreground">
          Customize the transactional emails sent to applicants. Edits take effect on the next send.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Email template section">
        {TEMPLATE_KEYS.map((k) => (
          <Button
            key={k}
            variant={selected === k ? "default" : "outline"}
            size="sm"
            aria-pressed={selected === k}
            onClick={() => setSelected(k)}
          >
            {TEMPLATE_META[k].label}
          </Button>
        ))}
      </div>

      <TemplateEditor
        key={selected}
        templateKey={selected}
        content={drafts[selected]}
        branding={branding}
        gmail={gmail}
        isDirty={JSON.stringify(drafts[selected]) !== JSON.stringify(savedTemplates[selected])}
        onEditBranding={() => setBrandingPanelOpen(true)}
        onChange={(next) => setDrafts((d) => ({ ...d, [selected]: next }))}
        onSaved={markTemplateSaved}
      />

      <Sheet open={brandingPanelOpen} onOpenChange={setBrandingPanelOpen}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Branding and colors</SheetTitle>
            <SheetDescription>
              These settings are shared by every email template. Changes update the preview behind
              this panel immediately.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <BrandingEditor
              branding={branding}
              onChange={setBranding}
              onSaved={markBrandingSaved}
            />
          </div>
        </SheetContent>
      </Sheet>

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
  templateKey,
  content,
  branding,
  gmail,
  isDirty,
  onEditBranding,
  onChange,
  onSaved,
}: {
  templateKey: TemplateKey;
  content: TemplateContent;
  branding: EmailBranding;
  gmail: { connected: boolean; email: string | null };
  isDirty: boolean;
  onEditBranding: () => void;
  onChange: (next: TemplateContent) => void;
  onSaved: (key: TemplateKey, saved: TemplateContent) => void;
}) {
  const { state: sidebarState, isMobile } = useSidebar();
  const meta = TEMPLATE_META[templateKey];
  const tags = MERGE_TAGS[templateKey];
  const previewFetcher = useFetcher<ActionData>();
  const saveFetcher = useFetcher<ActionData>();
  const testFetcher = useFetcher<ActionData>();
  const [mergeTagsOpen, setMergeTagsOpen] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: BlockDropPosition;
  } | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const [pendingAction, setPendingAction] = useState<
    { type: "remove"; block: EmailBlock } | { type: "reset" } | null
  >(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const previewIframe = useRef<HTMLIFrameElement | null>(null);
  const previewScrollTop = useRef(0);
  const pendingPreviewBlockId = useRef<string | null | undefined>(undefined);
  const pendingSavedContent = useRef<TemplateContent | null>(null);
  const pendingFocusBlockId = useRef<string | null>(null);
  const dragPointerY = useRef<number | null>(null);
  const dragScrollFrame = useRef<number | null>(null);

  const stopDragAutoScroll = useCallback(() => {
    dragPointerY.current = null;
    if (dragScrollFrame.current !== null) {
      cancelAnimationFrame(dragScrollFrame.current);
      dragScrollFrame.current = null;
    }
  }, []);

  const updateDragAutoScroll = useCallback((clientY: number) => {
    dragPointerY.current = clientY;
    if (dragScrollFrame.current !== null) return;

    const scrollAtEdge = () => {
      const pointerY = dragPointerY.current;
      if (pointerY === null) {
        dragScrollFrame.current = null;
        return;
      }

      const edgeSize = Math.min(140, window.innerHeight / 4);
      const distanceFromBottom = window.innerHeight - pointerY;
      let speed = 0;

      if (pointerY < edgeSize) {
        speed = -Math.ceil(((edgeSize - pointerY) / edgeSize) * 18);
      } else if (distanceFromBottom < edgeSize) {
        speed = Math.ceil(((edgeSize - distanceFromBottom) / edgeSize) * 18);
      }

      if (speed !== 0) window.scrollBy(0, speed);
      dragScrollFrame.current = requestAnimationFrame(scrollAtEdge);
    };

    dragScrollFrame.current = requestAnimationFrame(scrollAtEdge);
  }, []);

  useEffect(() => stopDragAutoScroll, [stopDragAutoScroll]);

  useEffect(() => {
    const blockId = pendingFocusBlockId.current;
    if (!blockId) return;
    pendingFocusBlockId.current = null;

    const frame = requestAnimationFrame(() => {
      const blockElement = blockRefs.current.get(blockId);
      blockElement?.scrollIntoView({ behavior: "smooth", block: "center" });
      blockElement?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [content.blocks]);

  const scrollPreviewToPendingBlock = useCallback(() => {
    const blockId = pendingPreviewBlockId.current;
    const frame = previewIframe.current;
    const document = frame?.contentDocument;
    const frameWindow = frame?.contentWindow;
    if (!document || !frameWindow) return;

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

  // Debounced live preview whenever the working copy changes.
  const refreshPreview = useCallback(() => {
    const frameWindow = previewIframe.current?.contentWindow;
    if (frameWindow) previewScrollTop.current = frameWindow.scrollY;

    previewFetcher.submit(
      {
        intent: "preview",
        key: templateKey,
        subject: content.subject,
        preheader: content.preheader,
        blocks: JSON.stringify(content.blocks),
        branding: JSON.stringify(branding),
      },
      { method: "post" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, content, branding]);

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
    } else {
      toast.error(d.message);
    }
    pendingSavedContent.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data, saveFetcher.state, onSaved, templateKey]);

  useEffect(() => {
    const d = testFetcher.data;
    if (d && testFetcher.state === "idle") d.ok ? toast.success(d.message) : toast.error(d.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testFetcher.data, testFetcher.state]);

  const update = (patch: Partial<TemplateContent>) => onChange({ ...content, ...patch });

  const setBlocks = (blocks: EmailBlock[]) => update({ blocks });

  const updateBlock = (id: string, patch: Record<string, unknown>) => {
    pendingPreviewBlockId.current = id;
    setBlocks(content.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));
  };

  const moveBlock = (block: EmailBlock, idx: number, dir: -1 | 1) => {
    const next = [...content.blocks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    pendingFocusBlockId.current = block.id;
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
    pendingPreviewBlockId.current = block.id;
    setBlocks([...content.blocks, block]);
  };

  const submitPayload = (intent: string) => ({
    intent,
    key: templateKey,
    subject: content.subject,
    preheader: content.preheader,
    blocks: JSON.stringify(content.blocks),
  });

  const saveCurrentTemplate = () => {
    pendingSavedContent.current = structuredClone(content);
    saveFetcher.submit(submitPayload("save_template"), { method: "post" });
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;

    if (pendingAction.type === "remove") {
      removeBlock(pendingAction.block.id);
      toast.message(`${BLOCK_LABELS[pendingAction.block.type]} block removed from the draft.`);
    } else {
      pendingPreviewBlockId.current = null;
      onChange(structuredClone(DEFAULT_TEMPLATES[templateKey]));
      toast.message("Reset to default (not yet saved).");
    }

    setPendingAction(null);
  };

  const copyTag = (tag: string) => {
    navigator.clipboard.writeText(`{{${tag}}}`);
    toast.success(`Copied {{${tag}}}`);
  };

  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Editor column */}
      <div className="flex flex-col gap-4">
        <Card size="sm">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2">
              {meta.label}
              <Badge variant="secondary" className="font-normal">
                {meta.trigger}
              </Badge>
            </CardTitle>
            <CardDescription>{meta.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={content.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="preheader">
                  Preheader <span className="text-muted-foreground">(inbox preview)</span>
                </Label>
                <Input
                  id="preheader"
                  value={content.preheader}
                  onChange={(e) => update({ preheader: e.target.value })}
                />
              </div>
            </div>
            <div className="border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-7"
                aria-expanded={mergeTagsOpen}
                aria-controls={`merge-tags-${templateKey}`}
                onClick={() => setMergeTagsOpen((open) => !open)}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${mergeTagsOpen ? "rotate-180" : ""}`}
                />
                {mergeTagsOpen ? "Hide merge tags" : "Show merge tags"}
                <Badge variant="secondary" className="ml-1 font-normal">
                  {tags.length}
                </Badge>
              </Button>
              {mergeTagsOpen && (
                <div id={`merge-tags-${templateKey}`} className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => copyTag(t.tag)}
                      title={`${t.label} — click to copy`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Copy className="size-3" />
                      {`{{${t.tag}}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div
          className="flex flex-col gap-3"
          onDragOver={(event) => {
            if (draggedBlockId) updateDragAutoScroll(event.clientY);
          }}
        >
          {content.blocks.map((block, idx) => {
            const target = dropTarget?.id === block.id ? dropTarget : null;
            return (
              <div
                key={block.id}
                ref={(element) => {
                  if (element) blockRefs.current.set(block.id, element);
                  else blockRefs.current.delete(block.id);
                }}
                tabIndex={-1}
                aria-label={`${BLOCK_LABELS[block.type]} block, position ${idx + 1} of ${content.blocks.length}`}
                className="relative scroll-m-24 rounded-xl outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (!draggedBlockId || draggedBlockId === block.id) {
                    setDropTarget(null);
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  setDropTarget((current) =>
                    current?.id === block.id && current.position === position
                      ? current
                      : { id: block.id, position },
                  );
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedBlockId || event.dataTransfer.getData("text/plain");
                  if (sourceId && target) {
                    pendingPreviewBlockId.current = sourceId;
                    setBlocks(
                      reorderEmailBlocks(content.blocks, sourceId, block.id, target.position),
                    );
                  }
                  setDraggedBlockId(null);
                  setDropTarget(null);
                  stopDragAutoScroll();
                }}
              >
                {target && (
                  <div
                    className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary ${
                      target.position === "before" ? "-top-1.5" : "-bottom-1.5"
                    }`}
                    aria-hidden="true"
                  />
                )}
                <BlockCard
                  block={block}
                  first={idx === 0}
                  last={idx === content.blocks.length - 1}
                  dragging={draggedBlockId === block.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", block.id);
                    setDraggedBlockId(block.id);
                  }}
                  onDragEnd={() => {
                    setDraggedBlockId(null);
                    setDropTarget(null);
                    stopDragAutoScroll();
                  }}
                  onMove={(dir) => moveBlock(block, idx, dir)}
                  onRemove={() => setPendingAction({ type: "remove", block })}
                  onChange={(patch) => updateBlock(block.id, patch)}
                />
              </div>
            );
          })}
          <p className="sr-only" aria-live="polite">
            {moveAnnouncement}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-[200px] justify-start">
                <Plus className="size-4" /> Add block
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px]">
              {BLOCK_TYPES.map((t) => (
                <DropdownMenuItem key={t} onSelect={() => addBlock(t)}>
                  {BLOCK_LABELS[t]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={() => setPendingAction({ type: "reset" })}>
            Reset to default
          </Button>
        </div>

        <div
          className="fixed bottom-0 right-0 z-40 border-t bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-[left] duration-200"
          style={{
            left: isMobile
              ? 0
              : sidebarState === "collapsed"
                ? "var(--sidebar-width-icon)"
                : "var(--sidebar-width)",
          }}
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2 px-4 py-3 md:px-6">
            {isDirty && (
              <Badge variant="secondary" className="mr-auto font-normal">
                Unsaved changes
              </Badge>
            )}
            {!gmail.connected && (
              <span className={`${isDirty ? "" : "mr-auto"} text-xs text-muted-foreground`}>
                Gmail not connected — test send disabled.
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => testFetcher.submit(submitPayload("send_test"), { method: "post" })}
              disabled={!gmail.connected || testFetcher.state !== "idle"}
              title={
                gmail.connected
                  ? `Send a sample to ${gmail.email}`
                  : "Connect Gmail in Invoice settings to send tests"
              }
            >
              <Send className="size-4" />
              {testFetcher.state !== "idle" ? "Sending…" : "Send test to me"}
            </Button>
            <Button onClick={saveCurrentTemplate} disabled={saveFetcher.state !== "idle"}>
              {saveFetcher.state !== "idle" ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      </div>

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
                ? `The ${BLOCK_LABELS[pendingAction.block.type].toLowerCase()} block will be removed from this draft. This change will not become final until you save the template.`
                : "The subject, preheader, and all content blocks will be replaced with the default template. This change will not become final until you save the template."}
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

      {/* Preview column */}
      <div className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Eye className="size-4" /> Live preview
          </Label>
          <span className="truncate text-xs text-muted-foreground">
            {previewFetcher.data?.previewSubject ?? " "}
          </span>
        </div>
        <div className="relative overflow-hidden rounded-lg border bg-muted/30">
          <iframe
            ref={previewIframe}
            title="Email preview"
            sandbox="allow-same-origin"
            className="h-[70vh] w-full bg-white"
            srcDoc={previewFetcher.data?.previewHtml ?? ""}
            onLoad={scrollPreviewToPendingBlock}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute right-3 top-3 z-10 bg-background/95 shadow-md backdrop-blur-sm"
            onClick={onEditBranding}
          >
            <Palette className="size-4" />
            Edit branding
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Rendered with sample data. Blocks hidden when their variable is empty (e.g. the pay
          button) still show here because samples are filled in.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block editors
// ---------------------------------------------------------------------------

function BlockCard({
  block,
  first,
  last,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onRemove,
  onChange,
}: {
  block: EmailBlock;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <Card className={dragging ? "opacity-60" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
        <Badge variant="outline">{BLOCK_LABELS[block.type]}</Badge>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 cursor-grab active:cursor-grabbing"
            draggable
            aria-label={`Drag ${BLOCK_LABELS[block.type]} block to reorder`}
            title="Drag to reorder"
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <GripVertical className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={first}
            aria-label="Move block up"
            title="Move block up"
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={last}
            aria-label="Move block down"
            title="Move block down"
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive"
            aria-label="Remove block"
            title="Remove block"
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pb-4">
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
      </CardContent>
    </Card>
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
  previewBackground = "#fff",
  placeholder = "https://…",
}: {
  label: string;
  url: string;
  onChange: (url: string) => void;
  previewBackground?: string;
  placeholder?: string;
}) {
  const uploadFetcher = useFetcher<ActionData>();
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
      <div className="flex items-start gap-3">
        <div
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border"
          style={{ background: previewBackground }}
        >
          {url ? (
            <img src={url} alt="" className="max-h-14 max-w-14 object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">No image</span>
          )}
        </div>
        <div className="grid min-w-0 flex-1 gap-2">
          <Input
            type="url"
            aria-label={`${label} URL`}
            value={url}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
          <div className="relative">
            <Input
              type="file"
              aria-label={`Upload ${label.toLowerCase()}`}
              accept="image/png,image/jpeg,image/gif,image/webp"
              disabled={uploading}
              className="pr-24"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const data = new FormData();
                data.set("intent", "upload_image");
                data.set("image", file);
                uploadFetcher.submit(data, {
                  method: "post",
                  encType: "multipart/form-data",
                });
                event.target.value = "";
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-xs text-muted-foreground">
              {uploading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              {uploading ? "Uploading…" : "Max 5 MB"}
            </span>
          </div>
        </div>
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.showReference ?? false}
              onChange={(e) => onChange({ showReference: e.target.checked })}
            />
            Show submission reference chip
          </label>
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
          <Field label="Width">
            <Select value={block.width} onValueChange={(width) => onChange({ width })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full (520 px)</SelectItem>
                <SelectItem value="medium">Medium (360 px)</SelectItem>
                <SelectItem value="small">Small (200 px)</SelectItem>
              </SelectContent>
            </Select>
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(e) => onChange({ ordered: e.target.checked })}
            />
            Numbered list
          </label>
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

function BrandingEditor({
  branding,
  onChange,
  onSaved,
}: {
  branding: EmailBranding;
  onChange: (b: EmailBranding) => void;
  onSaved: (branding: EmailBranding) => void;
}) {
  const saveFetcher = useFetcher<ActionData>();
  const pendingSavedBranding = useRef<EmailBranding | null>(null);

  useEffect(() => {
    const d = saveFetcher.data;
    if (!d || saveFetcher.state !== "idle") return;

    if (d.ok) {
      toast.success(d.message);
      if (pendingSavedBranding.current) onSaved(pendingSavedBranding.current);
    } else {
      toast.error(d.message);
    }
    pendingSavedBranding.current = null;
  }, [onSaved, saveFetcher.data, saveFetcher.state]);

  const set = (patch: Partial<EmailBranding>) => onChange({ ...branding, ...patch });
  const saveCurrentBranding = () => {
    pendingSavedBranding.current = structuredClone(branding);
    saveFetcher.submit(
      { intent: "save_branding", ...brandingToForm(branding) },
      { method: "post" },
    );
  };
  const colorField = (key: keyof EmailBranding, label: string) => (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={String(branding[key])}
          onChange={(e) => set({ [key]: e.target.value } as Partial<EmailBranding>)}
          className="size-9 shrink-0 rounded border"
        />
        <Input
          value={String(branding[key])}
          onChange={(e) => set({ [key]: e.target.value } as Partial<EmailBranding>)}
          className="font-mono"
        />
      </div>
    </Field>
  );

  return (
    <Card className="max-w-2xl overflow-visible pb-0">
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Shared header, colors, and footer applied to every template.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pb-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From name">
            <Input value={branding.fromName} onChange={(e) => set({ fromName: e.target.value })} />
          </Field>
          <Field label="Contact email">
            <Input
              value={branding.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
            />
          </Field>
        </div>
        <EmailImageInput
          label="Header logo"
          url={branding.logoUrl}
          onChange={(logoUrl) => set({ logoUrl })}
          previewBackground={branding.headerBg}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {colorField("brandColor", "Brand / hero background")}
          {colorField("accentColor", "Accent (pill)")}
          {colorField("buttonColor", "Button")}
          {colorField("headerBg", "Header background")}
        </div>
        <Field label="Website URL">
          <Input
            value={branding.websiteUrl}
            onChange={(e) => set({ websiteUrl: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Instagram URL">
            <Input
              value={branding.instagramUrl}
              onChange={(e) => set({ instagramUrl: e.target.value })}
            />
          </Field>
          <Field label="Facebook URL">
            <Input
              value={branding.facebookUrl}
              onChange={(e) => set({ facebookUrl: e.target.value })}
            />
          </Field>
          <Field label="TikTok URL">
            <Input
              value={branding.tiktokUrl}
              onChange={(e) => set({ tiktokUrl: e.target.value })}
            />
          </Field>
        </div>
        <EmailImageInput
          label="Footer logo"
          url={branding.footerLogoUrl}
          onChange={(footerLogoUrl) => set({ footerLogoUrl })}
          previewBackground={branding.footerBg || branding.brandColor}
          placeholder="Light/inverted logo for the dark footer"
        />
        {colorField("footerBg", "Footer background")}
        <Field label="Footer text">
          <Textarea
            value={branding.footerText}
            onChange={(e) => set({ footerText: e.target.value })}
          />
        </Field>
        <div className="sticky bottom-0 z-20 -mx-4 mt-2 flex justify-end rounded-b-xl border-t bg-card/95 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm">
          <Button onClick={saveCurrentBranding} disabled={saveFetcher.state !== "idle"}>
            {saveFetcher.state !== "idle" ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function brandingToForm(b: EmailBranding): Record<string, string> {
  return {
    fromName: b.fromName,
    logoUrl: b.logoUrl,
    brandColor: b.brandColor,
    accentColor: b.accentColor,
    buttonColor: b.buttonColor,
    headerBg: b.headerBg,
    footerBg: b.footerBg,
    footerLogoUrl: b.footerLogoUrl,
    footerText: b.footerText,
    contactEmail: b.contactEmail,
    websiteUrl: b.websiteUrl,
    instagramUrl: b.instagramUrl,
    facebookUrl: b.facebookUrl,
    tiktokUrl: b.tiktokUrl,
  };
}
