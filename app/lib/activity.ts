/** Client-safe activity presentation helpers (colors + relative time). */

export type ActivityItem = {
  id: string;
  actorEmail: string | null;
  submissionId: string | null;
  subject: string | null;
  type: string;
  message: string;
  createdAt: string;
};

const DOT: Record<string, string> = {
  approved: "#16a34a",
  invoice_sent: "#16a34a",
  email_sent: "#2563eb",
  paid: "#16a34a",
  awaiting: "#60a5fa",
  pending: "#a3a3a3",
  waitlisted: "#c084fc",
  overdue: "#f97316",
  voided: "#a3a3a3",
  rejected: "#ef4444",
  withdrawn: "#737373",
  deleted: "#ef4444",
};

export function activityDot(type: string): string {
  return DOT[type] ?? "#a3a3a3";
}

const LABEL: Record<string, string> = {
  approved: "Approved",
  invoice_sent: "Invoice sent",
  email_sent: "Email sent",
  paid: "Payment",
  awaiting: "Awaiting",
  pending: "Pending",
  waitlisted: "Waitlisted",
  overdue: "Overdue",
  voided: "Voided",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  deleted: "Deleted",
};

export function activityLabel(type: string): string {
  return LABEL[type] ?? type;
}

/** "2 hours ago", "Yesterday, 14:22", "3 days ago". Input is UTC datetime. */
export function formatRelative(iso: string): string {
  const ms = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return iso;
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) {
    const t = new Date(ms).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `Yesterday, ${t}`;
  }
  if (day < 7) return `${day} days ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
