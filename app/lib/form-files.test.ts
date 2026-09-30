import { describe, expect, it } from "vitest";

import { collectFormFiles } from "./form-files";

describe("collectFormFiles", () => {
  it("keeps multiple files submitted with the same field name in order", () => {
    const form = new FormData();
    form.append("insurance", new File(["one"], "public-liability.pdf"));
    form.append("insurance", new File(["two"], "product-liability.pdf"));

    expect(collectFormFiles(form, "insurance").map((file) => file.name)).toEqual([
      "public-liability.pdf",
      "product-liability.pdf",
    ]);
  });

  it("accepts the array-style field name and ignores empty files", () => {
    const form = new FormData();
    form.append("insurance[]", new File([], "empty.pdf"));
    form.append("insurance[]", new File(["valid"], "valid.pdf"));

    expect(collectFormFiles(form, "insurance", "insurance[]").map((file) => file.name)).toEqual([
      "valid.pdf",
    ]);
  });
});
