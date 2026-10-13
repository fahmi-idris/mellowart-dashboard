import { describe, expect, it } from "vitest";
import { nameBackupDocuments } from "./inquiry-backup";

describe("backup document names", () => {
  const applicant = {
    id: "ART-123",
    brandName: "Mellow Art Market",
    secondBrandName: "Buddy Brand",
  };
  const document = (kind: string, extension = ".pdf") => ({
    submissionId: applicant.id,
    kind,
    key: `submissions/ART-123/${kind}/uuid${extension}`,
    size: 4,
  });

  it("uses the reference and brand folder, document labels, and original extension", () => {
    expect(
      nameBackupDocuments(
        [applicant],
        [document("portfolio"), document("insurance"), document("second_portfolio", ".jpeg")],
      ).map((d) => d.name),
    ).toEqual([
      "ART-123 - Mellow Art Market/Portfolio Mellow Art Market.pdf",
      "ART-123 - Mellow Art Market/Insurance Mellow Art Market.pdf",
      "ART-123 - Mellow Art Market/Portfolio Buddy Brand.jpeg",
    ]);
  });
  it("keeps every insurance document without duplicate ZIP names", () => {
    const named = nameBackupDocuments(
      [applicant],
      [document("insurance"), document("insurance"), document("insurance")],
    );
    expect(named.map((d) => d.name)).toEqual([
      "ART-123 - Mellow Art Market/Insurance Mellow Art Market.pdf",
      "ART-123 - Mellow Art Market/Insurance Mellow Art Market (2).pdf",
      "ART-123 - Mellow Art Market/Insurance Mellow Art Market (3).pdf",
    ]);
  });
  it("removes path separators and unsafe filename characters, with a missing-brand fallback", () => {
    const malicious = { ...applicant, brandName: "../Brand: A\\B / C?" };
    const name = nameBackupDocuments([malicious], [document("portfolio")])[0].name;
    expect(name.split("/")).toHaveLength(2);
    expect(name).not.toContain("../");
    expect(name).not.toMatch(/[\\:*?"<>|]/);
    expect(nameBackupDocuments([{ id: applicant.id }], [document("insurance")])[0].name).toContain(
      "ART-123 - Applicant/Insurance Applicant.pdf",
    );
    expect(nameBackupDocuments([], [document("portfolio")])).toEqual([]);
  });
});
