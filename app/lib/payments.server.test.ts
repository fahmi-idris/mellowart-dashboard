import { describe, expect, it } from "vitest";

import {
  markDecisionEmailSent,
  setApplicationStatus,
  setApplicationStatuses,
} from "./payments.server";

function fakeDb() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.values = values;
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("decision state", () => {
  it("stores a withdrawal reason and resets the previous email status", async () => {
    const { db, calls } = fakeDb();
    expect(await setApplicationStatus(db, "ART-1", "withdrawn", "admin", "Requested")).toBe(true);
    expect(calls[0].sql).toContain("withdrawn_reason = CASE");
    expect(calls[0].sql).toContain("decision_email_sent_at = NULL");
    expect(calls[0].values).toEqual([
      "withdrawn",
      "withdrawn",
      "Requested",
      "withdrawn",
      "Requested",
      "withdrawn",
      "Requested",
      "admin",
      "ART-1",
    ]);
  });

  it("clears email status for every bulk decision change", async () => {
    const { db, calls } = fakeDb();
    expect(await setApplicationStatuses(db, ["ART-1", "ART-2"], "waitlisted", "admin")).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("decision_email_sent_at = NULL");
    expect(calls[0].sql).toContain("withdrawn_reason = NULL");
  });

  it("records a sent email only for the matching unsent decision", async () => {
    const { db, calls } = fakeDb();
    const sentAt = "2026-10-01T10:00:00.000Z";
    expect(await markDecisionEmailSent(db, "ART-1", "rejected", sentAt)).toBe(true);
    expect(calls[0].sql).toContain("status = ? AND decision_email_sent_at IS NULL");
    expect(calls[0].values).toEqual([sentAt, "ART-1", "rejected"]);
  });
});
