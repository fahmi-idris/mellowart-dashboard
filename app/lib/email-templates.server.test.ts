import { describe, expect, it } from "vitest";

import { DEFAULT_BRANDING, reorderEmailBlocks, type TemplateContent } from "./email-templates";
import { renderContent } from "./email-templates.server";

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
      { firstName: "Ada", name: "Ada Lovelace" },
    );
    expect(subject).toBe("Hi Ada");
    expect(html).toContain("Hello Ada Lovelace");
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
      name: "Ada",
    });
    expect(html).toContain("063-000");
    expect(html).toContain("1234 5678");
    expect(html).toContain("AUD 220.00");
    expect(html).toContain("ART-1 – Ada");
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
      { firstName: "Ada" },
    );
    expect(subject).toBe("A Ada B");
  });

  it("adds block markers only when rendering an editor preview", () => {
    const template = content([{ id: "preview-target", type: "paragraph", text: "Hello" }]);
    const email = renderContent(template, DEFAULT_BRANDING, {});
    const preview = renderContent(template, DEFAULT_BRANDING, {}, { includeBlockMarkers: true });

    expect(email.html).not.toContain("data-email-block-id");
    expect(preview.html).toContain('data-email-block-id="preview-target"');
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
