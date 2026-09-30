/** Collect every non-empty file submitted under any of the accepted field names. */
export function collectFormFiles(form: FormData, ...fieldNames: string[]): File[] {
  return fieldNames.flatMap((fieldName) =>
    form
      .getAll(fieldName)
      .filter((entry): entry is File => entry instanceof File && entry.size > 0),
  );
}
