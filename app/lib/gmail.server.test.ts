import { afterEach, describe, expect, it, vi } from "vitest";

import { GOOGLE_SCOPES, hasGmailSendScope, sendTestEmail } from "./gmail.server";

afterEach(() => vi.unstubAllGlobals());

describe("template test recipient", () => {
  function testEnv(connection: unknown) {
    return { DB: { prepare: () => ({ first: async () => connection }) } } as unknown as Env;
  }

  it("sends from and to the connected Gmail mailbox", async () => {
    const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    const recipient = await sendTestEmail(
      testEnv({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
        email: "connected@example.com",
      }),
      { subject: "[TEST] Preview", html: "<p>Preview</p>" },
    );
    expect(recipient).toBe("connected@example.com");
    const payload = JSON.parse(send.mock.calls[0][1].body);
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mime).toContain("From: connected@example.com\r\n");
    expect(mime).toContain("To: connected@example.com\r\n");
  });

  it("does not send when Gmail is disconnected", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await expect(
      sendTestEmail(testEnv(null), { subject: "Test", html: "Preview" }),
    ).rejects.toThrow("Gmail is not connected");
    expect(send).not.toHaveBeenCalled();
  });
});

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
