import { describe, expect, it } from "vitest";

import { collectFormFiles, collectInsuranceFiles } from "./form-files";

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

describe("collectInsuranceFiles", () => {
  it("accepts insurance input numbers beyond four without duplicate collection", () => {
    const form = new FormData();
    form.append("insurance-file-5", new File(["five"], "five.pdf"));
    form.append("insurance-file-12", new File(["twelve"], "twelve.pdf"));
    form.append("insurance-file-12", new File(["extra"], "extra.pdf"));
    form.append("insurance-file-other", new File(["unrelated"], "unrelated.pdf"));
    expect(collectInsuranceFiles(form).map((file) => file.name)).toEqual([
      "five.pdf",
      "twelve.pdf",
      "extra.pdf",
    ]);
  });
  it("collects all four Webflow upload inputs in order, including multiple files per input", () => {
    const form = new FormData();
    for (const [index, field] of [
      "insurance-file",
      "insurance-file-2",
      "insurance-file-3",
      "insurance-file-4",
    ].entries()) {
      form.append(field, new File(["document"], `insurance-${index + 1}.pdf`));
    }
    form.append("insurance-file-4", new File(["another"], "extra.pdf"));
    expect(collectInsuranceFiles(form).map((file) => file.name)).toEqual([
      "insurance-1.pdf",
      "insurance-2.pdf",
      "insurance-3.pdf",
      "insurance-4.pdf",
      "extra.pdf",
    ]);
  });

  it("retains canonical uploads and ignores empty, text, and unrelated entries", () => {
    const form = new FormData();
    form.append("insurance", new File(["one"], "one.pdf"));
    form.append("insurance[]", new File(["two"], "two.pdf"));
    form.append("insurance-file-2", new File([], "empty.pdf"));
    form.append("insurance-file-3", "not a file");
    form.append("portfolio", new File(["portfolio"], "portfolio.pdf"));
    expect(collectInsuranceFiles(form).map((file) => file.name)).toEqual(["one.pdf", "two.pdf"]);
  });
});
