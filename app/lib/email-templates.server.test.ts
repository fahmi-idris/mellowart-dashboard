import { describe, expect, it } from "vitest";

import {
  DEFAULT_BRANDING,
  normalizeEmailBranding,
  reorderEmailBlocks,
  type TemplateContent,
} from "./email-templates";
import {
  getBranding,
  getTemplate,
  publishEventTemplate,
  renderContent,
  saveTemplate,
  updateBranding,
} from "./email-templates.server";

const content = (blocks: TemplateContent["blocks"]): TemplateContent => ({
  subject: "Hi {{firstName}}",
  preheader: "",
  blocks,
});

describe("renderContent", () => {
  it("interpolates merge tags into subject and body", () => {
    const { subject, html } = renderContent(
      content([{ id: "p", type: "paragraph", text: "Hello {{name}}" }]),
      DEFAULT_BRANDING,
      { firstName: "John", name: "John Doe" },
    );
    expect(subject).toBe("Hi John");
    expect(html).toContain("Hello John Doe");
  });

  it("escapes HTML in literal text and in merge values (no injection)", () => {
    const { html } = renderContent(
      content([{ id: "p", type: "paragraph", text: "Bio: {{bio}} <x>" }]),
      DEFAULT_BRANDING,
      { bio: "<script>alert(1)</script>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;x&gt;");
  });

  it("applies the markup subset (bold, link, newlines)", () => {
    const { html } = renderContent(
      content([{ id: "p", type: "paragraph", text: "**bold** and [link](https://x.test)\nline2" }]),
      DEFAULT_BRANDING,
      {},
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain("line2");
    expect(html).toContain("<br/>");
  });

  it("hides a block whose hideIfEmpty tag resolves empty", () => {
    const blocks = content([
      {
        id: "b",
        type: "button",
        label: "Pay",
        url: "{{invoiceUrl}}",
        variant: "solid",
        hideIfEmpty: "{{invoiceUrl}}",
      },
    ]);
    const hidden = renderContent(blocks, DEFAULT_BRANDING, {});
    expect(hidden.html).not.toContain(">Pay<");
    const shown = renderContent(blocks, DEFAULT_BRANDING, {
      invoiceUrl: "https://pay.test/1",
    });
    expect(shown.html).toContain(">Pay<");
    expect(shown.html).toContain('href="https://pay.test/1"');
  });

  it("renders bank details from context", () => {
    const { html } = renderContent(content([{ id: "bank", type: "bank" }]), DEFAULT_BRANDING, {
      bankBsb: "063-000",
      bankAccountNumber: "1234 5678",
      amount: "AUD 220.00",
      reference: "ART-1",
      name: "John",
    });
    expect(html).toContain("063-000");
    expect(html).toContain("1234 5678");
    expect(html).toContain("AUD 220.00");
    expect(html).toContain("ART-1 – John");
  });

  it("renders an email-safe responsive image block", () => {
    const { html } = renderContent(
      content([
        {
          id: "image",
          type: "image",
          url: "https://example.com/banner.png",
          alt: "Event banner",
          linkUrl: "https://example.com/event",
          width: "medium",
        },
      ]),
      DEFAULT_BRANDING,
      {},
    );
    expect(html).toContain('src="https://example.com/banner.png"');
    expect(html).toContain('alt="Event banner"');
    expect(html).toContain('width="360"');
    expect(html).toContain('href="https://example.com/event"');
  });

  it("does not render an image with a non-http URL", () => {
    const { html } = renderContent(
      content([
        {
          id: "image",
          type: "image",
          url: "javascript:alert(1)",
          alt: "Unsafe",
          width: "full",
        },
      ]),
      DEFAULT_BRANDING,
      {},
    );
    expect(html).not.toContain("javascript:");
  });

  it("collapses newlines in the subject", () => {
    const { subject } = renderContent(
      { subject: "A\n{{firstName}}\nB", preheader: "", blocks: [] },
      DEFAULT_BRANDING,
      { firstName: "John" },
    );
    expect(subject).toBe("A John B");
  });

  it("adds block markers only when rendering an editor preview", () => {
    const template = content([{ id: "preview-target", type: "paragraph", text: "Hello" }]);
    const email = renderContent(template, DEFAULT_BRANDING, {});
    const preview = renderContent(template, DEFAULT_BRANDING, {}, { includeBlockMarkers: true });

    expect(email.html).not.toContain("data-email-block-id");
    expect(preview.html).toContain('data-email-block-id="preview-target"');
    expect(email.html).not.toContain("data-email-branding");
    expect(preview.html).toContain('data-email-branding="Header"');
    expect(preview.html).toContain('data-email-branding="Footer"');
  });

  it("renders multiple custom social links and omits removed logos", () => {
    const branding = {
      ...DEFAULT_BRANDING,
      logoUrl: "",
      footerLogoUrl: "",
      socialLinks: [
        { id: "one", label: "Portfolio", url: "https://example.com/portfolio" },
        { id: "two", label: "Shop", url: "https://example.com/shop" },
        { id: "unsafe", label: "Unsafe", url: "javascript:alert(1)" },
      ],
    };
    const { html } = renderContent(content([]), branding, {});
    expect(html).toContain("Portfolio");
    expect(html).toContain("https://example.com/shop");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain('<img src=""');
    expect(html).not.toContain(DEFAULT_BRANDING.logoUrl);
  });

  it("uses a custom header logo width", () => {
    const { html } = renderContent(content([]), { ...DEFAULT_BRANDING, headerLogoWidth: 180 }, {});
    expect(html).toContain("width:180px;max-width:100%;height:auto");
  });
});

describe("normalizeEmailBranding", () => {
  it("converts legacy social fields into editable links", () => {
    const branding = normalizeEmailBranding({
      websiteUrl: "https://example.com",
      instagramUrl: "https://instagram.com/example",
      facebookUrl: "",
      tiktokUrl: "",
    });
    expect(branding.socialLinks.map((link) => link.label)).toEqual(["Website", "Instagram"]);
  });

  it("preserves an intentionally empty social-link list", () => {
    expect(normalizeEmailBranding({ socialLinks: [] }).socialLinks).toEqual([]);
  });

  it("clamps header logo width to the slider range", () => {
    expect(normalizeEmailBranding({ headerLogoWidth: 40 }).headerLogoWidth).toBe(80);
    expect(normalizeEmailBranding({ headerLogoWidth: 400 }).headerLogoWidth).toBe(320);
  });

  it("ignores malformed saved social links", () => {
    const branding = normalizeEmailBranding({
      socialLinks: [
        null,
        { label: "Portfolio", url: "https://example.com" },
      ] as unknown as typeof DEFAULT_BRANDING.socialLinks,
    });
    expect(branding.socialLinks).toEqual([
      { id: "social-0", label: "Portfolio", url: "https://example.com" },
    ]);
  });
});

describe("reorderEmailBlocks", () => {
  const blocks: TemplateContent["blocks"] = [
    { id: "a", type: "paragraph", text: "A" },
    { id: "b", type: "paragraph", text: "B" },
    { id: "c", type: "paragraph", text: "C" },
  ];

  it("moves a block before the drop target", () => {
    expect(reorderEmailBlocks(blocks, "c", "a", "before").map((block) => block.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves a block after the drop target", () => {
    expect(reorderEmailBlocks(blocks, "a", "c", "after").map((block) => block.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("event-scoped email settings", () => {
  function fakeDb(rows: Record<string, unknown>) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const batches: unknown[][] = [];
    const db = {
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [];
      },
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) {
            call.values = values;
            return this;
          },
          async first() {
            if (sql.includes("FROM event_email_templates")) return rows.eventTemplate ?? null;
            if (sql.includes("FROM email_templates")) return rows.globalTemplate ?? null;
            if (sql.includes("FROM event_email_branding")) return rows.eventBranding ?? null;
            if (sql.includes("FROM email_branding")) return rows.globalBranding ?? null;
            return null;
          },
          async run() {
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;
    return { db, calls, batches };
  }

  it("uses an event override and otherwise falls back to the existing global template", async () => {
    const globalTemplate = {
      subject: "Global",
      preheader: "",
      blocks: JSON.stringify([{ id: "global", type: "paragraph", text: "Global" }]),
    };
    const eventTemplate = {
      subject: "Event A",
      preheader: "Event preview",
      blocks: JSON.stringify([{ id: "event", type: "paragraph", text: "Event A" }]),
    };
    const scoped = fakeDb({ globalTemplate, eventTemplate });
    expect((await getTemplate(scoped.db, "approval", "event-a")).subject).toBe("Event A");
    expect(scoped.calls[0].values).toEqual(["event-a", "approval"]);

    const fallback = fakeDb({ globalTemplate, eventTemplate: { ...eventTemplate, blocks: "{" } });
    expect((await getTemplate(fallback.db, "approval", "event-b")).subject).toBe("Global");
  });

  it("isolates saved templates and branding by event ID", async () => {
    const { db, calls } = fakeDb({});
    await saveTemplate(db, "approval", content([]), "admin@example.com", "event-a");
    await updateBranding(db, DEFAULT_BRANDING, "event-b");
    expect(calls[0].sql).toContain("INSERT INTO event_email_templates");
    expect(calls[0].values.slice(0, 2)).toEqual(["event-a", "approval"]);
    expect(calls[1].sql).toContain("INSERT INTO event_email_branding");
    expect(calls[1].values[0]).toBe("event-b");
  });

  it("uses event branding over global branding", async () => {
    const { db } = fakeDb({
      eventBranding: { branding: JSON.stringify({ fromName: "Event A" }) },
      globalBranding: { ...DEFAULT_BRANDING, fromName: "Global" },
    });
    expect((await getBranding(db, "event-a")).fromName).toBe("Event A");
  });

  it("publishes template and brand style in one D1 batch", async () => {
    const { db, calls, batches } = fakeDb({});
    await publishEventTemplate(
      db,
      "event-a",
      "approval",
      content([]),
      DEFAULT_BRANDING,
      "admin@example.com",
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(calls[0].sql).toContain("INSERT INTO event_email_templates");
    expect(calls[1].sql).toContain("INSERT INTO event_email_branding");
    expect(calls[0].values.slice(0, 2)).toEqual(["event-a", "approval"]);
    expect(calls[1].values[0]).toBe("event-a");
  });
});
