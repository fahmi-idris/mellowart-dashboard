import { describe, expect, it, vi } from "vitest";

import { uploadEmailAsset } from "./email-assets.server";

function bucketWith(put: ReturnType<typeof vi.fn>): R2Bucket {
  return { put } as unknown as R2Bucket;
}

describe("uploadEmailAsset", () => {
  it("stores a validated image under a random public email-assets key", async () => {
    const put = vi.fn().mockResolvedValue({});
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "banner.png",
      { type: "image/png" },
    );

    const result = await uploadEmailAsset(bucketWith(put), png, "admin@example.com");

    expect(result.key).toMatch(/^email-assets\/[0-9a-f-]+\.png$/);
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0]).toBe(result.key);
    expect(put.mock.calls[0][2]).toMatchObject({
      httpMetadata: {
        contentType: "image/png",
        contentDisposition: "inline",
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        uploadedBy: "admin@example.com",
        originalName: "banner.png",
      },
    });
  });

  it("rejects unsupported image types", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    await expect(uploadEmailAsset(bucketWith(vi.fn()), file, "admin@example.com")).rejects.toThrow(
      "PNG, JPEG, GIF, or WebP",
    );
  });

  it("rejects a spoofed MIME type", async () => {
    const file = new File(["not a png"], "fake.png", { type: "image/png" });
    await expect(uploadEmailAsset(bucketWith(vi.fn()), file, "admin@example.com")).rejects.toThrow(
      "does not match",
    );
  });
});
