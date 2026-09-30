/**
 * Server-side rendering + persistence for admin-managed email templates.
 *
 * Blocks (developer-owned, email-safe) + branding + a merge context render to
 * `{ subject, html }`. All interpolated text is HTML-escaped, so admin content
 * and merge values can never inject markup. Rendering is guarded and always
 * falls back to the code defaults, so a bad saved row can never break a send.
 */

import type { OutgoingEmail } from "~/lib/gmail.server";
import {
  DEFAULT_BRANDING,
  DEFAULT_TEMPLATES,
  type EmailBlock,
  type EmailBranding,
  type SummaryBlock,
  type TemplateContent,
  type TemplateKey,
  TEMPLATE_KEYS,
} from "~/lib/email-templates";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TAG_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace `{{tags}}` with raw (unescaped) values — for subjects + emptiness checks. */
function interpolateRaw(raw: string, ctx: Record<string, string>): string {
  return raw.replace(TAG_RE, (_, k) => ctx[k] ?? "");
}

/**
 * Escape literal text and merge values, then apply the tiny markup subset
 * (**bold**, [label](url), newlines → <br/>). Escaping happens before markup so
 * user input can never produce live tags.
 */
function interpolateHtml(raw: string, ctx: Record<string, string>): string {
  let s = escapeHtml(raw).replace(TAG_RE, (_, k) => escapeHtml(ctx[k] ?? ""));
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, t, u) => `<a href="${u}" style="color:inherit">${t}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\n/g, "<br/>");
  return s;
}

function isHidden(block: EmailBlock, ctx: Record<string, string>): boolean {
  return block.hideIfEmpty != null && interpolateRaw(block.hideIfEmpty, ctx).trim() === "";
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

const PAD = "padding:16px 40px 0";

function renderSummary(
  block: SummaryBlock,
  br: EmailBranding,
  ctx: Record<string, string>,
): string {
  const label = (block.label ?? "").trim()
    ? `<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#BEB5B2;margin-bottom:12px">${interpolateHtml(block.label!, ctx)}</div>`
    : "";
  const rows = block.rows
    .map((r, i) => {
      const last = i === block.rows.length - 1;
      const border = last ? "" : "border-bottom:1px solid #F0EBE3;";
      if (!r.label.trim()) {
        return `<tr><td colspan="2" style="padding:8px 0;font-size:14px;color:#2C2422;line-height:1.6;white-space:pre-wrap;${border}">${interpolateHtml(r.value, ctx)}</td></tr>`;
      }
      return `<tr><td style="padding:8px 0;font-size:14px;color:#7A6E6C;vertical-align:top;${border}">${interpolateHtml(r.label, ctx)}</td><td style="padding:8px 0 8px 16px;font-size:14px;font-weight:500;color:#2C2422;text-align:right;vertical-align:top;${border}">${interpolateHtml(r.value, ctx)}</td></tr>`;
    })
    .join("");
  return `<div style="${PAD}">${label}<div style="background:${br.headerBg};border:1.5px solid #F0EBE3;border-radius:12px;padding:8px 20px"><table style="width:100%;border-collapse:collapse">${rows}</table></div></div>`;
}

function renderBank(br: EmailBranding, ctx: Record<string, string>): string {
  const val = (k: string) => interpolateHtml(`{{${k}}}`, ctx);
  const acctName = ctx.bankAccountName?.trim()
    ? val("bankAccountName")
    : escapeHtml("Mellow Art Market");
  const contact = ctx.contactEmail || br.contactEmail;
  const confirmRow = ctx.confirmationFormUrl?.trim()
    ? `<div style="font-size:13px;color:#2C2422;margin-top:10px">📋 Or fill in our confirmation form: <a href="${escapeHtml(ctx.confirmationFormUrl)}" style="color:#2C2422">${val("confirmationFormUrl")}</a></div>`
    : "";
  const rows = [
    ["Account Name", acctName],
    ["BSB", val("bankBsb")],
    ["Account Number", val("bankAccountNumber")],
    ["Amount", val("amount")],
    ["Reference", `${val("reference")} – ${val("name")}`],
  ]
    .map(
      ([l, v], i, a) =>
        `<tr><td style="padding:9px 0;color:#7A6E6C;width:44%;${i === a.length - 1 ? "" : "border-bottom:1px solid #F0EBE3"}">${l}</td><td style="padding:9px 0;font-weight:500;color:#2C2422;${i === a.length - 1 ? "" : "border-bottom:1px solid #F0EBE3"}">${v}</td></tr>`,
    )
    .join("");
  return `<div style="${PAD}"><div style="border:1.5px solid #F0EBE3;border-radius:12px;padding:20px">
    <div style="font-size:13px;font-weight:600;color:#2C2422;margin-bottom:12px">Pay via Bank Transfer (EFT)</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">${rows}</table>
    <div style="background:#FFF8E1;border-left:3px solid ${br.accentColor};border-radius:0 8px 8px 0;padding:12px 16px;font-size:12px;color:#7A6E6C;line-height:1.6;margin-bottom:12px">⚠️ Please use your <strong style="color:#2C2422">Submission ID and full name</strong> as the payment reference so we can match your payment correctly.</div>
    <div style="font-size:13px;color:#2C2422">📧 After transferring, confirm by emailing <a href="mailto:${escapeHtml(contact)}" style="color:#2C2422">${escapeHtml(contact)}</a></div>${confirmRow}
  </div></div>`;
}

function renderBlock(block: EmailBlock, br: EmailBranding, ctx: Record<string, string>): string {
  if (isHidden(block, ctx)) return "";
  switch (block.type) {
    case "hero": {
      const tag = (block.tag ?? "").trim()
        ? `<div style="display:inline-block;background:${br.accentColor};color:${br.brandColor};font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:6px 16px;border-radius:999px;margin-bottom:20px">${interpolateHtml(block.tag!, ctx)}</div>`
        : "";
      const subtext = (block.subtext ?? "").trim()
        ? `<p style="font-size:14px;color:#BEB5B2;line-height:1.7;margin:0">${interpolateHtml(block.subtext!, ctx)}</p>`
        : "";
      const ref = block.showReference
        ? `<div style="display:inline-block;margin-top:16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;letter-spacing:.08em;padding:6px 16px;border-radius:8px;font-family:monospace">${interpolateHtml("{{reference}}", ctx)}</div>`
        : "";
      return `<div style="background:${br.brandColor};padding:40px;text-align:center">${tag}<h1 style="font-size:26px;font-weight:600;color:#fff;line-height:1.3;margin:0 0 12px">${interpolateHtml(block.heading, ctx)}</h1>${subtext}${ref}</div>`;
    }
    case "image": {
      const rawUrl = interpolateRaw(block.url ?? "", ctx).trim();
      if (!/^https?:\/\//i.test(rawUrl)) return "";
      const src = escapeHtml(rawUrl);
      const alt = escapeHtml(interpolateRaw(block.alt ?? "", ctx));
      const width = block.width === "small" ? 200 : block.width === "medium" ? 360 : 520;
      const image = `<img src="${src}" alt="${alt}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;margin:0 auto;border:0;border-radius:8px"/>`;
      const rawLink = interpolateRaw(block.linkUrl ?? "", ctx).trim();
      const linked = /^https?:\/\//i.test(rawLink)
        ? `<a href="${escapeHtml(rawLink)}" style="display:inline-block;text-decoration:none">${image}</a>`
        : image;
      return `<div style="padding:20px 40px 4px;text-align:center">${linked}</div>`;
    }
    case "heading":
      return `<div style="padding:22px 40px 0"><h2 style="margin:0;font-size:18px;font-weight:600;color:#2C2422">${interpolateHtml(block.text, ctx)}</h2></div>`;
    case "paragraph":
      return `<div style="${PAD}"><p style="margin:0;font-size:15px;line-height:1.7;color:#2C2422">${interpolateHtml(block.text, ctx)}</p></div>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((i) => `<li style="margin-bottom:4px">${interpolateHtml(i, ctx)}</li>`)
        .join("");
      return `<div style="${PAD}"><${tag} style="margin:0;padding-left:20px;color:#444;line-height:1.7;font-size:14px">${items}</${tag}></div>`;
    }
    case "button": {
      const url = escapeHtml(interpolateRaw(block.url, ctx));
      const base =
        "display:block;text-align:center;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.04em;padding:14px 24px;border-radius:999px";
      const style =
        block.variant === "outline"
          ? `${base};background:transparent;color:${br.buttonColor};border:1.5px solid ${br.buttonColor}`
          : `${base};background:${br.buttonColor};color:#fff`;
      return `<div style="padding:20px 40px 4px"><a href="${url}" style="${style}">${interpolateHtml(block.label, ctx)}</a></div>`;
    }
    case "summary":
      return renderSummary(block, br, ctx);
    case "bank":
      return renderBank(br, ctx);
    case "divider":
      return `<div style="padding:24px 40px 4px"><hr style="border:none;border-top:1px solid #F0EBE3;margin:0"/></div>`;
    case "spacer": {
      const h = block.size === "lg" ? 32 : block.size === "sm" ? 8 : 16;
      return `<div style="height:${h}px"></div>`;
    }
  }
}

function shell(bodyHtml: string, br: EmailBranding): string {
  const social = [
    ["Instagram", br.instagramUrl],
    ["Facebook", br.facebookUrl],
    ["TikTok", br.tiktokUrl],
  ]
    .filter(([, u]) => u)
    .map(
      ([l, u]) =>
        `<a href="${escapeHtml(u)}" style="color:#BEB5B2;font-size:12px;text-decoration:none;margin:0 8px">${l}</a>`,
    )
    .join("");
  const footerText = escapeHtml(br.footerText).replace(/\n/g, "<br/>");
  const footerBg = br.footerBg?.trim() || br.brandColor;
  const footerLogo = br.footerLogoUrl?.trim() || br.logoUrl;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;background:#F5F5F0;padding:40px 16px;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2422">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.06)">
    <div style="background:${br.headerBg};padding:28px 40px;text-align:center;border-bottom:1px solid #F0EBE3">
      <img src="${escapeHtml(br.logoUrl)}" alt="${escapeHtml(br.fromName)}" style="height:44px;width:auto"/>
    </div>
    <div style="padding:0 0 28px">${bodyHtml}</div>
    <div style="background:${footerBg};padding:28px 40px;text-align:center">
      <img src="${escapeHtml(footerLogo)}" alt="${escapeHtml(br.fromName)}" style="height:32px;width:auto;margin-bottom:14px;opacity:.9"/>
      <div style="margin:12px 0">${social}</div>
      <p style="font-size:12px;color:#7A6E6C;line-height:1.7;margin:0"><a href="${escapeHtml(br.websiteUrl)}" style="color:#BEB5B2;text-decoration:none">${escapeHtml(br.websiteUrl)}</a><br/>${escapeHtml(br.contactEmail)}<br/><br/>${footerText}</p>
    </div>
  </div>
</body></html>`;
}

/** Pure render: content + branding + context → an OutgoingEmail-shaped result. */
export function renderContent(
  content: TemplateContent,
  br: EmailBranding,
  ctx: Record<string, string>,
  options: { includeBlockMarkers?: boolean } = {},
): { subject: string; html: string } {
  const withDefaults = { contactEmail: br.contactEmail, ...ctx };
  const body = content.blocks
    .map((block) => {
      const html = renderBlock(block, br, withDefaults);
      return options.includeBlockMarkers
        ? `<div data-email-block-id="${escapeHtml(block.id)}">${html}</div>`
        : html;
    })
    .join("");
  const preheader = interpolateRaw(content.preheader ?? "", withDefaults).trim();
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>`
    : "";
  const subject = interpolateRaw(content.subject, withDefaults)
    .replace(/[\r\n]+/g, " ")
    .trim();
  return { subject, html: preheaderHtml + shell(body, br) };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface TemplateRow {
  key: string;
  subject: string;
  preheader: string | null;
  blocks: string;
  updated_at: string | null;
  updated_by: string | null;
}

function isTemplateKey(k: string): k is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(k);
}

/** Saved template for a key, or the code default when unsaved/malformed. */
export async function getTemplate(db: D1Database, key: TemplateKey): Promise<TemplateContent> {
  const row = await db
    .prepare("SELECT subject, preheader, blocks FROM email_templates WHERE key = ?")
    .bind(key)
    .first<TemplateRow>();
  if (!row) return DEFAULT_TEMPLATES[key];
  try {
    const blocks = JSON.parse(row.blocks) as EmailBlock[];
    if (!Array.isArray(blocks)) return DEFAULT_TEMPLATES[key];
    return { subject: row.subject, preheader: row.preheader ?? "", blocks };
  } catch {
    return DEFAULT_TEMPLATES[key];
  }
}

export async function getAllTemplates(
  db: D1Database,
): Promise<Record<TemplateKey, TemplateContent>> {
  const out = {} as Record<TemplateKey, TemplateContent>;
  await Promise.all(
    TEMPLATE_KEYS.map(async (k) => {
      out[k] = await getTemplate(db, k);
    }),
  );
  return out;
}

export async function saveTemplate(
  db: D1Database,
  key: TemplateKey,
  content: TemplateContent,
  updatedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_templates (key, subject, preheader, blocks, updated_at, updated_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET
         subject = excluded.subject,
         preheader = excluded.preheader,
         blocks = excluded.blocks,
         updated_at = datetime('now'),
         updated_by = excluded.updated_by`,
    )
    .bind(
      key,
      content.subject,
      content.preheader || null,
      JSON.stringify(content.blocks),
      updatedBy,
    )
    .run();
}

export async function getBranding(db: D1Database): Promise<EmailBranding> {
  const row = await db
    .prepare(
      `SELECT from_name AS fromName, logo_url AS logoUrl, brand_color AS brandColor,
              accent_color AS accentColor, button_color AS buttonColor,
              header_bg AS headerBg, footer_bg AS footerBg,
              footer_logo_url AS footerLogoUrl, footer_text AS footerText,
              contact_email AS contactEmail, website_url AS websiteUrl,
              instagram_url AS instagramUrl, facebook_url AS facebookUrl,
              tiktok_url AS tiktokUrl
       FROM email_branding WHERE id = 1`,
    )
    .first<EmailBranding>();
  return row ?? DEFAULT_BRANDING;
}

export async function updateBranding(db: D1Database, br: EmailBranding): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_branding
         (id, from_name, logo_url, brand_color, accent_color, button_color,
          header_bg, footer_bg, footer_logo_url, footer_text, contact_email,
          website_url, instagram_url, facebook_url, tiktok_url, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         from_name = excluded.from_name, logo_url = excluded.logo_url,
         brand_color = excluded.brand_color, accent_color = excluded.accent_color,
         button_color = excluded.button_color, header_bg = excluded.header_bg,
         footer_bg = excluded.footer_bg, footer_logo_url = excluded.footer_logo_url,
         footer_text = excluded.footer_text, contact_email = excluded.contact_email,
         website_url = excluded.website_url, instagram_url = excluded.instagram_url,
         facebook_url = excluded.facebook_url, tiktok_url = excluded.tiktok_url,
         updated_at = datetime('now')`,
    )
    .bind(
      br.fromName,
      br.logoUrl,
      br.brandColor,
      br.accentColor,
      br.buttonColor,
      br.headerBg,
      br.footerBg,
      br.footerLogoUrl,
      br.footerText,
      br.contactEmail,
      br.websiteUrl,
      br.instagramUrl,
      br.facebookUrl,
      br.tiktokUrl,
    )
    .run();
}

/**
 * Load a template + branding and render it with the given merge context.
 * Guarded: any failure falls back to the code default so a send never breaks.
 */
export async function renderTemplate(
  db: D1Database,
  key: TemplateKey,
  ctx: Record<string, string>,
): Promise<OutgoingEmail> {
  const [branding, content] = await Promise.all([getBranding(db), getTemplate(db, key)]);
  let rendered: { subject: string; html: string };
  try {
    rendered = renderContent(content, branding, ctx);
  } catch {
    rendered = renderContent(DEFAULT_TEMPLATES[key], DEFAULT_BRANDING, ctx);
  }
  return {
    to: ctx.email ?? "",
    subject: rendered.subject,
    html: rendered.html,
    fromName: branding.fromName,
  };
}

export { isTemplateKey };
