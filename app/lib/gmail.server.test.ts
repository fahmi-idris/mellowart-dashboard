import { describe, expect, it } from "vitest";

import { GOOGLE_SCOPES, hasGmailSendScope } from "./gmail.server";

describe("Gmail OAuth scopes", () => {
  it("requests permission to send email", () => {
    expect(hasGmailSendScope(GOOGLE_SCOPES)).toBe(true);
  });

  it("rejects a grant that omits Gmail send permission", () => {
    expect(hasGmailSendScope("openid email")).toBe(false);
    expect(hasGmailSendScope(undefined)).toBe(false);
    expect(hasGmailSendScope("https://www.googleapis.com/auth/gmail.send.extra")).toBe(false);
  });
});
