import { listActivity, type ActivityEntry } from "~/lib/activity.server";

export interface InquirySummary {
  total: number;
  pending: number;
  accepted: number;
  waitlisted: number;
  rejected: number;
  withdrawn: number;
}

export interface RecentSubmission {
  id: string;
  name: string;
  status: string;
  stallTier: string | null;
  stallSlug: string | null;
  paymentStatus: string;
}

interface StatusRow {
  status: string;
  count: number;
}

/** Counts grouped by status, in a single query. Optionally scoped to an event. */
export async function getInquirySummary(
  db: D1Database,
  eventId?: string | null,
): Promise<InquirySummary> {
  const stmt = db.prepare(
    `SELECT status, COUNT(*) AS count FROM submissions
      ${eventId ? "WHERE event_id = ?" : ""}
      GROUP BY status`,
  );
  const res = await (eventId ? stmt.bind(eventId) : stmt).all<StatusRow>();

  const summary: InquirySummary = {
    total: 0,
    pending: 0,
    accepted: 0,
    waitlisted: 0,
    rejected: 0,
    withdrawn: 0,
  };

  for (const row of res.results ?? []) {
    const count = Number(row.count);
    if (row.status === "pending") summary.pending = count;
    else if (row.status === "accepted") summary.accepted = count;
    else if (row.status === "waitlisted") summary.waitlisted = count;
    else if (row.status === "rejected") summary.rejected = count;
    else if (row.status === "withdrawn") summary.withdrawn = count;
    summary.total += count;
  }

  return summary;
}

type Metric = "total" | "pending" | "accepted" | "rejected";

export interface DashboardData {
  counts: InquirySummary;
  /** % change vs the previous 30 days. null = no prior baseline ("New"). */
  deltas: Record<Metric, number | null>;
  /** Daily counts for the last 30 days (oldest first). */
  sparks: Record<Metric, number[]>;
  /** Overall daily submissions, last 30 days. */
  trend: { date: string; count: number }[];
  /** Outcome breakdown for the donut (non-zero buckets only). */
  breakdown: { key: string; label: string; count: number }[];
  /** Last 5 submissions. */
  recentSubmissions: RecentSubmission[];
  /** Latest activity-log entries. */
  recentActivity: ActivityEntry[];
}

interface DailyStatusRow {
  d: string;
  status: string;
  c: number;
}

interface BreakdownRow {
  status: string;
  ps: string;
  c: number;
}

/** `n` UTC day keys (YYYY-MM-DD) ending today, oldest first. */
function dayKeys(n: number): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

const BREAKDOWN_ORDER: { key: string; label: string }[] = [
  { key: "paid", label: "Approved · Paid" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "invoicing", label: "Invoicing" },
  { key: "accepted", label: "Accepted" },
  { key: "pending", label: "Pending" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "overdue", label: "Overdue" },
  { key: "voided", label: "Invoice voided" },
  { key: "rejected", label: "Rejected" },
  { key: "withdrawn", label: "Withdrawn" },
];

/** Rich dashboard payload: counts, deltas, sparklines, trend, and breakdown. */
export async function getDashboardData(
  db: D1Database,
  eventId?: string | null,
): Promise<DashboardData> {
  const counts = await getInquirySummary(db, eventId);

  // 60 days of daily counts per status (current 30 + previous 30 for deltas).
  const dailyStmt = db.prepare(
    `SELECT date(created_at) AS d, status, COUNT(*) AS c
       FROM submissions
      WHERE created_at >= date('now', '-59 days')
        ${eventId ? "AND event_id = ?" : ""}
      GROUP BY d, status`,
  );
  const daily = await (eventId ? dailyStmt.bind(eventId) : dailyStmt).all<DailyStatusRow>();

  const keys = dayKeys(60);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const series: Record<Metric, number[]> = {
    total: new Array(60).fill(0),
    pending: new Array(60).fill(0),
    accepted: new Array(60).fill(0),
    rejected: new Array(60).fill(0),
  };
  for (const row of daily.results ?? []) {
    const i = idx.get(row.d);
    if (i == null) continue;
    const c = Number(row.c);
    series.total[i] += c;
    if (row.status === "pending") series.pending[i] += c;
    else if (row.status === "accepted") series.accepted[i] += c;
    else if (row.status === "rejected") series.rejected[i] += c;
  }

  const metrics: Metric[] = ["total", "pending", "accepted", "rejected"];
  const sparks = {} as Record<Metric, number[]>;
  const deltas = {} as Record<Metric, number | null>;
  for (const m of metrics) {
    const arr = series[m];
    const prev = arr.slice(0, 30).reduce((a, b) => a + b, 0);
    const cur = arr.slice(30).reduce((a, b) => a + b, 0);
    sparks[m] = arr.slice(30);
    deltas[m] = prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 100);
  }

  const trend = dayKeys(30).map((date, i) => ({
    date,
    count: series.total[30 + i],
  }));

  // Outcome breakdown for the donut.
  const brStmt = db.prepare(
    `SELECT status, payment_status AS ps, COUNT(*) AS c
       FROM submissions
      ${eventId ? "WHERE event_id = ?" : ""}
      GROUP BY status, payment_status`,
  );
  const br = await (eventId ? brStmt.bind(eventId) : brStmt).all<BreakdownRow>();
  const buckets = new Map<string, number>();
  const add = (k: string, c: number) => buckets.set(k, (buckets.get(k) ?? 0) + c);
  for (const row of br.results ?? []) {
    const c = Number(row.c);
    if (row.status === "rejected") add("rejected", c);
    else if (row.status === "withdrawn") add("withdrawn", c);
    else if (row.status === "pending") add("pending", c);
    else if (row.status === "waitlisted") add("waitlisted", c);
    else if (row.status === "accepted") {
      const map: Record<string, string> = {
        paid: "paid",
        awaiting_payment: "awaiting_payment",
        overdue: "overdue",
        voided: "voided",
        invoicing: "invoicing",
      };
      add(map[row.ps] ?? "accepted", c);
    }
  }
  const breakdown = BREAKDOWN_ORDER.map((o) => ({
    ...o,
    count: buckets.get(o.key) ?? 0,
  })).filter((b) => b.count > 0);

  const recentStmt = db.prepare(
    `SELECT s.id, (s.first_name || ' ' || s.last_name) AS name, s.status,
            o.tier AS stallTier, o.slug AS stallSlug,
            s.payment_status AS paymentStatus
       FROM submissions s
       LEFT JOIN stall_options o ON o.id = s.stall_option_id
      ${eventId ? "WHERE s.event_id = ?" : ""}
      ORDER BY s.created_at DESC
      LIMIT 5`,
  );
  const recent = await (eventId ? recentStmt.bind(eventId) : recentStmt).all<RecentSubmission>();
  const recentSubmissions = recent.results ?? [];

  const recentActivity = await listActivity(db, 8, eventId);

  return {
    counts,
    deltas,
    sparks,
    trend,
    breakdown,
    recentSubmissions,
    recentActivity,
  };
}
