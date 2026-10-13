import { describe, expect, it } from "vitest";

import { parseStallOptionForm } from "./events.server";

describe("stall option price", () => {
  function form(amount: string) {
    const data = new FormData();
    data.set("tier", "Standard");
    data.set("unitAmount", amount);
    data.set("currency", "AUD");
    return data;
  }

  it("accepts a GST-inclusive currency amount with cents", () => {
    expect(parseStallOptionForm(form("1200.50"))).toMatchObject({ unitAmount: 1200.5 });
  });

  it("rejects empty, negative, and over-precision amounts", () => {
    for (const amount of ["", "-1", "12.345"]) {
      expect(parseStallOptionForm(form(amount))).toHaveProperty("error");
    }
  });
});
