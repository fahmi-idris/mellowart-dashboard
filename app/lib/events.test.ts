import { describe, expect, it } from "vitest";

import { getEventPhase, isEventAvailableForTemplates } from "./events";

describe("event phase", () => {
  const today = "2026-10-01";

  it("distinguishes upcoming, ongoing, and inactive dates inclusively", () => {
    expect(getEventPhase({ startsAt: "2026-10-02", endsAt: "2026-10-03" }, today)).toBe("upcoming");
    expect(getEventPhase({ startsAt: "2026-10-01", endsAt: "2026-10-02" }, today)).toBe("ongoing");
    expect(getEventPhase({ startsAt: "2026-09-30", endsAt: "2026-10-01" }, today)).toBe("ongoing");
    expect(getEventPhase({ startsAt: "2026-09-28", endsAt: "2026-09-30" }, today)).toBe("inactive");
  });

  it("leaves undated events visibly unscheduled", () => {
    expect(getEventPhase({ startsAt: null, endsAt: null }, today)).toBe("unscheduled");
  });
});

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
