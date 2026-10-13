/** One bare inbox address only: reject lists, display names, and MIME header injection. */
export function testEmailRecipient(value: string): string | null {
  if (/[\r\n]/.test(value)) return null;
  const email = value.trim();
  if (
    email.length > 254 ||
    !/^[^\s@<>(),;:"\\]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(email)
  )
    return null;
  return email;
}
