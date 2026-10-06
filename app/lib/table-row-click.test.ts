import { describe, expect, it, vi } from "vitest";
import { shouldActivateTableRow } from "./table-row-click";

function click(insideRow: boolean, interactive = false) {
  const closest = vi.fn((_selector: string) => (interactive ? {} : null));
  const target = Object.assign(new EventTarget(), { closest });
  const contains = vi.fn(() => insideRow);
  return { event: { defaultPrevented: false, target, currentTarget: { contains } }, closest };
}

describe("table row activation", () => {
  it("opens the profile for an ordinary cell click", () => {
    expect(shouldActivateTableRow(click(true).event)).toBe(true);
  });

  it.each(["View profile", "Archive", "Unarchive", "Dialog backdrop"])(
    "ignores %s clicks from a portal outside the row",
    () => {
      const { event, closest } = click(false);
      expect(shouldActivateTableRow(event)).toBe(false);
      expect(closest).not.toHaveBeenCalled();
    },
  );

  it("keeps in-row buttons, links and selection controls independent", () => {
    const { event, closest } = click(true, true);
    expect(shouldActivateTableRow(event)).toBe(false);
    expect(closest.mock.calls[0][0]).toContain('[role="menuitem"]');
  });

  it("does not open when selecting text or when another handler prevented the click", () => {
    expect(shouldActivateTableRow(click(true).event, "selected text")).toBe(false);
    expect(shouldActivateTableRow({ ...click(true).event, defaultPrevented: true })).toBe(false);
  });
});
