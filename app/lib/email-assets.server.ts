const MAX_EMAIL_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasText(bytes: Uint8Array, offset: number, expected: string) {
  return [...expected].every((value, index) => bytes[offset + index] === value.charCodeAt(0));
}

function hasValidSignature(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
  if (type === "image/png") {
    return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (type === "image/gif") {
    return hasText(bytes, 0, "GIF87a") || hasText(bytes, 0, "GIF89a");
  }
  if (type === "image/webp") {
    return hasText(bytes, 0, "RIFF") && hasText(bytes, 8, "WEBP");
  }
  return false;
}

export async function uploadEmailAsset(
  bucket: R2Bucket,
  file: File,
  uploadedBy: string,
): Promise<{ key: string }> {
  const extension = EXTENSION_BY_TYPE[file.type];
  if (!extension) {
    throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
  }
  if (file.size === 0) throw new Error("The selected image is empty.");
  if (file.size > MAX_EMAIL_IMAGE_BYTES) {
    throw new Error("The image must be 5 MB or smaller.");
  }

  const data = await file.arrayBuffer();
  if (!hasValidSignature(file.type, new Uint8Array(data))) {
    throw new Error("The file content does not match its image type.");
  }

  const key = `email-assets/${crypto.randomUUID()}.${extension}`;
  await bucket.put(key, data, {
    httpMetadata: {
      contentType: file.type,
      contentDisposition: "inline",
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: { uploadedBy, originalName: file.name.slice(0, 200) },
  });
  return { key };
}
