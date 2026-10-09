/** Safe, readable ZIP paths; source R2 keys and stored documents are unchanged. */
function segment(value: string, fallback: string): string {
  const clean = value
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/g, "");
  const safe = clean && clean !== "." && clean !== ".." ? clean : fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? "_" + safe : safe;
}

export interface BackupApplicant {
  id: string;
  brandName?: string | null;
  secondBrandName?: string | null;
}

export interface BackupDocument {
  submissionId: string;
  key: string;
  kind: string;
  size: number | null;
}

export function nameBackupDocuments(applicants: BackupApplicant[], documents: BackupDocument[]) {
  const byId = new Map(applicants.map((applicant) => [applicant.id, applicant]));
  const used = new Set<string>();
  return documents.flatMap((document) => {
    const applicant = byId.get(document.submissionId);
    if (!applicant) return [];
    const brand = segment(applicant.brandName || "", "Applicant");
    const folder = `${segment(applicant.id, "Reference")} - ${brand}`;
    const documentBrand =
      document.kind === "second_portfolio"
        ? segment(applicant.secondBrandName || "", "Stall Buddy")
        : brand;
    const label =
      (
        {
          portfolio: "Portfolio",
          second_portfolio: "Portfolio",
          insurance: "Insurance",
          profile: "Profile",
        } as Record<string, string>
      )[document.kind] || "Document";
    const extension = /\.([a-z0-9]{1,12})$/i.exec(document.key)?.[0] || ".bin";
    const base = `${folder}/${label} ${documentBrand}`;
    let name = base + extension;
    let number = 1;
    while (used.has(name.toLowerCase())) name = `${base} (${++number})${extension}`;
    used.add(name.toLowerCase());
    return [{ ...document, name }];
  });
}
