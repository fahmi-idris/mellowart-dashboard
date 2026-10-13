import { describe, expect, it } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";

import {
  DEFAULT_BRANDING,
  DEFAULT_TEMPLATES,
  normalizeEmailBranding,
  normalizeHexColor,
  summaryColorError,
  emailForeground,
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

describe("email color migration", () => {
  it("preserves existing branding and round-trips global colors through real SQLite", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const migration of [
        "0016_email_templates.sql",
        "0017_email_footer_branding.sql",
        "0023_email_body_summary_colors.sql",
      ])
        sqlite.exec(readFileSync(`migrations/${migration}`, "utf8"));
      const db = {
        prepare(sql: string) {
          let values: SQLInputValue[] = [];
          return {
            bind(...args: SQLInputValue[]) {
              values = args;
              return this;
            },
            async first() {
              return sqlite.prepare(sql).get(...values) ?? null;
            },
            async run() {
              return sqlite.prepare(sql).run(...values);
            },
          };
        },
      } as unknown as D1Database;
      const previous = await getBranding(db);
      expect(previous.fromName).toBe("Mellow Art");
      expect(previous.bodyBg).toBe(DEFAULT_BRANDING.bodyBg);
      expect(previous.summaryBg).toBe(DEFAULT_BRANDING.summaryBg);
      const updated = {
        ...previous,
        bodyBg: "#123456",
        bodyTextColor: "#ABCDEF",
        heroTextColor: "#FFFFFF",
        summaryBg: "#654321",
        summaryTextColor: "#FEDCBA",
      };
      await updateBranding(db, updated);
      expect(await getBranding(db)).toMatchObject(updated);
    } finally {
      sqlite.close();
    }
  });
});

describe("renderContent", () => {
  it("keeps summary colors per block, with fallback for older blocks and invalid preview drafts", () => {
    const blocks: TemplateContent["blocks"] = [
      {
        id: "one",
        type: "summary",
        backgroundColor: "#123",
        textColor: "#fff",
        rows: [{ label: "First", value: "1" }],
      },
      {
        id: "two",
        type: "summary",
        backgroundColor: "#456789",
        textColor: "#FFEEDD",
        rows: [{ label: "Second", value: "2" }],
      },
      { id: "old", type: "summary", rows: [{ label: "Legacy", value: "3" }] },
    ];
    const branding = { ...DEFAULT_BRANDING, summaryBg: "#ABCDEF", summaryTextColor: "#222222" };
    const html = renderContent(content(blocks), branding, {}).html;
    expect(html).toContain("background:#112233;border:1.5px");
    expect(html).toContain("background:#456789;border:1.5px");
    expect(html).toContain("background:#ABCDEF;border:1.5px");
    expect(html).toContain("color:#FFFFFF");
    expect(html).toContain("color:#FFEEDD");
    expect(summaryColorError(blocks)).toBeNull();
    const invalid: TemplateContent["blocks"] = [
      { id: "invalid", type: "summary", backgroundColor: "red;display:none", rows: [] },
    ];
    expect(summaryColorError(invalid)).toContain("Invalid summary background");
    expect(renderContent(content(invalid), branding, {}).html).toContain(
      "background:#ABCDEF;border:1.5px",
    );
    expect(renderContent(content(invalid), branding, {}).html).not.toContain("display:none");
  });
  it("applies body colors and keeps summary colors separate from header colors", () => {
    const branding = {
      ...DEFAULT_BRANDING,
      headerBg: "#235326",
      bodyBg: "#112233",
      bodyTextColor: "#F1F2F3",
      summaryBg: "#445566",
      summaryTextColor: "#FFEEDD",
      heroTextColor: "#FFFFFF",
    };
    const template = content([
      { id: "hero", type: "hero", heading: "Hello", subtext: "Approved" },
      { id: "p", type: "paragraph", text: "Body copy" },
      { id: "h", type: "heading", text: "Heading" },
      { id: "l", type: "list", ordered: false, items: ["Item"] },
      { id: "s", type: "summary", rows: [{ label: "Stall", value: "{{offeredStall}}" }] },
    ]);
    const html = renderContent(template, branding, { offeredStall: "Flagship" }).html;
    expect(html).toContain("background:#112233;color:#F1F2F3");
    expect(html).toContain("line-height:1.7;color:#F1F2F3");
    expect(html).toContain("background:#445566;border:1.5px");
    expect(html).toContain("color:#FFEEDD");
    expect(html).toContain("font-size:14px;color:#FFFFFF;line-height:1.7");
    expect(html).toContain("Flagship");
    const changedHeader = renderContent(template, { ...branding, headerBg: "#000000" }, {}).html;
    expect(changedHeader).toContain("background:#445566;border:1.5px");
  });
  it("renders the actual offered stall in the default invoice summary", () => {
    const html = renderContent(DEFAULT_TEMPLATES.approval, DEFAULT_BRANDING, {
      offeredStall: "Flagship – Debut",
      stallType: "Mini",
      amount: "AUD 520.00",
    }).html;
    expect(html).toContain("Offered Stall");
    expect(html).toContain("Flagship – Debut");
    expect(html).not.toContain(">Mini<");
  });
  it("normalizes shorthand colors and rejects invalid CSS", () => {
    expect(normalizeHexColor(" #abc ")).toBe("#AABBCC");
    expect(normalizeHexColor("red;display:none")).toBeNull();
    expect(
      normalizeEmailBranding({ brandColor: '" onclick="alert(1)', headerBg: "#fff" }).brandColor,
    ).toBe(DEFAULT_BRANDING.brandColor);
    expect(normalizeEmailBranding({ headerBg: "#fff" }).headerBg).toBe("#FFFFFF");
    expect(emailForeground("#ffffff")).toBe("#000000");
    expect(emailForeground("#000000")).toBe("#FFFFFF");
  });

  it("uses readable foregrounds and a clickable escaped contact email", () => {
    const rendered = renderContent(
      content([
        {
          id: "hero",
          type: "hero",
          heading: "Hello",
          tag: "Event",
          subtext: "Details",
          showReference: true,
        },
        { id: "button", type: "button", label: "Go", url: "https://example.com", variant: "solid" },
      ]),
      {
        ...DEFAULT_BRANDING,
        brandColor: "#fff",
        accentColor: "#fff",
        buttonColor: "#fff",
        footerBg: "#fff",
        contactEmail: "hello+events@example.com",
      },
      {},
    );
    expect(rendered.html).toContain("background:#FFFFFF;color:#000000");
    expect(rendered.html).toContain('href="mailto:hello%2Bevents%40example.com"');
    expect(rendered.html).toContain(">hello+events@example.com</a>");
    expect(rendered.html).not.toContain("color:#fff");
  });
  it("includes an optional withdrawal reason only when supplied", () => {
    const context = { firstName: "Ada", reference: "ART-1", reason: "Requested by applicant" };
    const withReason = renderContent(DEFAULT_TEMPLATES.withdrawn, DEFAULT_BRANDING, context);
    const withoutReason = renderContent(DEFAULT_TEMPLATES.withdrawn, DEFAULT_BRANDING, {
      ...context,
      reason: "",
    });
    expect(withReason.html).toContain("Requested by applicant");
    expect(withoutReason.html).not.toContain("Requested by applicant");
    expect(withoutReason.html).not.toContain(">Reason<");
  });

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
  it("upgrades existing customized invoice summaries without duplicating the offered stall", async () => {
    const block = {
      id: "custom-summary",
      type: "summary",
      label: "My invoice",
      rows: [{ label: "Total", value: "{{amount}}" }],
    };
    for (const scope of ["globalTemplate", "eventTemplate"]) {
      const { db } = fakeDb({
        [scope]: { subject: "Custom", preheader: "", blocks: JSON.stringify([block]) },
      });
      const saved = await getTemplate(db, "approval", "event-a");
      expect(saved.subject).toBe("Custom");
      expect(saved.blocks[0]).toMatchObject({
        label: "My invoice",
        rows: [block.rows[0], { label: "Offered Stall", value: "{{offeredStall}}" }],
      });
      const again = fakeDb({
        [scope]: { subject: saved.subject, blocks: JSON.stringify(saved.blocks) },
      });
      expect((await getTemplate(again.db, "approval", "event-a")).blocks).toEqual(saved.blocks);
    }
  });
  it("persists new colors in event JSON and global columns", async () => {
    const { db, calls } = fakeDb({});
    const branding = {
      ...DEFAULT_BRANDING,
      bodyBg: "#111111",
      bodyTextColor: "#EEEEEE",
      heroTextColor: "#FFFFFF",
      summaryBg: "#222222",
      summaryTextColor: "#DDDDDD",
    };
    await updateBranding(db, branding, "event-a");
    expect(JSON.parse(String(calls[0].values[1]))).toMatchObject(branding);
    await updateBranding(db, branding);
    expect(calls[1].sql).toContain("summary_text_color = excluded.summary_text_color");
    expect(calls[1].values.slice(-5)).toEqual([
      branding.bodyBg,
      branding.bodyTextColor,
      branding.heroTextColor,
      branding.summaryBg,
      branding.summaryTextColor,
    ]);
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
