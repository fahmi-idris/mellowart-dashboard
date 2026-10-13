import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  render: vi.fn(),
  settings: vi.fn(),
  save: vi.fn(),
  attach: vi.fn(),
  invoice: vi.fn(),
}));
vi.mock("~/lib/gmail.server", () => ({ sendEmail: mocks.send }));
vi.mock("~/lib/email-templates.server", () => ({ renderTemplate: mocks.render }));
vi.mock("~/lib/invoices.server", () => ({
  getInvoiceSettings: mocks.settings,
  saveInvoiceRecord: mocks.save,
  formatDueDate: () => "15 Oct 2026",
}));
vi.mock("~/lib/payments.server", () => ({ attachInvoice: mocks.attach }));
vi.mock("~/lib/xero-client.server", () => ({ createInvoice: mocks.invoice }));
import { createInvoiceForSubmission } from "./jobs.server";

describe("approval invoice email", () => {
  it("passes the assigned invoice stall into the email merge context", async () => {
    mocks.settings.mockResolvedValue({ currency: "AUD", dueDays: 7, itemDescription: "Stall" });
    mocks.invoice.mockResolvedValue({
      invoiceId: "INV-1",
      total: 520,
      onlineUrl: "https://invoice.example/1",
    });
    const first = vi.fn().mockResolvedValue({
      id: "ART-1",
      event_id: "EVT-1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      payment_status: "invoicing",
      event_name: "Market",
      stall_tier: "Flagship – Debut",
      stall_amount: 520,
      stall_currency: "AUD",
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    await createInvoiceForSubmission({ DB: { prepare } } as unknown as Env, "ART-1");
    expect(prepare.mock.calls[0][0]).toContain("o.tier AS stall_tier");
    expect(mocks.render).toHaveBeenCalledWith(
      expect.anything(),
      "approval",
      expect.objectContaining({ offeredStall: "Flagship – Debut", amount: "AUD 520.00" }),
      "EVT-1",
    );
  });
});
