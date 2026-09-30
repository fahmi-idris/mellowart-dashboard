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

/** An event can have templates while it is upcoming or has not ended. */
export function isEventAvailableForTemplates(
  event: Pick<EventSummary, "endsAt">,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return !event.endsAt || event.endsAt.slice(0, 10) >= today;
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
