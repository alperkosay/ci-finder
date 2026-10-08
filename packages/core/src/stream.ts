import { CiFinderError } from "./errors";
import type { WriteData } from "./types";

const encoder = new TextEncoder();

export function toUint8(data: Exclude<WriteData, ReadableStream>): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

export function toStream(data: WriteData): ReadableStream<Uint8Array> {
  if (data instanceof ReadableStream) return data;
  const bytes = toUint8(data);
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function concatBytes(chunks: Uint8Array[], total?: number): Uint8Array {
  const size = total ?? chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Reads a whole stream into memory, failing with TOO_LARGE past `limit` bytes. */
export async function readAll(stream: ReadableStream<Uint8Array>, limit = Infinity): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new CiFinderError("TOO_LARGE", "File is too large");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks, total);
}

/** Wraps an async generator as a pull-based ReadableStream (respects backpressure, propagates cancel). */
export function streamFromGenerator(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel(reason) {
      await gen.return?.(undefined as never);
      void reason;
    },
  });
}

/** Runs `fn` over `items` with at most `limit` concurrent promises. Preserves order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
