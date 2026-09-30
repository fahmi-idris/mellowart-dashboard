import { env } from "cloudflare:workers";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

import type { Route } from "./+types/dashboard";
import { Button } from "~/components/ui/button";
import { Donut, Sparkline, TrendChart } from "~/components/charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { requireAdmin } from "~/lib/auth.server";
import { listEventsWithCounts } from "~/lib/events.server";
import { activityDot, formatRelative, type ActivityItem } from "~/lib/activity";
import {
  APPLICATION_LABEL,
  applicationToneClass,
  type ApplicationStatus,
} from "~/lib/status";
import { cn } from "~/lib/utils";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Dashboard · Mellow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const events = await listEventsWithCounts(env.DB);
  return { events };
}

type Metric = "total" | "pending" | "accepted" | "rejected";

type RecentSubmission = {
  id: string;
  name: string;
  status: ApplicationStatus;
  stallTier: string | null;
  stallSlug: string | null;
  paymentStatus: string;
};

type DashboardData = {
  counts: Record<"total" | "pending" | "accepted" | "waitlisted" | "rejected", number>;
  deltas: Record<Metric, number | null>;
  sparks: Record<Metric, number[]>;
  trend: { date: string; count: number }[];
  breakdown: { key: string; label: string; count: number }[];
  recentSubmissions: RecentSubmission[];
  recentActivity: ActivityItem[];
};

const CARDS: {
  key: Metric;
  label: string;
  color: string;
  /** Up is "bad" (e.g. rejections) → red instead of green. */
  invert?: boolean;
}[] = [
  { key: "total", label: "Total inquiries", color: "hsl(var(--foreground))" },
  { key: "pending", label: "Pending review", color: "hsl(var(--muted-foreground))" },
  { key: "accepted", label: "Approved", color: "#16a34a" },
  { key: "rejected", label: "Rejected", color: "#ef4444", invert: true },
];

const BREAKDOWN_COLOR: Record<string, string> = {
  paid: "#18181b",
  awaiting_payment: "#f472b6",
  invoicing: "#60a5fa",
  accepted: "#34d399",
  pending: "#fbbf24",
  waitlisted: "#c084fc",
  overdue: "#fb923c",
  voided: "#a3a3a3",
  rejected: "#ef4444",
};

async function fetchDashboard(eventId: string): Promise<DashboardData> {
  const qs = eventId ? `?event=${encodeURIComponent(eventId)}` : "";
  const res = await fetch(`/api/summary${qs}`);
  if (!res.ok) throw new Error("Failed to load dashboard");
  return res.json();
}

function DeltaBadge({ delta, invert }: { delta: number | null; invert?: boolean }) {
  if (delta === null) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/40">
        New
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        — Same
      </span>
    );
  }
  const up = delta > 0;
  const good = invert ? !up : up;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        good
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
          : "bg-red-50 text-red-600 dark:bg-red-950/40",
      )}
    >
      {up ? "↑" : "↓"} {Math.abs(delta)}%
    </span>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { events } = loaderData;
  // Scope the whole dashboard to one event, defaulting to the first (newest).
  const [eventId, setEventId] = useState<string>(events[0]?.id ?? "");

  const { data, isPending, isError } = useQuery({
    queryKey: ["summary", eventId],
    queryFn: () => fetchDashboard(eventId),
    refetchInterval: 15000,
  });

  const segments =
    data?.breakdown.map((b) => ({
      label: b.label,
      value: b.count,
      color: BREAKDOWN_COLOR[b.key] ?? "#a3a3a3",
    })) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of incoming applications and their status.
          </p>
        </div>
        {events.length > 0 && (
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger
              className="w-full sm:w-64"
              aria-label="Filter dashboard by event"
            >
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.key}>
            <CardHeader className="gap-1 pb-2">
              <CardDescription>{c.label}</CardDescription>
              <div className="flex items-center justify-between gap-2">
                {isPending ? (
                  <Skeleton className="h-9 w-14" />
                ) : (
                  <CardTitle className="text-3xl tabular-nums">
                    {isError ? "—" : data?.counts[c.key] ?? 0}
                  </CardTitle>
                )}
                {!isPending && !isError && data && (
                  <DeltaBadge delta={data.deltas[c.key]} invert={c.invert} />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {isPending ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <Sparkline
                  data={data?.sparks[c.key] ?? []}
                  color={c.color}
                  className="h-8 w-full"
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend + breakdown */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Application trend</CardTitle>
            <CardDescription>Submissions over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <TrendChart data={data?.trend ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status breakdown</CardTitle>
            <CardDescription>Current period</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-5">
            {isPending ? (
              <Skeleton className="size-40 rounded-full" />
            ) : segments.length === 0 ? (
              <p className="py-12 text-sm text-muted-foreground">No data yet.</p>
            ) : (
              <>
                <Donut segments={segments} total={data?.counts.total ?? 0} />
                <div className="flex w-full flex-col gap-2">
                  {data?.breakdown.map((b) => (
                    <div
                      key={b.key}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: BREAKDOWN_COLOR[b.key] }}
                        />
                        {b.label}
                      </span>
                      <span className="font-medium tabular-nums">{b.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent submissions + activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">Recent submissions</CardTitle>
              <CardDescription>Last 5 artist applications</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/inquiry">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : (data?.recentSubmissions.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No submissions yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Reference</th>
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">App status</th>
                      <th className="pb-2 font-medium">Stall</th>
                      <th className="pb-2 font-medium">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.recentSubmissions.map((s) => {
                      const paid = s.paymentStatus === "paid";
                      return (
                        <tr key={s.id} className="border-t">
                          <td className="py-2 font-mono text-xs text-muted-foreground">
                            {s.id}
                          </td>
                          <td className="py-2 font-medium">{s.name}</td>
                          <td className="py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                                applicationToneClass(s.status),
                              )}
                            >
                              {APPLICATION_LABEL[s.status]}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {s.stallTier ?? "—"}
                          </td>
                          <td className="py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                                paid
                                  ? "bg-foreground text-background"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {paid ? "Paid" : "Unpaid"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>Latest status changes</CardDescription>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <div className="flex flex-col gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (data?.recentActivity.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No activity yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {data?.recentActivity.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: activityDot(a.type) }}
                    />
                    <div className="min-w-0">
                      {a.subject && a.message.startsWith(a.subject) ? (
                        <p className="text-sm leading-snug">
                          <span className="font-semibold">{a.subject}</span>
                          {a.message.slice(a.subject.length)}
                        </p>
                      ) : (
                        <p className="text-sm leading-snug">{a.message}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
