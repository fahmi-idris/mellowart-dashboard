import { describe, expect, it } from "vitest";
import { testEmailRecipient } from "./test-email-recipient";

describe("test email recipient", () => {
  it("accepts a trimmed inbox address including aliases", () => {
    expect(testEmailRecipient(" hello+test@example.com ")).toBe("hello+test@example.com");
  });
  it.each([
    "",
    "wrong",
    "a@example.com,b@example.com",
    "Name <a@example.com>",
    "a@example.com\r\nBcc:b@example.com",
    "a@example.com\n",
    "a b@example.com",
  ])("rejects unsafe or incomplete addresses: %s", (value) => {
    expect(testEmailRecipient(value)).toBeNull();
  });
});
