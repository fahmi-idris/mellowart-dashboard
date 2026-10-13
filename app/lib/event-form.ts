import { EVENT_REFERENCE_KINDS, type EventReferenceKind } from "./events";

export interface EventFormInput {
  name: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  summary: string | null;
  description: string | null;
  image: string | null;
  references: Record<EventReferenceKind, string[]>;
}
export type EventFormErrors = Partial<Record<keyof EventFormInput, string>>;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Shared client/server validation; hidden calendar fields must also be checked. */
export function parseEventForm(
  form: FormData,
): { input: EventFormInput; errors?: never } | { errors: EventFormErrors; input?: never } {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const errors: EventFormErrors = {};
  const name = text("name");
  const slug = text("slug");
  const startsAt = text("startsAt");
  const endsAt = text("endsAt");
  if (!name) errors.name = "Event name is required.";
  else if (name.length > 200) errors.name = "Use at most 200 characters.";
  if (!slug) errors.slug = "Slug is required.";
  else if (slug.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    errors.slug = "Use lowercase letters, numbers, and single dashes.";
  if (!validDate(startsAt)) errors.startsAt = "Select a valid start date.";
  if (!validDate(endsAt)) errors.endsAt = "Select a valid end date.";
  if (!errors.startsAt && !errors.endsAt && startsAt > endsAt)
    errors.endsAt = "End date must be on or after the start date.";
  const summary = text("summary");
  const description = text("description");
  const image = text("image");
  if (summary.length > 2000) errors.summary = "Use at most 2,000 characters.";
  if (description.length > 50000) errors.description = "Use at most 50,000 characters.";
  if (image && !/^\/event-assets\/[0-9a-f-]+\.(?:jpg|png|gif|webp)$/.test(image))
    errors.image = "Upload an event image using the image picker.";
  const references = {} as Record<EventReferenceKind, string[]>;
  for (const kind of EVENT_REFERENCE_KINDS) {
    const values = form
      .getAll(kind)
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (values.length > 20 || values.some((value) => value.length > 100))
      errors.references = "Use up to 20 choices per field, with at most 100 characters each.";
    const seen = new Set<string>();
    references[kind] = values.filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      name,
      slug,
      startsAt,
      endsAt,
      summary: summary || null,
      description: description || null,
      image: image || null,
      references,
    },
  };
}
