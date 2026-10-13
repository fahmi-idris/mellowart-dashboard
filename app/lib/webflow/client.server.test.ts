import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WebflowClient } from "./client.server";

describe("Webflow transport invocation", () => {
  it("calls the transport without binding it to the client object", async () => {
    // Node's fetch tolerates arbitrary receivers; Workers' native fetch does not.
    // Model the Workers constraint so this regression is caught in Node unit tests.
    const send: typeof fetch = async function (this: unknown, input, init) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      expect(String(input)).toBe("https://api.webflow.com/v2/collections/example");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
      expect(init?.redirect).toBe("manual");
      return Response.json({ ok: true });
    };
    const client = new WebflowClient("test-token", AbortSignal.timeout(1000), send);
    await expect(
      client.request("/collections/example", z.object({ ok: z.boolean() })),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects redirects without following them or forwarding credentials", async () => {
    let calls = 0;
    const send: typeof fetch = async (_input, init) => {
      calls++;
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { Location: "https://untrusted.example/collect" },
      });
    };
    const client = new WebflowClient("test-token", AbortSignal.timeout(1000), send);
    await expect(
      client.request("/collections/example", z.object({ ok: z.boolean() })),
    ).rejects.toThrow("Webflow returned 302");
    expect(calls).toBe(1);
  });
});
