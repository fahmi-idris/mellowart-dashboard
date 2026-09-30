/** Streaming, uncompressed ZIP writer for exports that may contain large R2 files. */
export interface ZipEntry {
  name: string;
  body: Uint8Array | ReadableStream<Uint8Array>;
}

const encoder = new TextEncoder();
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}

function crc32(previous: number, bytes: Uint8Array): number {
  let crc = previous;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc;
}

function record(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

async function* chunks(body: ZipEntry["body"]): AsyncGenerator<Uint8Array> {
  if (body instanceof Uint8Array) {
    yield body;
    return;
  }
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* zipBytes(entries: AsyncIterable<ZipEntry>): AsyncGenerator<Uint8Array> {
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  for await (const entry of entries) {
    const name = encoder.encode(entry.name);
    const localOffset = offset;
    const header = record(30 + name.length, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0808, true); // UTF-8 + trailing data descriptor
      v.setUint16(26, name.length, true);
    });
    header.set(name, 30);
    offset += header.length;
    yield header;

    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of chunks(entry.body)) {
      crc = crc32(crc, chunk);
      size += chunk.length;
      offset += chunk.length;
      yield chunk;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = record(16, (v) => {
      v.setUint32(0, 0x08074b50, true);
      v.setUint32(4, crc, true);
      v.setUint32(8, size, true);
      v.setUint32(12, size, true);
    });
    offset += descriptor.length;
    yield descriptor;

    const directory = record(46 + name.length, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0808, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, size, true);
      v.setUint32(24, size, true);
      v.setUint16(28, name.length, true);
      v.setUint32(42, localOffset, true);
    });
    directory.set(name, 46);
    central.push(directory);
    count++;
  }

  const centralOffset = offset;
  for (const item of central) {
    offset += item.length;
    yield item;
  }
  yield record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, count, true);
    v.setUint16(10, count, true);
    v.setUint32(12, offset - centralOffset, true);
    v.setUint32(16, centralOffset, true);
  });
}

export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const iterator = zipBytes(entries);
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
