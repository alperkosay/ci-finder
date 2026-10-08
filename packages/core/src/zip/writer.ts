import { streamFromGenerator } from "../stream";
import { crc32 } from "./crc32";

export interface ZipSource {
  /** Path inside the archive, "/" separated. Directories end with "/". */
  name: string;
  mtime: number;
  /** Uncompressed size; used to decide on ZIP64 for very large files. */
  size?: number;
  open?: () => Promise<ReadableStream<Uint8Array>>;
}

const encoder = new TextEncoder();
const MAX32 = 0xffffffff;
/** Above this size a file gets a ZIP64 local header, leaving headroom for deflate overhead. */
const ZIP64_THRESHOLD = 0xf0000000;

/** Formats that are already compressed; deflating them only burns CPU. */
const STORED = /\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|opus|flac|zip|rar|7z|gz|tgz|bz2|xz|zst|woff2?|pdf|docx|xlsx|pptx)$/i;

function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

class Bytes {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.pos, BigInt(v), true);
    this.pos += 8;
    return this;
  }
  bytes(b: Uint8Array) {
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  get result() {
    return this.buf;
  }
}

interface CentralRecord {
  name: Uint8Array;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  date: number;
  time: number;
  dir: boolean;
}

/**
 * Streams a ZIP archive. Entries are written with data descriptors so nothing has to be buffered;
 * ZIP64 records are emitted automatically for files over ~4 GB, archives over 4 GB or >65535 entries.
 */
export function createZipStream(sources: AsyncIterable<ZipSource> | Iterable<ZipSource>): ReadableStream<Uint8Array> {
  return streamFromGenerator(zipGenerator(sources));
}

async function* zipGenerator(sources: AsyncIterable<ZipSource> | Iterable<ZipSource>): AsyncGenerator<Uint8Array> {
  const records: CentralRecord[] = [];
  let offset = 0;

  for await (const src of sources) {
    const dir = src.name.endsWith("/");
    const name = encoder.encode(src.name);
    const { date, time } = dosDateTime(src.mtime);
    const method = dir || STORED.test(src.name) ? 0 : 8;
    const zip64 = !dir && (src.size ?? 0) >= ZIP64_THRESHOLD;
    const flags = 0x0800 | (dir ? 0 : 0x0008); // UTF-8 names, sizes in data descriptor

    const header = new Bytes(30 + name.length + (zip64 ? 20 : 0))
      .u32(0x04034b50)
      .u16(zip64 ? 45 : 20)
      .u16(flags)
      .u16(method)
      .u16(time)
      .u16(date)
      .u32(0)
      .u32(zip64 ? MAX32 : 0)
      .u32(zip64 ? MAX32 : 0)
      .u16(name.length)
      .u16(zip64 ? 20 : 0)
      .bytes(name);
    if (zip64) header.u16(0x0001).u16(16).u64(0).u64(0);
    yield header.result;

    const record: CentralRecord = { name, method, crc: 0, compressed: 0, size: 0, offset, date, time, dir };
    offset += header.result.length;

    if (!dir && src.open) {
      let crc = 0;
      let size = 0;
      const tap = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          crc = crc32(chunk, crc);
          size += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      let body = (await src.open()).pipeThrough(tap);
      if (method === 8) body = body.pipeThrough(new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);

      let compressed = 0;
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        compressed += value.byteLength;
        yield value;
      }
      record.crc = crc;
      record.size = size;
      record.compressed = compressed;
      offset += compressed;

      const descriptor = zip64
        ? new Bytes(24).u32(0x08074b50).u32(crc).u64(compressed).u64(size)
        : new Bytes(16).u32(0x08074b50).u32(crc).u32(compressed).u32(size);
      yield descriptor.result;
      offset += descriptor.result.length;
    }
    records.push(record);
  }

  const cdStart = offset;
  for (const r of records) {
    const needs64 = r.size >= MAX32 || r.compressed >= MAX32 || r.offset >= MAX32;
    const extra = needs64 ? 28 : 0;
    const entry = new Bytes(46 + r.name.length + extra)
      .u32(0x02014b50)
      .u16((3 << 8) | 45) // made by: Unix, spec 4.5
      .u16(needs64 ? 45 : 20)
      .u16(0x0800 | (r.dir ? 0 : 0x0008))
      .u16(r.method)
      .u16(r.time)
      .u16(r.date)
      .u32(r.crc)
      .u32(needs64 ? MAX32 : r.compressed)
      .u32(needs64 ? MAX32 : r.size)
      .u16(r.name.length)
      .u16(extra)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(r.dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0)
      .u32(needs64 ? MAX32 : r.offset)
      .bytes(r.name);
    if (needs64) entry.u16(0x0001).u16(24).u64(r.size).u64(r.compressed).u64(r.offset);
    yield entry.result;
    offset += entry.result.length;
  }
  const cdSize = offset - cdStart;

  const needsEocd64 = records.length >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32;
  if (needsEocd64) {
    const eocd64Offset = offset;
    yield new Bytes(56)
      .u32(0x06064b50)
      .u64(44)
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(records.length)
      .u64(records.length)
      .u64(cdSize)
      .u64(cdStart).result;
    yield new Bytes(20).u32(0x07064b50).u32(0).u64(eocd64Offset).u32(1).result;
  }
  yield new Bytes(22)
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(Math.min(records.length, 0xffff))
    .u16(Math.min(records.length, 0xffff))
    .u32(Math.min(cdSize, MAX32))
    .u32(Math.min(cdStart, MAX32))
    .u16(0).result;
}
