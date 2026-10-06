import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  list: vi.fn(),
  exportRows: vi.fn(),
  prepare: vi.fn(),
  get: vi.fn(),
  event: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: { DB: { prepare: mocks.prepare }, BUCKET: { get: mocks.get } },
}));
vi.mock("~/lib/auth.server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("~/lib/d1-pagination.server", () => ({ d1List: mocks.list }));
vi.mock("~/lib/submissions.server", () => ({ getSubmissionsForExport: mocks.exportRows }));
vi.mock("~/lib/events.server", () => ({ getEvent: mocks.event }));
import { loader } from "./api.inquiries";

async function backup(query: string) {
  return loader({
    request: new Request("https://app.example/api/inquiries?format=backup&" + query),
  } as Parameters<typeof loader>[0]);
}

describe("scoped inquiry backups", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdmin.mockResolvedValue({ email: "admin@example.com" });
    mocks.event.mockResolvedValue({ id: "EVT-A", slug: "summer-market" });
    mocks.list.mockResolvedValue({ total: 1, data: [] });
    mocks.exportRows.mockResolvedValue([{ id: "ART-A", firstName: "Alice" }]);
    mocks.prepare.mockImplementation(() => ({
      bind: (...ids: string[]) => ({
        all: async () => ({
          results: ids.map((id) => ({
            submissionId: id,
            key: "submissions/" + id + "/insurance.pdf",
            size: 4,
          })),
        }),
      }),
    }));
    mocks.get.mockResolvedValue({ body: new Blob(["file"]).stream() });
  });

  it("backs up the complete event regardless of search/status/archive filters and pagination", async () => {
    const response = await backup(
      "filter.event_id=EVT-A&filter.view=archived&filter.status=accepted&search=Alice&page=5&pageSize=1",
    );
    expect(response.status).toBe(200);
    expect(mocks.exportRows.mock.calls[0][1]).toEqual({ eventId: "EVT-A" });
    expect(mocks.list.mock.calls[0][1]).toEqual({
      page: 1,
      pageSize: 1,
      filters: { event_id: "EVT-A" },
    });
    expect(mocks.list.mock.calls[0][2].extraWhere).toBeUndefined();
    expect(response.headers.get("Content-Disposition")).toContain(
      "inquiries-backup-summer-market-",
    );
    expect(mocks.prepare.mock.calls[0][0]).toContain("WHERE submission_id IN (?)");
    const text = new TextDecoder().decode(await response.arrayBuffer());
    expect(text).toContain("images/ART-A/insurance.pdf");
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("submissions/ART-A/insurance.pdf");
  });

  it("backs up all events only when explicitly selected, ignoring other filters", async () => {
    await backup("scope=all&filter.event_id=EVT-A&filter.view=active&search=Alice");
    expect(mocks.exportRows.mock.calls[0][1]).toEqual({});
    expect(mocks.list.mock.calls[0][1]).toEqual({ page: 1, pageSize: 1 });
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.list.mock.calls[0][2].extraWhere).toBeUndefined();
  });

  it("rejects missing or unknown events without reading any submissions", async () => {
    expect((await backup("scope=event")).status).toBe(400);
    mocks.event.mockResolvedValue(null);
    expect((await backup("filter.event_id=EVT-UNKNOWN")).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.exportRows).not.toHaveBeenCalled();
  });

  it("allows all-event backup without selecting an event and labels the ZIP", async () => {
    const response = await backup("scope=all");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("inquiries-backup-all-events-");
    expect(mocks.exportRows.mock.calls[0][1]).toEqual({});
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("returns an empty ZIP without querying any documents for an empty view", async () => {
    mocks.list.mockResolvedValue({ total: 0, data: [] });
    mocks.exportRows.mockResolvedValue([]);
    const response = await backup("filter.event_id=EVT-EMPTY");
    await response.arrayBuffer();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("rejects oversized matching sets before fetching records or files", async () => {
    mocks.list.mockResolvedValue({ total: 10001, data: [] });
    expect((await backup("filter.event_id=EVT-A")).status).toBe(413);
    expect(mocks.exportRows).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("binds document selections in bounded batches without including another event", async () => {
    mocks.exportRows.mockResolvedValue(Array.from({ length: 91 }, (_, i) => ({ id: `ART-${i}` })));
    const response = await backup("filter.event_id=EVT-A");
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.prepare.mock.calls[0][0].match(/\?/g)).toHaveLength(90);
    expect(mocks.prepare.mock.calls[1][0].match(/\?/g)).toHaveLength(1);
  });

  it("requires an authenticated administrator before querying backup data", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(backup("scope=all")).rejects.toThrow("Unauthorized");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.exportRows).not.toHaveBeenCalled();
  });
});
