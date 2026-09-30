/**
 * Shared, dependency-free types + catalog for the admin email-template editor.
 *
 * Safe to import from both client (the editor UI) and server (the renderer).
 * The actual HTML rendering + DB access live in `email-templates.server.ts`.
 *
 * A template body is an ordered list of typed blocks. Admins edit block content
 * and ordering; the developer-owned renderer turns blocks into email-safe HTML,
 * so the layout can never be broken from the UI. Text fields support `{{tags}}`
 * merge variables (see MERGE_TAGS) and a tiny markup subset (**bold**,
 * [label](url), newlines).
 */

export const TEMPLATE_KEYS = [
  "approval",
  "confirmation",
  "rejection",
  "waitlist",
  "withdrawn",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_META: Record<
  TemplateKey,
  { label: string; description: string; trigger: string }
> = {
  approval: {
    label: "Approval / invoice",
    description:
      "Sent when an approved submission is invoiced. Includes the payment link and bank-transfer details.",
    trigger: "On “Send invoice” for an accepted submission",
  },
  confirmation: {
    label: "Application received",
    description: "Sent automatically the moment a public application is submitted.",
    trigger: "On public form submission",
  },
  rejection: {
    label: "Rejection",
    description: "Sent manually for a rejected submission. Optional reason.",
    trigger: "Manual action · Rejected",
  },
  waitlist: {
    label: "Waitlist",
    description: "Sent manually for a waitlisted submission. Optional reason.",
    trigger: "Manual action · Waitlisted",
  },
  withdrawn: {
    label: "Withdrawn",
    description: "Sent manually after an application is marked withdrawn.",
    trigger: "Manual action · Withdrawn",
  },
};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type BlockType =
  | "hero"
  | "image"
  | "heading"
  | "paragraph"
  | "list"
  | "button"
  | "summary"
  | "bank"
  | "divider"
  | "spacer";

interface BlockBase {
  id: string;
  type: BlockType;
  /**
   * When set to a `{{tag}}` (or any text), the block is skipped entirely if that
   * text interpolates to empty — e.g. hide the "Pay online" button when there's
   * no invoice link, or the reason block when no reason was given.
   */
  hideIfEmpty?: string;
}

export interface HeroBlock extends BlockBase {
  type: "hero";
  tag?: string;
  heading: string;
  subtext?: string;
  showReference?: boolean;
}
export interface ImageBlock extends BlockBase {
  type: "image";
  url: string;
  alt: string;
  linkUrl?: string;
  width: "full" | "medium" | "small";
}
export interface HeadingBlock extends BlockBase {
  type: "heading";
  text: string;
}
export interface ParagraphBlock extends BlockBase {
  type: "paragraph";
  text: string;
}
export interface ListBlock extends BlockBase {
  type: "list";
  ordered: boolean;
  items: string[];
}
export interface ButtonBlock extends BlockBase {
  type: "button";
  label: string;
  url: string;
  variant: "solid" | "outline";
}
export interface SummaryBlock extends BlockBase {
  type: "summary";
  label?: string;
  rows: { label: string; value: string }[];
}
export interface BankBlock extends BlockBase {
  type: "bank";
}
export interface DividerBlock extends BlockBase {
  type: "divider";
}
export interface SpacerBlock extends BlockBase {
  type: "spacer";
  size: "sm" | "md" | "lg";
}

export type EmailBlock =
  | HeroBlock
  | ImageBlock
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | ButtonBlock
  | SummaryBlock
  | BankBlock
  | DividerBlock
  | SpacerBlock;

export type BlockDropPosition = "before" | "after";

/** Reorder one block relative to another without mutating the working copy. */
export function reorderEmailBlocks(
  blocks: EmailBlock[],
  sourceId: string,
  targetId: string,
  position: BlockDropPosition,
): EmailBlock[] {
  if (sourceId === targetId) return blocks;
  const source = blocks.find((block) => block.id === sourceId);
  if (!source || !blocks.some((block) => block.id === targetId)) return blocks;

  const next = blocks.filter((block) => block.id !== sourceId);
  const targetIndex = next.findIndex((block) => block.id === targetId);
  next.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, source);
  return next;
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero banner",
  image: "Image",
  heading: "Heading",
  paragraph: "Paragraph",
  list: "List",
  button: "Button",
  summary: "Summary box",
  bank: "Bank transfer details",
  divider: "Divider",
  spacer: "Spacer",
};

/** A fresh block of the given type, with a unique id. */
export function newBlock(type: BlockType): EmailBlock {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `b-${Math.floor(performance.now())}-${Math.round(performance.now() * 1e3) % 1000}`;
  switch (type) {
    case "hero":
      return { id, type, tag: "", heading: "Heading", subtext: "", showReference: false };
    case "image":
      return { id, type, url: "", alt: "", linkUrl: "", width: "full" };
    case "heading":
      return { id, type, text: "Heading" };
    case "paragraph":
      return { id, type, text: "New paragraph. Use {{tags}} for variables." };
    case "list":
      return { id, type, ordered: false, items: ["First item"] };
    case "button":
      return { id, type, label: "Button", url: "https://", variant: "solid" };
    case "summary":
      return { id, type, label: "Summary", rows: [{ label: "Label", value: "Value" }] };
    case "bank":
      return { id, type };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, size: "md" };
  }
}

// ---------------------------------------------------------------------------
// Branding (shared across all templates)
// ---------------------------------------------------------------------------

export interface EmailBranding {
  fromName: string;
  logoUrl: string;
  headerLogoWidth: number | null;
  brandColor: string; // dark brand / hero background
  accentColor: string; // pill / highlight
  buttonColor: string;
  headerBg: string;
  footerBg: string; // footer background (falls back to brandColor)
  footerLogoUrl: string; // footer logo — use a light/inverted variant (falls back to logoUrl)
  footerText: string;
  contactEmail: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  socialLinks: SocialLink[];
}

export interface SocialLink {
  id: string;
  label: string;
  url: string;
}

export const DEFAULT_BRANDING: EmailBranding = {
  fromName: "Mellow Art",
  logoUrl:
    "https://cdn.prod.website-files.com/6a223b24e44ab35ad710d94d/6a223b24e44ab35ad710d9a3_image%2030.webp",
  headerLogoWidth: null,
  brandColor: "#2C2422",
  accentColor: "#F2C4CE",
  buttonColor: "#2C2422",
  headerBg: "#FFFDF2",
  footerBg: "#2C2422",
  footerLogoUrl:
    "https://cdn.prod.website-files.com/6a223b24e44ab35ad710d94d/6a223b24e44ab35ad710d9a3_image%2030.webp",
  footerText:
    "This is an automated message from Mellow Art Market.\n© 2026 Mellow Art Market · Melbourne, Australia",
  contactEmail: "mellowartmarket@gmail.com",
  websiteUrl: "https://www.mellowart.com.au",
  instagramUrl: "https://www.instagram.com/mellowartmarket/",
  facebookUrl: "https://www.facebook.com/mellowartmarket",
  tiktokUrl: "https://www.tiktok.com/@mellowartmarket",
  socialLinks: [
    { id: "website", label: "Website", url: "https://www.mellowart.com.au" },
    { id: "instagram", label: "Instagram", url: "https://www.instagram.com/mellowartmarket/" },
    { id: "facebook", label: "Facebook", url: "https://www.facebook.com/mellowartmarket" },
    { id: "tiktok", label: "TikTok", url: "https://www.tiktok.com/@mellowartmarket" },
  ],
};

/** Populate new branding fields when reading older global/event settings. */
export function normalizeEmailBranding(raw: Partial<EmailBranding>): EmailBranding {
  const branding = { ...DEFAULT_BRANDING, ...raw };
  return {
    ...branding,
    headerLogoWidth:
      typeof raw.headerLogoWidth === "number" && Number.isFinite(raw.headerLogoWidth)
        ? Math.max(80, Math.min(320, raw.headerLogoWidth))
        : null,
    socialLinks: Array.isArray(raw.socialLinks)
      ? raw.socialLinks
          .filter(
            (link): link is SocialLink =>
              link !== null &&
              typeof link === "object" &&
              typeof link.label === "string" &&
              typeof link.url === "string",
          )
          .map((link, index) => ({
            id: typeof link.id === "string" && link.id ? link.id : `social-${index}`,
            label: link.label,
            url: link.url,
          }))
      : (
          [
            ["website", "Website", branding.websiteUrl],
            ["instagram", "Instagram", branding.instagramUrl],
            ["facebook", "Facebook", branding.facebookUrl],
            ["tiktok", "TikTok", branding.tiktokUrl],
          ] as const
        )
          .filter(([, , url]) => url)
          .map(([id, label, url]) => ({ id, label, url })),
  };
}

// ---------------------------------------------------------------------------
// Merge tags — per template, with sample values used for preview / test sends.
// ---------------------------------------------------------------------------

export interface MergeTag {
  tag: string;
  label: string;
  sample: string;
}

const COMMON_TAGS: MergeTag[] = [
  { tag: "name", label: "Full name", sample: "John Doe" },
  { tag: "firstName", label: "First name", sample: "John" },
  { tag: "lastName", label: "Last name", sample: "Doe" },
  { tag: "email", label: "Email", sample: "john@example.com" },
  { tag: "reference", label: "Submission reference", sample: "ART-9F3AB2C1" },
];

// Every template exposes the same full catalog of merge tags, so the editor's
// click-to-copy tag palette is identical across all tabs. A tag a given template
// doesn't populate simply interpolates to empty (or is guarded by hideIfEmpty),
// so listing them all everywhere is harmless.
export const ALL_MERGE_TAGS: MergeTag[] = [
  ...COMMON_TAGS,
  { tag: "eventName", label: "Event name", sample: "Mellow Art Market — Spring" },
  { tag: "stallType", label: "Stall type (1st preference)", sample: "Standard – Debut" },
  { tag: "secondStallType", label: "Stall type (2nd preference)", sample: "Mini" },
  { tag: "invoiceUrl", label: "Invoice / pay link", sample: "https://pay.example.com/inv/123" },
  { tag: "amount", label: "Amount (formatted)", sample: "AUD 220.00" },
  { tag: "dueDate", label: "Payment due date", sample: "15 Aug 2026" },
  { tag: "bankAccountName", label: "Bank account name", sample: "Mellow Art Market" },
  { tag: "bankBsb", label: "Bank BSB", sample: "063-000" },
  { tag: "bankAccountNumber", label: "Bank account number", sample: "1234 5678" },
  {
    tag: "confirmationFormUrl",
    label: "Confirmation form URL",
    sample: "https://forms.example.com/paid",
  },
  { tag: "contactEmail", label: "Contact email", sample: "mellowartmarket@gmail.com" },
  { tag: "brandName", label: "Brand name", sample: "Analytical Engines" },
  { tag: "primaryCategory", label: "Primary category", sample: "Ceramics" },
  { tag: "secondaryCategory", label: "Secondary category", sample: "Jewellery" },
  { tag: "reason", label: "Reason (optional)", sample: "We had limited spots this round." },
];

export const MERGE_TAGS: Record<TemplateKey, MergeTag[]> = {
  approval: ALL_MERGE_TAGS,
  confirmation: ALL_MERGE_TAGS,
  rejection: ALL_MERGE_TAGS,
  waitlist: ALL_MERGE_TAGS,
  withdrawn: ALL_MERGE_TAGS,
};

// ---------------------------------------------------------------------------
// Default (seed) content per template — mirrors the current transactional
// emails. Used when no saved row exists, and as the "Reset to default" source.
// ---------------------------------------------------------------------------

export interface TemplateContent {
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
}

const b = (block: EmailBlock): EmailBlock => block;

export const DEFAULT_TEMPLATES: Record<TemplateKey, TemplateContent> = {
  approval: {
    subject: "You're in! Complete your payment for {{eventName}} ({{reference}})",
    preheader: "Your application has been approved — complete payment to secure your spot.",
    blocks: [
      b({
        id: "hero",
        type: "hero",
        tag: "Application Approved",
        heading: "Congratulations, {{firstName}}! 🎨",
        subtext: "Your application has been approved.\nComplete your payment to secure your spot.",
        showReference: true,
      }),
      b({
        id: "greeting",
        type: "paragraph",
        text: "Hi {{firstName}},\n\nWe're so excited to have you join us at **{{eventName}}**! 🌿 Your spot is almost secured — just one step left. Please complete your payment by **{{dueDate}}** to confirm your place at the event.",
      }),
      b({
        id: "summary",
        type: "summary",
        label: "Invoice Summary",
        rows: [
          { label: "Event", value: "{{eventName}}" },
          { label: "Submission ID", value: "{{reference}}" },
          { label: "Payment Due", value: "{{dueDate}}" },
          { label: "Total Amount", value: "{{amount}}" },
        ],
      }),
      b({
        id: "pay",
        type: "button",
        label: "View & Pay Invoice →",
        url: "{{invoiceUrl}}",
        variant: "solid",
        hideIfEmpty: "{{invoiceUrl}}",
      }),
      b({ id: "bank", type: "bank", hideIfEmpty: "{{bankBsb}}" }),
      b({ id: "div1", type: "divider" }),
      b({
        id: "closing",
        type: "paragraph",
        text: "Once your payment is received and confirmed, we'll send you a follow-up email with all the event details you need. 🌿\n\nIf you have any questions, don't hesitate to reach out — we're always happy to help!\n\nWarm regards,\nThe Mellow Art Team",
      }),
    ],
  },
  confirmation: {
    subject: "We've received your Mellow Art Market application 🎉",
    preheader: "Thanks for applying — here's what happens next.",
    blocks: [
      b({ id: "greeting", type: "paragraph", text: "Hi {{firstName}}," }),
      b({
        id: "intro",
        type: "paragraph",
        text: "Thanks for applying to Mellow Art Market! We've received your application for **{{brandName}}** and our team will be reviewing it shortly.",
      }),
      b({
        id: "steps",
        type: "list",
        ordered: true,
        items: [
          "Our team reviews all applications after the application window closes.",
          "You'll hear back from us via this email address.",
          "If approved, we'll follow up with payment and stall confirmation details.",
        ],
      }),
      b({
        id: "summary",
        type: "summary",
        label: "Application Summary",
        rows: [
          { label: "Brand Name", value: "{{brandName}}" },
          { label: "Event", value: "{{eventName}}" },
          { label: "Stall Type (1st choice)", value: "{{stallType}}" },
          { label: "Stall Type (2nd choice)", value: "{{secondStallType}}" },
        ],
      }),
      b({
        id: "outro",
        type: "paragraph",
        text: "If you need to update any part of your application, reply to this email and let us know — please don't submit a duplicate application.\n\nWarmly,\nThe Mellow Art Team",
      }),
    ],
  },
  rejection: {
    subject: "Your Mellow Art submission {{reference}}",
    preheader: "An update on your Mellow Art Market application.",
    blocks: [
      b({ id: "greeting", type: "paragraph", text: "Hi {{firstName}}," }),
      b({
        id: "body",
        type: "paragraph",
        text: "Thank you for your submission (**{{reference}}**). After review, it has **not been accepted** at this time.",
      }),
      b({
        id: "reason",
        type: "summary",
        label: "Reason",
        rows: [{ label: "", value: "{{reason}}" }],
        hideIfEmpty: "{{reason}}",
      }),
    ],
  },
  waitlist: {
    subject: "Your Mellow Art submission {{reference}}",
    preheader: "An update on your Mellow Art Market application.",
    blocks: [
      b({ id: "greeting", type: "paragraph", text: "Hi {{firstName}}," }),
      b({
        id: "body",
        type: "paragraph",
        text: "Thank you for your submission (**{{reference}}**). After review, you've been placed on our **waitlist**. If a spot opens up, we'll be in touch.",
      }),
      b({
        id: "reason",
        type: "summary",
        label: "Reason",
        rows: [{ label: "", value: "{{reason}}" }],
        hideIfEmpty: "{{reason}}",
      }),
    ],
  },
  withdrawn: {
    subject: "Your Mellow Art application {{reference}} has been withdrawn",
    preheader: "Confirmation that your application is withdrawn.",
    blocks: [
      b({ id: "greeting", type: "paragraph", text: "Hi {{firstName}}," }),
      b({
        id: "body",
        type: "paragraph",
        text: "Your application (**{{reference}}**) has been marked as withdrawn. It will no longer be considered for this event. If this was a mistake, please reply to this email.",
      }),
    ],
  },
};

/** Sample merge context for previews / test sends. */
export function sampleContext(key: TemplateKey): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const t of MERGE_TAGS[key]) ctx[t.tag] = t.sample;
  return ctx;
}
