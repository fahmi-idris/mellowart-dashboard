import { describe, expect, it } from "vitest";

import { isEventAvailableForTemplates } from "./events";

describe("email template event availability", () => {
  const today = "2026-09-30";

  it("includes events without an end date and events ending today or later", () => {
    expect(isEventAvailableForTemplates({ endsAt: null }, today)).toBe(true);
    expect(isEventAvailableForTemplates({ endsAt: "2026-09-30" }, today)).toBe(true);
    expect(isEventAvailableForTemplates({ endsAt: "2026-10-01T12:00:00Z" }, today)).toBe(true);
  });

  it("excludes events whose end date has passed", () => {
    expect(isEventAvailableForTemplates({ endsAt: "2026-09-29" }, today)).toBe(false);
  });
});
