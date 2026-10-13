import { describe, expect, it } from "vitest";
import { zipStream, type ZipEntry } from "./zip.server";

describe("backup ZIP stream", () => {
  it("writes readable local entries and a central directory", async () => {
    async function* entries(): AsyncGenerator<ZipEntry> {
      yield { name: "inquiries.csv", body: new TextEncoder().encode("id\nART-ONE\n") };
      yield { name: "images/test.txt", body: new Blob(["image body"]).stream() };
    }
    const bytes = new Uint8Array(await new Response(zipStream(entries())).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 14, true)).toBe(2);
    expect(new TextDecoder().decode(bytes)).toContain("ART-ONE");
    expect(new TextDecoder().decode(bytes)).toContain("images/test.txt");
  });
});
