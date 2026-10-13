import { describe, expect, it } from "vitest";
import { parseEventForm } from "./event-form";

function form() {
  const data = new FormData();
  data.set("name", "Art Market");
  data.set("slug", "art-market");
  data.set("startsAt", "2026-10-02");
  data.set("endsAt", "2026-10-03");
  return data;
}
describe("event validation", () => {
  it("requires name, slug, and both dates", () => {
    expect(parseEventForm(new FormData()).errors).toHaveProperty("name");
    for (const key of ["name", "slug", "startsAt", "endsAt"]) {
      const data = form();
      data.delete(key);
      expect(parseEventForm(data).errors).toHaveProperty(key);
    }
  });
  it("rejects impossible dates, unsafe slugs and reversed ranges", () => {
    for (const value of ["2026-02-30", "2026-13-01", "not-a-date"]) {
      const data = form();
      data.set("startsAt", value);
      expect(parseEventForm(data).errors).toHaveProperty("startsAt");
    }
    const data = form();
    data.set("endsAt", "2026-10-01");
    expect(parseEventForm(data).errors).toHaveProperty("endsAt");
    data.set("slug", "Bad slug<script>");
    expect(parseEventForm(data).errors).toHaveProperty("slug");
  });
  it("accepts a same-day event and deduplicates reusable reference names", () => {
    const data = form();
    data.set("endsAt", "2026-10-02");
    data.append("theme", "Art");
    data.append("theme", "art");
    data.append("theme", "Stationery");
    expect(parseEventForm(data).input?.references.theme).toEqual(["Art", "Stationery"]);
  });
  it("rejects untrusted image paths and unbounded content", () => {
    const data = form();
    data.set("image", "https://evil.test/image.svg");
    expect(parseEventForm(data).errors).toHaveProperty("image");
    data.set("summary", "x".repeat(2001));
    expect(parseEventForm(data).errors).toHaveProperty("summary");
    data.set("description", "x".repeat(50001));
    expect(parseEventForm(data).errors).toHaveProperty("description");
  });
});
