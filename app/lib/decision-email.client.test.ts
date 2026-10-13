import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { applySentDecisionToCache } from "./decision-email.client";

describe("decision email cache update", () => {
  it("shows Email sent in all cached inquiry layouts and the open profile immediately", () => {
    const client = new QueryClient();
    const row = { id: "ART-1", status: "rejected" as const, decisionEmailSentAt: null };
    const page = {
      data: [row],
      page: 1,
      pageSize: 10,
      total: 1,
      pageCount: 1,
      hasPrev: false,
      hasNext: false,
    };
    client.setQueryData(["inquiries", { view: "table" }], page);
    client.setQueryData(["inquiries", { view: "cards" }], page);
    client.setQueryData(["inquiry", row.id], { ...row, name: "Ada" });

    applySentDecisionToCache(client, {
      id: row.id,
      status: "rejected",
      decisionEmailSentAt: "2026-10-01T10:00:00.000Z",
    });

    for (const view of ["table", "cards"]) {
      expect(client.getQueryData<typeof page>(["inquiries", { view }])?.data[0]).toHaveProperty(
        "decisionEmailSentAt",
        "2026-10-01T10:00:00.000Z",
      );
    }
    expect(client.getQueryData(["inquiry", row.id])).toMatchObject({
      name: "Ada",
      decisionEmailSentAt: "2026-10-01T10:00:00.000Z",
    });
  });
});
