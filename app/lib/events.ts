/**
 * Client-safe event + stall-option types. Kept out of `events.server` so route
 * components can import them without pulling server-only code into the bundle.
 */

export interface EventSummary {
  id: string;
  webflowId: string | null;
  name: string;
  slug: string;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface EventWithCounts extends EventSummary {
  /** Total applications for the event. */
  applicants: number;
  /** Applications still in `pending` ("X awaiting review"). */
  awaitingReview: number;
}

export type EventPhase = "upcoming" | "ongoing" | "inactive" | "unscheduled";

/** Date-only event lifecycle. End dates remain active through their final day. */
export function getEventPhase(
  event: Partial<Pick<EventSummary, "startsAt" | "endsAt">>,
  today = new Date().toISOString().slice(0, 10),
): EventPhase {
  const start = event.startsAt?.slice(0, 10);
  const end = event.endsAt?.slice(0, 10);
  if (end && end < today) return "inactive";
  if (start && start > today) return "upcoming";
  if (!start && !end) return "unscheduled";
  return "ongoing";
}

/** Upcoming, ongoing, and undated events remain available for templates. */
export function isEventAvailableForTemplates(
  event: Partial<Pick<EventSummary, "startsAt" | "endsAt">>,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return getEventPhase(event, today) !== "inactive";
}

export interface StallOption {
  id: string;
  eventId: string;
  tier: string;
  slug: string | null;
  unitAmount: number;
  currency: string;
  frontage: string | null;
  furniture: string | null;
  sharing: string | null;
  sortOrder: number;
}

/** A short, admin-facing label for a stall option, e.g. "Standard — $450 AUD". */
export function stallLabel(o: Pick<StallOption, "tier" | "unitAmount" | "currency">): string {
  return `${o.tier} — $${o.unitAmount} ${o.currency}`;
}
