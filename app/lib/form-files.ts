/** Collect every non-empty file submitted under any of the accepted field names. */
export function collectFormFiles(form: FormData, ...fieldNames: string[]): File[] {
  return fieldNames.flatMap((fieldName) =>
    form
      .getAll(fieldName)
      .filter((entry): entry is File => entry instanceof File && entry.size > 0),
  );
}

/** Canonical multipart names plus any numbered Webflow insurance upload input. */
export function collectInsuranceFiles(form: FormData): File[] {
  const fieldNames = [...new Set(form.keys())].filter(
    (name) =>
      name === "insurance" || name === "insurance[]" || /^insurance-file(?:-[1-9]\d*)?$/.test(name),
  );
  return collectFormFiles(form, ...fieldNames);
}
