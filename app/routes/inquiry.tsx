import { env } from "cloudflare:workers";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  MoreHorizontal,
  Paperclip,
  StickyNote,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Link,
  useFetcher,
  useFetchers,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { toast } from "sonner";

import type { Route } from "./+types/inquiry";
import { BaseTable, type FilterDef } from "~/components/base-table";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { requireAdmin } from "~/lib/auth.server";
import {
  DEFAULT_PAGE_SIZE,
  listQueryToSearchParams,
  parseListQuery,
  type ListQuery,
  type Paginated,
} from "~/lib/data-table";
import { listEventsWithCounts, listStallOptions } from "~/lib/events.server";
import type { EventWithCounts, StallOption } from "~/lib/events";
import {
  createInvoiceForSubmission,
  sendRejectionEmail,
  sendWaitlistEmail,
  sendWithdrawnEmail,
} from "~/lib/jobs.server";
import {
  assignStall,
  cancelInvoicing,
  setApplicationStatus,
  setApplicationStatuses,
  setPaymentStatus,
  startInvoicing,
} from "~/lib/payments.server";
import { deleteSubmissions, setArchived, setInternalNotes } from "~/lib/submissions.server";
import { logActivity } from "~/lib/activity.server";
import {
  APPLICATION_LABEL,
  APPLICATION_STATUSES,
  applicationToneClass,
  isApplicationStatus,
  isManualPaymentStatus,
  MANUAL_PAYMENT_STATUSES,
  PAYMENT_LABEL,
  paymentToneClass,
  type ApplicationStatus,
  type PaymentStatus,
} from "~/lib/status";
import { cn } from "~/lib/utils";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Artist submissions · Mellow" }];
}

type StallsByEvent = Record<string, StallOption[]>;

// List row (from /api/inquiries).
type Artist = {
  id: string;
  name: string;
  email: string;
  brandName: string | null;
  primaryCategory: string | null;
  secondaryCategory: string | null;
  sharingStall: string | null;
  hasInsurance: string | null;
  appliedBefore: string | null;
  instagram: string | null;
  decidedAt: string | null;
  eventId: string | null;
  status: ApplicationStatus;
  stallOptionId: string | null;
  paymentStatus: PaymentStatus;
  invoiceUrl: string | null;
  rejectReason: string | null;
  internalNotes: string | null;
  archivedAt: string | null;
  submittedAt: string;
};

// Full record (from /api/inquiries/:id).
type DetailImage = {
  id: string;
  kind: "profile" | "portfolio" | "insurance" | "second_portfolio";
  key: string;
  sortOrder: number;
};
type ArtistDetail = Artist & {
  firstName: string;
  lastName: string;
  appliedBefore: string | null;
  website: string | null;
  instagram: string | null;
  bio: string;
  productDescription: string | null;
  eventName: string | null;
  stallTier: string | null;
  firstStallPreference: string | null;
  secondStallPreference: string | null;
  offerMiniIfUnavailable: string | null;
  sharingStall: string | null;
  hasInsurance: string | null;
  additionalNotes: string | null;
  waitlistReason: string | null;
  // Shared-stall second artist ("buddy").
  secondFirstName: string | null;
  secondLastName: string | null;
  secondEmail: string | null;
  secondAppliedBefore: string | null;
  secondBrandName: string | null;
  secondWebsite: string | null;
  secondInstagram: string | null;
  secondBio: string | null;
  secondPrimaryCategory: string | null;
  secondSecondaryCategory: string | null;
  secondProductDescription: string | null;
  images: DetailImage[];
};

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const events = await listEventsWithCounts(env.DB);
  const stalls: StallsByEvent = {};
  for (const e of events) {
    stalls[e.id] = await listStallOptions(env.DB, e.id);
  }
  return { events, stalls };
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // List controls are client-side API queries; changing their URL state does
  // not need to reload the events/stalls used to render the filter options.
  if (!formMethod && currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

async function fetchArtists(query: ListQuery): Promise<Paginated<Artist>> {
  const res = await fetch(`/api/inquiries?${listQueryToSearchParams(query)}`);
  if (!res.ok) throw new Error("Failed to load submissions");
  return res.json();
}

/** Artist name (or reference) + medium for the activity feed. */
async function submissionSubject(id: string): Promise<{ name: string; medium: string | null }> {
  const r = await env.DB.prepare(
    "SELECT first_name, last_name, primary_category FROM submissions WHERE id = ?",
  )
    .bind(id)
    .first<{ first_name: string; last_name: string; primary_category: string | null }>();
  const name = r ? `${r.first_name} ${r.last_name}`.trim() : id;
  return { name, medium: r?.primary_category ?? null };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  if (intent === "bulk_status" || intent === "bulk_delete") {
    const ids = [
      ...new Set(
        form
          .getAll("ids")
          .map(String)
          .filter((value) => /^ART-[A-Z0-9]+$/.test(value)),
      ),
    ];
    if (ids.length === 0 || ids.length > 100) {
      return { ok: false, message: "Select 1–100 submissions on this page." };
    }
    try {
      if (intent === "bulk_status") {
        const status = String(form.get("status") ?? "");
        if (!isApplicationStatus(status)) return { ok: false, message: "Unknown status." };
        const changed = await setApplicationStatuses(env.DB, ids, status, session.email);
        await logActivity(env.DB, {
          actorId: session.sub,
          actorEmail: session.email,
          type: status,
          message: `${changed} submissions set to ${APPLICATION_LABEL[status]}`,
        });
        return {
          ok: true,
          message: `${changed} submissions set to ${APPLICATION_LABEL[status]}. No emails were sent.`,
        };
      }
      const result = await deleteSubmissions(env.DB, env.BUCKET, ids);
      await logActivity(env.DB, {
        actorId: session.sub,
        actorEmail: session.email,
        type: "deleted",
        message: `${result.deleted} submissions deleted`,
      });
      return {
        ok: true,
        message: `${result.deleted} submissions deleted.${result.filesFailed ? ` ${result.filesFailed} uploaded files could not be removed from storage.` : ""}`,
      };
    } catch (err) {
      console.error("bulk inquiry action failed", { intent, err });
      return { ok: false, message: "Could not complete the bulk action." };
    }
  }

  if (!id) return { ok: false, message: "Missing reference." };

  try {
    switch (intent) {
      case "set_status": {
        const status = String(form.get("status") ?? "");
        if (!isApplicationStatus(status)) {
          return { ok: false, message: "Unknown status." };
        }
        // Optional decision note — attached to rejected/waitlisted only.
        const reason = String(form.get("reason") ?? "").trim() || null;
        const decisionReason = status === "rejected" || status === "waitlisted" ? reason : null;
        const changed = await setApplicationStatus(
          env.DB,
          id,
          status,
          session.email,
          decisionReason,
        );
        if (changed) {
          const { name } = await submissionSubject(id);
          const phrase: Record<string, string> = {
            accepted: `${name} application approved`,
            waitlisted: `${name} application waitlisted`,
            rejected: `${name} application rejected`,
            withdrawn: `${name} application withdrawn`,
            pending: `${name} moved back to pending`,
          };
          await logActivity(env.DB, {
            actorId: session.sub,
            actorEmail: session.email,
            submissionId: id,
            subject: name,
            type: status === "accepted" ? "approved" : status,
            message: phrase[status] ?? `${name} ${status}`,
          });
        }
        return changed
          ? { ok: true, message: `${id} set to ${APPLICATION_LABEL[status]}.` }
          : { ok: false, message: `Could not update ${id}.` };
      }

      case "send_decision_email": {
        const decision = await env.DB.prepare(
          `SELECT status, reject_reason AS rejectReason,
                  waitlist_reason AS waitlistReason
             FROM submissions
            WHERE id = ?`,
        )
          .bind(id)
          .first<{
            status: string;
            rejectReason: string | null;
            waitlistReason: string | null;
          }>();

        if (
          !decision ||
          !["rejected", "waitlisted", "withdrawn"].includes(decision.status) ||
          decision.status !== String(form.get("status") ?? "")
        ) {
          return {
            ok: false,
            message: `${id} changed status. Refresh the row before sending an email.`,
          };
        }

        const sent =
          decision.status === "rejected"
            ? await sendRejectionEmail(env, id, decision.rejectReason)
            : decision.status === "waitlisted"
              ? await sendWaitlistEmail(env, id, decision.waitlistReason)
              : await sendWithdrawnEmail(env, id);
        if (!sent) {
          return {
            ok: false,
            message: `Could not send the email for ${id}. Check the Google connection and try again.`,
          };
        }

        const { name } = await submissionSubject(id);
        const decisionLabel =
          decision.status === "rejected"
            ? "rejection"
            : decision.status === "waitlisted"
              ? "waitlist"
              : "withdrawal";
        await logActivity(env.DB, {
          actorId: session.sub,
          actorEmail: session.email,
          submissionId: id,
          subject: name,
          type: "email_sent",
          message: `${name} ${decisionLabel} email sent`,
        });
        return {
          ok: true,
          message: `${APPLICATION_LABEL[decision.status as ApplicationStatus]} email sent to ${name}.`,
        };
      }

      case "assign_stall": {
        const stallOptionId = String(form.get("stallOptionId") ?? "").trim();
        const changed = await assignStall(env.DB, id, stallOptionId || null);
        return changed
          ? { ok: true, message: `Stall updated for ${id}.` }
          : {
              ok: false,
              message: `${id} must be accepted before assigning a stall.`,
            };
      }

      case "send_invoice": {
        const started = await startInvoicing(env.DB, id);
        if (!started) {
          return {
            ok: false,
            message: `${id} needs to be accepted with a stall assigned first.`,
          };
        }
        try {
          await createInvoiceForSubmission(env, id);
        } catch (err) {
          // Roll the row back out of `invoicing` so the admin can retry, and
          // surface the failure instead of leaving it silently stuck.
          console.error("send_invoice failed", { id, err });
          await cancelInvoicing(env.DB, id);
          return {
            ok: false,
            message: `Couldn't create the Xero invoice for ${id}. Check the Xero connection and try again.`,
          };
        }
        {
          const { name } = await submissionSubject(id);
          await logActivity(env.DB, {
            actorId: session.sub,
            actorEmail: session.email,
            submissionId: id,
            subject: name,
            type: "invoice_sent",
            message: `${name} approved — invoice sent`,
          });
        }
        return { ok: true, message: `${id} invoiced via Xero.` };
      }

      case "set_payment": {
        const payment = String(form.get("payment") ?? "");
        if (!isManualPaymentStatus(payment)) {
          return { ok: false, message: "Unknown payment status." };
        }
        const changed = await setPaymentStatus(env.DB, id, payment);
        if (changed) {
          const { name, medium } = await submissionSubject(id);
          const entry: Record<string, { type: string; subject: string; message: string }> = {
            paid: {
              type: "paid",
              subject: name,
              message: `${name} payment received${medium ? ` · ${medium}` : ""}`,
            },
            overdue: { type: "overdue", subject: name, message: `${name} invoice overdue` },
            voided: { type: "voided", subject: id, message: `${id} invoice voided` },
            awaiting_payment: {
              type: "awaiting",
              subject: name,
              message: `${name} awaiting payment`,
            },
          };
          const e = entry[payment];
          if (e) {
            await logActivity(env.DB, {
              actorId: session.sub,
              actorEmail: session.email,
              submissionId: id,
              subject: e.subject,
              type: e.type,
              message: e.message,
            });
          }
        }
        return changed
          ? { ok: true, message: `${id} payment set to ${PAYMENT_LABEL[payment]}.` }
          : { ok: false, message: `${id} has no invoice to update.` };
      }

      case "set_archived": {
        const archived = String(form.get("archived") ?? "") === "1";
        const changed = await setArchived(env.DB, id, archived);
        return changed
          ? {
              ok: true,
              message: archived ? `${id} archived.` : `${id} unarchived.`,
            }
          : { ok: false, message: `Could not update ${id}.` };
      }

      case "set_notes": {
        const notes = String(form.get("notes") ?? "").trim();
        const changed = await setInternalNotes(env.DB, id, notes || null);
        return changed
          ? {
              ok: true,
              message: `Notes saved for ${id}.`,
              intent: "set_notes",
              id,
              notes: notes || null,
            }
          : { ok: false, message: `Could not save notes for ${id}.`, intent: "set_notes" };
      }

      default:
        return { ok: false, message: "Unknown action." };
    }
  } catch (err) {
    // Any unexpected failure (DB, network, Xero) becomes a toast rather than
    // a broken page or a silent no-op.
    console.error("inquiry action failed", { intent, id, err });
    return { ok: false, message: `Something went wrong. Please try again.` };
  }
}

// Shared fetcher: optimistically patches the row in the cache (so the UI
// updates instantly and doesn't snap back), then toasts + reconciles on
// completion. A global overlay (RowActionOverlay) shows the loading state.
function useRowAction() {
  const fetcher = useFetcher<typeof action>();
  const queryClient = useQueryClient();

  // Patch a row in every cached inquiries page right away.
  const patchRow = useCallback(
    (id: string, patch: Partial<Artist>) => {
      queryClient.setQueriesData<Paginated<Artist>>({ queryKey: ["inquiries"] }, (old) =>
        old && Array.isArray(old.data)
          ? {
              ...old,
              data: old.data.map((r) => (r.id === id ? { ...r, ...patch } : r)),
            }
          : old,
      );
    },
    [queryClient],
  );

  // Drop a row from every cached inquiries page (e.g. it no longer matches the
  // current view after archive/unarchive). Reconciled by the invalidate below.
  const removeRow = useCallback(
    (id: string) => {
      queryClient.setQueriesData<Paginated<Artist>>({ queryKey: ["inquiries"] }, (old) =>
        old && Array.isArray(old.data)
          ? { ...old, data: old.data.filter((r) => r.id !== id) }
          : old,
      );
    },
    [queryClient],
  );

  const submit = useCallback(
    (vars: Record<string, string>, patch?: Partial<Artist>) => {
      if (patch) patchRow(vars.id, patch);
      fetcher.submit(vars, { method: "post" });
    },
    [fetcher, patchRow],
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      if ("notes" in fetcher.data) {
        // The action returns the saved value. Keep the optimistic list row in
        // place instead of replacing it with a possibly older list refetch.
        const { id, notes } = fetcher.data;
        queryClient.setQueryData<ArtistDetail>(["inquiry", id], (old) =>
          old ? { ...old, internalNotes: notes ?? null } : old,
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ["inquiries"] });
        queryClient.invalidateQueries({ queryKey: ["inquiry"] });
      }
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    } else {
      toast.error(fetcher.data.message);
      // Reconcile failed optimistic changes even if the row was unmounted.
      queryClient.invalidateQueries({ queryKey: ["inquiries"] });
    }
  }, [fetcher.state, fetcher.data, queryClient]);

  return { fetcher, submit, patchRow, removeRow };
}

/** One centered progress overlay while any row mutation is in flight. */
function RowActionOverlay() {
  const fetchers = useFetchers();
  // Notes have their own in-dialog feedback, so they don't trigger the overlay.
  const active = fetchers.find(
    (f) => f.state !== "idle" && f.formData != null && f.formData.get("intent") !== "set_notes",
  );
  if (!active) return null;
  const sendingEmail = active.formData?.get("intent") === "send_decision_email";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/50 backdrop-blur-[1px]">
      <div className="flex items-center gap-3 rounded-xl border bg-background px-5 py-4 shadow-xl">
        <Loader2 className="size-5 animate-spin text-primary" />
        <span className="text-sm font-medium">{sendingEmail ? "Sending email…" : "Saving…"}</span>
      </div>
    </div>
  );
}

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Reject and waitlist both prompt for an optional note before applying.
const REASON_DECISIONS = {
  rejected: {
    title: "Reject submission",
    verb: "rejecting",
    confirm: "Confirm reject",
    variant: "destructive" as const,
    placeholder: "e.g. Portfolio below the minimum image count",
  },
  waitlisted: {
    title: "Waitlist submission",
    verb: "waitlisting",
    confirm: "Confirm waitlist",
    variant: "default" as const,
    placeholder: "e.g. Strong application — holding for a later spot",
  },
} as const;

type ReasonDecision = keyof typeof REASON_DECISIONS;

function ApplicationStatusCell({ artist }: { artist: Artist }) {
  const { fetcher, submit, patchRow } = useRowAction();
  // Rejecting or waitlisting opens a dialog for an optional note first.
  const [reasonFor, setReasonFor] = useState<ReasonDecision | null>(null);

  function onChange(value: string) {
    if (value === artist.status) return;
    if (value === "rejected" || value === "waitlisted") {
      setReasonFor(value);
      return;
    }
    submit(
      { intent: "set_status", id: artist.id, status: value },
      { status: value as ApplicationStatus },
    );
  }

  // Keep the closed dialog rendered with the last decision's copy so it doesn't
  // flicker while animating out; `copy` is only visible when reasonFor is set.
  const copy = REASON_DECISIONS[reasonFor ?? "rejected"];

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Select value={artist.status} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            aria-label={`Application status for ${artist.name}`}
            className={cn("w-[132px] border-0", applicationToneClass(artist.status))}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLICATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {APPLICATION_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DecisionEmailButton artist={artist} />
      </div>

      <Dialog open={reasonFor !== null} onOpenChange={(open) => !open && setReasonFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              Optionally add a reason for {copy.verb}{" "}
              <span className="font-medium text-foreground">{artist.name}</span>. The decision is
              saved without sending an email. If provided, this reason will be included when you
              send the notification later.
            </DialogDescription>
          </DialogHeader>
          <fetcher.Form
            method="post"
            className="grid gap-4"
            onSubmit={() => {
              if (reasonFor) patchRow(artist.id, { status: reasonFor });
              setReasonFor(null);
            }}
          >
            <input type="hidden" name="intent" value="set_status" />
            <input type="hidden" name="id" value={artist.id} />
            <input type="hidden" name="status" value={reasonFor ?? ""} />
            <div className="grid gap-2">
              <Label htmlFor={`reason-${artist.id}`}>Reason (optional)</Label>
              <Textarea
                id={`reason-${artist.id}`}
                name="reason"
                rows={4}
                placeholder={copy.placeholder}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={copy.variant}>
                {copy.confirm}
              </Button>
            </DialogFooter>
          </fetcher.Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DecisionEmailButton({ artist }: { artist: Artist }) {
  const [open, setOpen] = useState(false);
  const { submit } = useRowAction();
  if (!["rejected", "waitlisted", "withdrawn"].includes(artist.status)) return null;
  const label =
    artist.status === "rejected"
      ? "rejection"
      : artist.status === "waitlisted"
        ? "waitlist"
        : "withdrawal";
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Send ${label} email to ${artist.name}`}
        onClick={() => setOpen(true)}
      >
        <Mail className="size-3.5" /> Email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {label} email?</DialogTitle>
            <DialogDescription>
              Send the <b>{label}</b> to <b>{artist.email}</b>. This will not change the application
              status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                submit({ intent: "send_decision_email", id: artist.id, status: artist.status });
                setOpen(false);
              }}
            >
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StallCell({ artist, stalls }: { artist: Artist; stalls: StallsByEvent }) {
  const { submit } = useRowAction();

  if (artist.status !== "accepted") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const options = artist.eventId ? (stalls[artist.eventId] ?? []) : [];
  if (options.length === 0) {
    return artist.eventId ? (
      <Link
        to={`/events/${artist.eventId}`}
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        Configure stall options
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">No event</span>
    );
  }

  // Once an invoice exists (payment machine started), the stall is locked in.
  const locked = artist.paymentStatus !== "none";

  return (
    <Select
      value={artist.stallOptionId ?? ""}
      disabled={locked}
      onValueChange={(v) =>
        submit({ intent: "assign_stall", id: artist.id, stallOptionId: v }, { stallOptionId: v })
      }
    >
      <SelectTrigger
        size="sm"
        className="w-[168px]"
        aria-label={`Assigned stall for ${artist.name}`}
        title={locked ? "Locked once the invoice is sent" : undefined}
      >
        <SelectValue placeholder="Assign stall" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.tier} — ${o.unitAmount} {o.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function XeroCell({ artist }: { artist: Artist }) {
  const { submit } = useRowAction();

  // Already in the payment machine — link to the invoice if we have it.
  if (artist.paymentStatus !== "none") {
    return artist.invoiceUrl ? (
      <a
        href={artist.invoiceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        View invoice
      </a>
    ) : (
      <span className="text-sm text-muted-foreground">Sent</span>
    );
  }

  const sendable = artist.status === "accepted" && artist.stallOptionId != null;
  if (!sendable) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <Button
      size="sm"
      onClick={() =>
        submit({ intent: "send_invoice", id: artist.id }, { paymentStatus: "invoicing" })
      }
    >
      Send invoice
    </Button>
  );
}

function PaymentStatusCell({ artist }: { artist: Artist }) {
  const { submit } = useRowAction();

  // Manual statuses are only valid once an invoice exists.
  if (artist.paymentStatus === "none" || artist.paymentStatus === "invoicing") {
    return (
      <Pill className={paymentToneClass(artist.paymentStatus)}>
        {PAYMENT_LABEL[artist.paymentStatus]}
      </Pill>
    );
  }

  return (
    <Select
      value={artist.paymentStatus}
      onValueChange={(v) =>
        submit(
          { intent: "set_payment", id: artist.id, payment: v },
          { paymentStatus: v as PaymentStatus },
        )
      }
    >
      <SelectTrigger
        size="sm"
        aria-label={`Payment status for ${artist.name}`}
        className={cn("w-[168px] border-0", paymentToneClass(artist.paymentStatus))}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MANUAL_PAYMENT_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {PAYMENT_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NotesCell({ artist }: { artist: Artist }) {
  const { fetcher, patchRow } = useRowAction();
  const [open, setOpen] = useState(false);
  const [savedNotes, setSavedNotes] = useState(artist.internalNotes);
  const [draft, setDraft] = useState(artist.internalNotes ?? "");
  const busy = fetcher.state !== "idle";
  const hasNotes = (savedNotes ?? "").trim().length > 0;
  const pendingSave = useRef<{ previous: string | null } | null>(null);

  useEffect(() => {
    if (!pendingSave.current) setSavedNotes(artist.internalNotes);
  }, [artist.internalNotes]);

  // Close the dialog only after a real save cycle completes successfully —
  // tracking the busy→idle transition so reopening doesn't auto-close on the
  // stale `fetcher.data` from a previous save.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
    } else if (wasBusy.current) {
      wasBusy.current = false;
      if (fetcher.data?.ok && "notes" in fetcher.data) {
        const notes = fetcher.data.notes ?? null;
        pendingSave.current = null;
        setSavedNotes(notes);
        patchRow(artist.id, { internalNotes: notes });
        setOpen(false);
      } else if (pendingSave.current) {
        const previous = pendingSave.current.previous;
        pendingSave.current = null;
        setSavedNotes(previous);
        patchRow(artist.id, { internalNotes: previous });
        setOpen(true);
      }
    }
  }, [busy, fetcher.data, artist.id, patchRow]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => {
          setDraft(savedNotes ?? "");
          setOpen(true);
        }}
        title={hasNotes ? "Edit notes" : "Add notes"}
      >
        <StickyNote
          className={cn("size-4", hasNotes ? "text-foreground" : "text-muted-foreground")}
          fill={hasNotes ? "currentColor" : "none"}
        />
        <span className="sr-only">{hasNotes ? "Edit internal notes" : "Add internal notes"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Internal notes</DialogTitle>
            <DialogDescription>
              Private staff notes for{" "}
              <span className="font-medium text-foreground">{artist.name}</span>. Never shown to the
              applicant.
            </DialogDescription>
          </DialogHeader>
          <fetcher.Form
            method="post"
            className="grid gap-4"
            onSubmit={() => {
              const notes = draft.trim() || null;
              pendingSave.current = { previous: savedNotes };
              setSavedNotes(notes);
              patchRow(artist.id, { internalNotes: notes });
              setOpen(false);
            }}
          >
            <input type="hidden" name="intent" value="set_notes" />
            <input type="hidden" name="id" value={artist.id} />
            <Textarea
              name="notes"
              rows={5}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              placeholder="e.g. Strong portfolio — follow up about table sharing."
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save notes"
                )}
              </Button>
            </DialogFooter>
          </fetcher.Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Human-friendly submission date, e.g. "2 Jul 2026". */
function formatSubmittedAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function makeColumns(stalls: StallsByEvent): ColumnDef<Artist>[] {
  return [
    {
      accessorKey: "id",
      header: "Reference",
      enableSorting: false,
      cell: ({ row }) => (
        <RowName artist={row.original} label={row.original.id} className="font-medium" />
      ),
    },
    {
      accessorKey: "name",
      header: "Applicant",
      cell: ({ row }) => (
        <div className="min-w-32">
          <RowName artist={row.original} />
          <p className="max-w-44 truncate text-xs text-muted-foreground" title={row.original.email}>
            {row.original.email}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
    },
    {
      accessorKey: "brandName",
      header: "Brand",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-28">
          <span>{row.original.brandName ?? "—"}</span>
          <p
            className="max-w-44 truncate text-xs text-muted-foreground"
            title={row.original.primaryCategory ?? undefined}
          >
            {row.original.primaryCategory ?? "—"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "primaryCategory",
      header: "Primary category",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.primaryCategory ?? "—"}</span>
      ),
    },
    {
      accessorKey: "sharingStall",
      header: "Sharing",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.sharingStall ?? "—"}</span>
      ),
    },
    {
      accessorKey: "hasInsurance",
      header: "Insurance",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.hasInsurance ?? "—"}</span>
      ),
    },
    {
      accessorKey: "appliedBefore",
      header: "Applied before",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.appliedBefore ?? "—"}</span>
      ),
    },
    {
      accessorKey: "secondaryCategory",
      header: "Secondary category",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.secondaryCategory ?? "—"}</span>
      ),
    },
    {
      accessorKey: "instagram",
      header: "Instagram",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.instagram ?? "—"}</span>
      ),
    },
    {
      accessorKey: "submittedAt",
      header: "Submitted",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatSubmittedAt(row.original.submittedAt)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Application",
      cell: ({ row }) => <ApplicationStatusCell artist={row.original} />,
    },
    {
      id: "stall",
      header: "Stall assigned",
      enableSorting: false,
      cell: ({ row }) => <StallCell artist={row.original} stalls={stalls} />,
    },
    {
      id: "xero",
      header: "Invoice",
      enableSorting: false,
      cell: ({ row }) => <XeroCell artist={row.original} />,
    },
    {
      accessorKey: "decidedAt",
      header: "Decided",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.decidedAt ? formatSubmittedAt(row.original.decidedAt) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "paymentStatus",
      header: "Payment",
      cell: ({ row }) => <PaymentStatusCell artist={row.original} />,
    },
    {
      id: "notes",
      header: () => <span className="sr-only">Notes</span>,
      enableSorting: false,
      cell: ({ row }) => <NotesCell artist={row.original} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-right">
          <RowActions artist={row.original} />
        </div>
      ),
    },
  ];
}

export default function Inquiry({ loaderData }: Route.ComponentProps) {
  const { events, stalls } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialSearchQuery] = useState(() => parseListQuery(searchParams));
  const [legacyEventParam] = useState(() => searchParams.get("event") ?? undefined);
  const eventParam = initialSearchQuery.filters?.event_id ?? legacyEventParam;
  const initialFilters = useMemo(
    () => ({
      ...initialSearchQuery.filters,
      view: initialSearchQuery.filters?.view ?? "active",
      ...(eventParam ? { event_id: eventParam } : {}),
    }),
    [initialSearchQuery, eventParam],
  );

  const columns = useMemo(() => makeColumns(stalls), [stalls]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<ApplicationStatus | "">("");
  const [confirmAction, setConfirmAction] = useState<"status" | "delete" | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const bulkFetcher = useFetcher<typeof action>();
  const queryClient = useQueryClient();
  const bulkBusy = bulkFetcher.state !== "idle";
  const bulkWasBusy = useRef(false);

  useEffect(() => {
    if (bulkBusy) bulkWasBusy.current = true;
    else if (bulkWasBusy.current) {
      bulkWasBusy.current = false;
      if (bulkFetcher.data?.ok) {
        toast.success(bulkFetcher.data.message);
        setSelectedIds([]);
        queryClient.invalidateQueries({ queryKey: ["inquiries"] });
        queryClient.invalidateQueries({ queryKey: ["summary"] });
      } else if (bulkFetcher.data) toast.error(bulkFetcher.data.message);
    }
  }, [bulkBusy, bulkFetcher.data, queryClient]);

  const submitBulk = (intent: "bulk_status" | "bulk_delete") => {
    const data = new FormData();
    data.set("intent", intent);
    if (intent === "bulk_status") data.set("status", bulkStatus);
    for (const id of selectedIds) data.append("ids", id);
    bulkFetcher.submit(data, { method: "post" });
    setConfirmAction(null);
  };

  // The stall filter is scoped to the currently selected event, so we mirror
  // that filter's value here to build the right stall options.
  const [selectedEvent, setSelectedEvent] = useState<string | null>(eventParam ?? null);

  const filters: FilterDef[] = useMemo(() => {
    const defs: FilterDef[] = [
      {
        id: "status",
        label: "Application",
        options: APPLICATION_STATUSES.map((s) => ({
          label: APPLICATION_LABEL[s],
          value: s,
        })),
      },
      {
        id: "payment_status",
        label: "Payment",
        options: (["awaiting_payment", "paid", "overdue", "voided", "none"] as PaymentStatus[]).map(
          (s) => ({ label: PAYMENT_LABEL[s], value: s }),
        ),
      },
      {
        id: "event_id",
        label: "Event",
        options: events.map((e: EventWithCounts) => ({
          label: e.name,
          value: e.id,
        })),
      },
      {
        // "All views" (the cleared state) shows both active + archived.
        id: "view",
        label: "views",
        options: [
          { label: "Active", value: "active" },
          { label: "Archived", value: "archived" },
        ],
      },
    ];

    // Only meaningful once a single event is selected — stalls are per-event.
    const stallOptions = selectedEvent ? (stalls[selectedEvent] ?? []) : [];
    if (stallOptions.length > 0) {
      defs.push({
        id: "stall_option_id",
        label: "Stall",
        options: stallOptions.map((o) => ({
          label: `${o.tier} — $${o.unitAmount} ${o.currency}`,
          value: o.id,
        })),
      });
    }

    return defs;
  }, [events, stalls, selectedEvent]);

  // Track the live table query so Copy emails can reproduce the filtered set
  // and so the stall filter can follow the selected event.
  const queryRef = useRef<ListQuery>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const onQueryChange = useCallback(
    (q: ListQuery) => {
      if (JSON.stringify(queryRef.current) !== JSON.stringify(q)) setSelectedIds([]);
      queryRef.current = q;
      setSelectedEvent(q.filters?.event_id ?? null);

      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const key of [...next.keys()]) {
            if (
              key === "event" ||
              key === "page" ||
              key === "pageSize" ||
              key === "search" ||
              key === "sort" ||
              key === "dir" ||
              key.startsWith("search.") ||
              key.startsWith("filter.")
            )
              next.delete(key);
          }
          const tableParams = listQueryToSearchParams(q);
          if (q.page === 1) tableParams.delete("page");
          if (q.pageSize === DEFAULT_PAGE_SIZE) tableParams.delete("pageSize");
          if (q.filters?.view === "active") tableParams.delete("filter.view");
          tableParams.forEach((value, key) => next.append(key, value));
          return next.toString() === current.toString() ? current : next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const copyEmails = useCallback(async () => {
    const sp = listQueryToSearchParams(queryRef.current);
    sp.set("emails", "1");
    try {
      const res = await fetch(`/api/inquiries?${sp}`);
      if (!res.ok) throw new Error();
      const { emails } = (await res.json()) as { emails: string[] };
      if (!emails.length) {
        toast.message("No emails match the current filters.");
        return;
      }
      await navigator.clipboard.writeText(emails.join(", "));
      toast.success(`Copied ${emails.length} email${emails.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Could not copy emails.");
    }
  }, []);

  // Export every submission matching the current filters/search as a CSV file.
  // The server sets Content-Disposition, so a plain same-origin anchor download
  // (auth cookie sent automatically) is enough.
  const exportCsv = useCallback(() => {
    const sp = listQueryToSearchParams(queryRef.current);
    sp.set("format", "csv");
    const a = document.createElement("a");
    a.href = `/api/inquiries?${sp}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const openBackup = useCallback(async () => {
    try {
      const res = await fetch("/api/inquiries?page=1&pageSize=1");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as Paginated<Artist>;
      setBackupCount(data.total);
      setBackupOpen(true);
    } catch {
      toast.error("Could not prepare the backup.");
    }
  }, []);

  const downloadBackup = () => {
    const a = document.createElement("a");
    a.href = "/api/inquiries?format=backup";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setBackupOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <RowActionOverlay />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Artist submissions</h1>
        <p className="text-sm text-muted-foreground">
          Review applications, assign stalls, and trigger Xero invoices.
        </p>
      </div>

      <BaseTable
        queryKey={["inquiries"]}
        queryFn={fetchArtists}
        columns={columns}
        getRowId={(a) => a.id}
        refetchInterval={15000}
        searchPlaceholder="Search name, email, or brand…"
        initialSearch={initialSearchQuery.search}
        initialSearches={initialSearchQuery.searches}
        initialPage={initialSearchQuery.page}
        initialPageSize={initialSearchQuery.pageSize}
        initialSort={initialSearchQuery.sort}
        advancedSearchFields={[
          { id: "reference", label: "Reference", placeholder: "e.g. ART-12345678" },
          {
            id: "name",
            label: "Name",
            placeholder: "e.g. Alice Smith",
          },
          { id: "brand", label: "Brand", placeholder: "e.g. Lumen Studio" },
          {
            id: "email",
            label: "Email",
            placeholder: "e.g. alice@example.com",
          },
          { id: "primaryCategory", label: "Primary category" },
          { id: "secondaryCategory", label: "Secondary category" },
          { id: "instagram", label: "Instagram" },
          { id: "website", label: "Website" },
          { id: "notes", label: "Internal notes" },
          { id: "appliedBefore", label: "Applied before" },
          { id: "secondArtist", label: "Second artist" },
        ]}
        columnOptions={[
          { id: "status", label: "Application" },
          { id: "stall", label: "Stall" },
          { id: "paymentStatus", label: "Payment" },
          { id: "email", label: "Email address", defaultVisible: false },
          { id: "primaryCategory", label: "Primary category", defaultVisible: false },
          { id: "sharingStall", label: "Sharing", defaultVisible: false },
          { id: "hasInsurance", label: "Insurance", defaultVisible: false },
          { id: "appliedBefore", label: "Applied before", defaultVisible: false },
          { id: "secondaryCategory", label: "Secondary category", defaultVisible: false },
          { id: "instagram", label: "Instagram", defaultVisible: false },
          { id: "xero", label: "Invoice" },
          { id: "decidedAt", label: "Decided", defaultVisible: false },
        ]}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        selectionToolbar={
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/60 px-3 py-2.5">
            <span className="mr-auto text-sm font-semibold">
              {selectedIds.length} submission{selectedIds.length === 1 ? "" : "s"} selected
            </span>
            <Select
              value={bulkStatus}
              onValueChange={(value) => setBulkStatus(value as ApplicationStatus)}
            >
              <SelectTrigger
                size="sm"
                className="w-40 bg-background"
                aria-label="Bulk application status"
              >
                <SelectValue placeholder="Change status…" />
              </SelectTrigger>
              <SelectContent>
                {APPLICATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {APPLICATION_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/85"
              disabled={!bulkStatus || bulkBusy}
              onClick={() => setConfirmAction("status")}
            >
              Apply status
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setSelectedIds([])}
            >
              Clear selection
            </Button>
          </div>
        }
        filters={filters}
        defaultMode="table"
        initialFilters={initialFilters}
        onQueryChange={onQueryChange}
        toolbarExtra={
          <>
            <Button variant="outline" size="sm" onClick={copyEmails}>
              <Copy className="size-4" />
              Copy emails
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={openBackup}>
              <Download className="size-4" /> Backup data
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={selectedIds.length === 0}
              onClick={() => setConfirmAction("delete")}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </>
        }
        renderGridItem={(a) => <ArtistCard artist={a} stalls={stalls} />}
        renderListItem={(a) => <ArtistRow artist={a} />}
        emptyMessage="No submissions match your filters."
      />

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-[500px]"
          showCloseButton={false}
        >
          <div className="space-y-4 p-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                {confirmAction === "delete" && (
                  <span className="flex size-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                    <TriangleAlert className="size-4" />
                  </span>
                )}
                {confirmAction === "delete"
                  ? "Delete selected submissions?"
                  : "Update selected submissions?"}
              </DialogTitle>
              <DialogDescription>
                {confirmAction === "delete"
                  ? `You are about to permanently delete ${selectedIds.length} selected submission${selectedIds.length === 1 ? "" : "s"}.`
                  : `Change ${selectedIds.length} selected submission${selectedIds.length === 1 ? "" : "s"} to ${bulkStatus ? APPLICATION_LABEL[bulkStatus] : "the selected status"}?`}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/60 px-4 py-3 text-sm">
              {confirmAction === "delete" ? (
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>
                    The selected application records, decisions, and internal notes will be removed
                  </li>
                  <li>
                    Related local invoice and payment records and uploaded files will be removed
                  </li>
                  <li>All other submissions will remain unchanged</li>
                </ul>
              ) : (
                <p>
                  No emails will be sent automatically. Use the email button beside a submission’s
                  status to send its template.
                </p>
              )}
            </div>
            {confirmAction === "delete" && (
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">This cannot be undone.</strong> Review your
                selection before continuing. Issued Xero invoices will remain in Xero.
              </p>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none bg-muted/30 px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmAction === "delete" ? "destructive" : "default"}
              className={
                confirmAction === "delete"
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "bg-foreground text-background hover:bg-foreground/85"
              }
              disabled={bulkBusy}
              onClick={() => submitBulk(confirmAction === "delete" ? "bulk_delete" : "bulk_status")}
            >
              {confirmAction === "delete"
                ? `Delete ${selectedIds.length} submission${selectedIds.length === 1 ? "" : "s"}`
                : `Apply ${bulkStatus ? APPLICATION_LABEL[bulkStatus] : "status"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Back up this data?</DialogTitle>
            <DialogDescription>
              Download a ZIP with {backupCount ?? "all"} records: inquiries.csv, inquiries.html and
              an images folder. Current filters are ignored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBackupOpen(false)}>
              No
            </Button>
            <Button type="button" onClick={downloadBackup}>
              Yes, back up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPills({ artist }: { artist: Artist }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill className={applicationToneClass(artist.status)}>
        {APPLICATION_LABEL[artist.status]}
      </Pill>
      <Pill className={paymentToneClass(artist.paymentStatus)}>
        {PAYMENT_LABEL[artist.paymentStatus]}
      </Pill>
      <DecisionEmailButton artist={artist} />
    </div>
  );
}

function ArtistCard({ artist, stalls }: { artist: Artist; stalls: StallsByEvent }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              <RowName artist={artist} className="text-base font-semibold" />
            </CardTitle>
            <p className="text-xs text-muted-foreground">{artist.id}</p>
          </div>
          <StatusPills artist={artist} />
        </div>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>{artist.brandName ?? "—"}</p>
          <p>{artist.primaryCategory ?? "—"}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StallCell artist={artist} stalls={stalls} />
          <RowActions artist={artist} />
        </div>
      </CardContent>
    </Card>
  );
}

function ArtistRow({ artist }: { artist: Artist }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1">
          <RowName artist={artist} className="min-w-0 truncate font-medium" />
          <span className="shrink-0 font-normal text-muted-foreground">· {artist.id}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {artist.brandName ?? artist.primaryCategory ?? "—"} · {artist.email}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <StatusPills artist={artist} />
        <RowActions artist={artist} />
      </div>
    </div>
  );
}

function RowActions({ artist }: { artist: Artist }) {
  const [viewOpen, setViewOpen] = useState(false);
  const { submit, removeRow } = useRowAction();
  const archived = artist.archivedAt != null;

  function toggleArchive() {
    // Optimistically drop it from the current view; the refetch reconciles.
    removeRow(artist.id);
    submit({
      intent: "set_archived",
      id: artist.id,
      archived: archived ? "0" : "1",
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setViewOpen(true)}>View profile</DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleArchive}>
              {archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ViewProfileDialog artist={artist} open={viewOpen} onOpenChange={setViewOpen} />
    </>
  );
}

function RowName({
  artist,
  className,
  label,
}: {
  artist: Artist;
  className?: string;
  label?: string;
}) {
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <>
      <Button
        variant="link"
        onClick={() => setViewOpen(true)}
        className={cn("h-auto max-w-full justify-start p-0 text-left", className)}
        aria-label={`View profile for ${artist.name}`}
      >
        {label ?? artist.name}
      </Button>
      <ViewProfileDialog artist={artist} open={viewOpen} onOpenChange={setViewOpen} />
    </>
  );
}

function ViewProfileDialog({
  artist,
  open,
  onOpenChange,
}: {
  artist: Artist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["inquiry", artist.id],
    queryFn: async (): Promise<ArtistDetail> => {
      const res = await fetch(`/api/inquiries/${artist.id}`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: open,
  });

  const portfolio = data?.images.filter((i) => i.kind === "portfolio") ?? [];
  const insurance = data?.images.filter((i) => i.kind === "insurance") ?? [];
  const secondPortfolio = data?.images.filter((i) => i.kind === "second_portfolio") ?? [];
  // Show the second-artist block whenever any buddy data came through.
  const secondName = [data?.secondFirstName, data?.secondLastName].filter(Boolean).join(" ");
  const hasSecondArtist = Boolean(
    data && (secondName || data.secondEmail || data.secondBrandName || secondPortfolio.length),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-5 sm:max-w-3xl">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle className="text-lg">
            {data?.brandName ?? artist.brandName ?? artist.name}
          </DialogTitle>
          <DialogDescription>
            {artist.name} · {artist.id}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <Pill className={applicationToneClass(data?.status ?? artist.status)}>
            {APPLICATION_LABEL[data?.status ?? artist.status]}
          </Pill>
        </div>

        {isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Could not load this profile.
          </p>
        ) : (
          <div className="mt-4 divide-y border-t">
            <ProfileSection title="Applicant">
              <dl className="grid gap-2 text-sm">
                <Detail label="Email" value={data.email || "—"} href={`mailto:${data.email}`} />
                <Detail
                  label="Instagram"
                  value={data.instagram ?? "—"}
                  href={externalHref(data.instagram, true)}
                />
                <Detail
                  label="Website"
                  value={data.website ?? "—"}
                  href={externalHref(data.website)}
                />
                <Detail label="Applied before" value={data.appliedBefore ?? "—"} />
                <Detail label="Insurance" value={data.hasInsurance ?? "—"} />
              </dl>
            </ProfileSection>

            <ProfileSection title="Practice">
              <dl className="grid gap-2 text-sm">
                <Detail label="Primary" value={data.primaryCategory ?? "—"} />
                <Detail label="Secondary" value={data.secondaryCategory ?? "—"} />
                <Detail label="Products" value={data.productDescription ?? "—"} />
                <Detail label="Bio" value={data.bio || "—"} />
              </dl>
            </ProfileSection>

            <ProfileSection title="Stall">
              <dl className="grid gap-2 text-sm">
                <Detail label="Event" value={data.eventName ?? "—"} />
                <Detail label="1st stall preference" value={data.firstStallPreference ?? "—"} />
                <Detail label="2nd stall preference" value={data.secondStallPreference ?? "—"} />
                <Detail label="Take paired Mini?" value={data.offerMiniIfUnavailable ?? "—"} />
                <Detail label="Sharing a stall?" value={data.sharingStall ?? "—"} />
                <Detail label="Stall assigned" value={data.stallTier ?? "—"} />
                <Detail label="Payment" value={PAYMENT_LABEL[data.paymentStatus]} />
              </dl>
            </ProfileSection>

            {(data.additionalNotes ||
              data.internalNotes ||
              data.rejectReason ||
              data.waitlistReason) && (
              <ProfileSection title="Notes & decision">
                <dl className="grid gap-2 text-sm">
                  {data.additionalNotes && (
                    <Detail label="Additional notes" value={data.additionalNotes} />
                  )}
                  {data.internalNotes && (
                    <Detail label="Internal notes" value={data.internalNotes} />
                  )}
                  {data.rejectReason && (
                    <Detail label="Rejection reason" value={data.rejectReason} />
                  )}
                  {data.waitlistReason && (
                    <Detail label="Waitlist reason" value={data.waitlistReason} />
                  )}
                </dl>
              </ProfileSection>
            )}
            <ProfileSection title={`Documents (${portfolio.length + insurance.length})`}>
              <div className="grid gap-3">
                {portfolio.length > 0 && (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Portfolio ({portfolio.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {portfolio.map((doc, i) => (
                        <DocLink
                          key={doc.id}
                          href={`/api/files/${doc.key}`}
                          label={portfolio.length > 1 ? `Portfolio ${i + 1}` : "Portfolio"}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {insurance.length > 0 && (
                  <div className="grid gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Insurance ({insurance.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {insurance.map((doc, i) => (
                        <DocLink
                          key={doc.id}
                          href={`/api/files/${doc.key}`}
                          label={`Insurance ${i + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {portfolio.length === 0 && insurance.length === 0 && (
                  <span className="text-sm text-muted-foreground">No documents uploaded.</span>
                )}
              </div>
            </ProfileSection>

            {hasSecondArtist && data && (
              <ProfileSection title="Second artist">
                <dl className="grid gap-2 text-sm">
                  <Detail label="Name" value={secondName || "—"} />
                  <Detail
                    label="Email"
                    value={data.secondEmail ?? "—"}
                    href={data.secondEmail ? `mailto:${data.secondEmail}` : undefined}
                  />
                  <Detail label="Applied before" value={data.secondAppliedBefore ?? "—"} />
                  <Detail label="Brand" value={data.secondBrandName ?? "—"} />
                  <Detail
                    label="Website"
                    value={data.secondWebsite ?? "—"}
                    href={externalHref(data.secondWebsite)}
                  />
                  <Detail
                    label="Instagram"
                    value={data.secondInstagram ?? "—"}
                    href={externalHref(data.secondInstagram, true)}
                  />
                  <Detail label="Primary category" value={data.secondPrimaryCategory ?? "—"} />
                  <Detail label="Secondary category" value={data.secondSecondaryCategory ?? "—"} />
                </dl>

                {data.secondBio && (
                  <dl className="text-sm">
                    <Detail label="Bio" value={data.secondBio} />
                  </dl>
                )}
                {data.secondProductDescription && (
                  <dl className="text-sm">
                    <Detail label="Products" value={data.secondProductDescription} />
                  </dl>
                )}

                <Field label="Documents">
                  <div className="flex flex-wrap gap-2">
                    {secondPortfolio.length > 0 ? (
                      secondPortfolio.map((doc, i) => (
                        <DocLink
                          key={doc.id}
                          href={`/api/files/${doc.key}`}
                          label={secondPortfolio.length > 1 ? `Portfolio ${i + 1}` : "Portfolio"}
                        />
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No portfolio uploaded.</span>
                    )}
                  </div>
                </Field>
              </ProfileSection>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function externalHref(value: string | null | undefined, instagram = false): string | undefined {
  const raw = value?.trim();
  if (!raw || /^n\/?a$/i.test(raw)) return undefined;
  const candidate =
    instagram && /^@?[\w.]+$/.test(raw)
      ? `https://www.instagram.com/${raw.replace(/^@/, "")}/`
      : /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function Detail({ label, value, href }: { label: string; value?: string; href?: string }) {
  return (
    <div className="grid grid-cols-[minmax(100px,140px)_minmax(0,1fr)] gap-2 sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">
        {href ? (
          <a
            href={href}
            target={href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-primary"
          >
            {value ?? "—"}
            {!href.startsWith("mailto:") && (
              <ExternalLink className="size-3 text-muted-foreground" />
            )}
          </a>
        ) : (
          (value ?? "—")
        )}
      </dd>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 py-5 first:pt-5 last:pb-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-primary underline-offset-2 hover:bg-muted hover:underline"
    >
      <Paperclip className="size-3.5" />
      {label}
    </a>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}
