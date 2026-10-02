import type { CmsField } from "./client.server";
import type { EventReferenceKind } from "../events";

// CMS-specific naming is isolated here. Match schema display names, then use the actual API slug.
export const EVENT_FIELD_ALIASES = {
  startsAt: ["start date", "start-date", "start_date"],
  endsAt: ["end date", "end-date", "end_date"],
  summary: ["summary"],
  image: ["image", "banner image"],
  description: ["description"],
  category: ["category", "categories"],
  theme: ["theme", "themes"],
  location: ["location", "locations"],
  month: ["month", "months"],
} as const;
type MappedKey = keyof typeof EVENT_FIELD_ALIASES;
const normal = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, " ");

export function eventFields(fields: CmsField[]): Partial<Record<MappedKey, CmsField>> {
  const result: Partial<Record<MappedKey, CmsField>> = {};
  for (const key of Object.keys(EVENT_FIELD_ALIASES) as MappedKey[]) {
    const aliases = EVENT_FIELD_ALIASES[key].map(normal);
    const matches = fields.filter(
      (field) =>
        aliases.includes(normal(field.displayName)) || aliases.includes(normal(field.slug)),
    );
    if (matches.length > 1)
      throw new Error(`Webflow has ambiguous ${key} fields. Check the field mapping.`);
    if (matches[0]) result[key] = matches[0];
  }
  for (const [key, type] of Object.entries({
    startsAt: "DateTime",
    endsAt: "DateTime",
    summary: "PlainText",
    description: "RichText",
    image: "Image",
  })) {
    const field = result[key as MappedKey];
    if ((!field && (key === "startsAt" || key === "endsAt")) || (field && field.type !== type))
      throw new Error(`Webflow ${key} must be a ${type} field.`);
  }
  return result;
}

export function referenceFieldValue(field: CmsField, ids: string[]): string | string[] | null {
  if (field.type === "MultiReference") return ids;
  if (field.type !== "Reference")
    throw new Error(`Webflow ${field.displayName} must be Reference or Multi-reference.`);
  if (ids.length > 1)
    throw new Error(
      `Webflow ${field.displayName} accepts only one value. Choose one or change it to Multi-reference.`,
    );
  return ids[0] ?? null;
}

export interface PublishableEvent {
  name: string;
  slug: string;
  startsAt: string | null;
  endsAt: string | null;
  summary: string | null;
  description: string | null;
  image: string | null;
}

export function mapEventContent(
  event: PublishableEvent,
  fields: ReturnType<typeof eventFields>,
  assetOrigin: string,
) {
  const data: Record<string, unknown> = { name: event.name, slug: event.slug };
  for (const key of ["startsAt", "endsAt", "summary", "description", "image"] as const) {
    const field = fields[key];
    if (!field) {
      if (event[key])
        throw new Error(`Add a ${key} field to the Webflow collection or update the mapper.`);
      continue;
    }
    let value: unknown = event[key];
    if (key === "startsAt" || key === "endsAt")
      value = event[key] ? `${event[key]!.slice(0, 10)}T00:00:00.000Z` : null;
    if (key === "summary" || key === "description") value = event[key] ?? "";
    if (key === "image" && event.image) {
      const url = new URL(event.image, assetOrigin);
      if (
        url.protocol !== "https:" ||
        /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(
          url.hostname,
        )
      )
        throw new Error(
          "Webflow needs a public HTTPS image URL. Set WEBFLOW_ASSET_BASE_URL to the deployed app serving this image.",
        );
      value = { url: url.href, alt: event.name };
    }
    data[field.slug] = value;
  }
  return data;
}

export const REFERENCE_KEYS: EventReferenceKind[] = ["theme", "location", "month", "category"];
