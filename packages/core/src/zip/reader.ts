import { CiFinderError } from "../errors";
import { readAll } from "../stream";
import type { ByteRange } from "../types";

export interface ZipEntry {
  name: string;
  dir: boolean;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  mtime: number;
}

/** Random-access reader: the archive is never loaded into memory as a whole. */
export type RangeReader = (range: ByteRange) => Promise<ReadableStream<Uint8Array>>;

const utf8 = new TextDecoder("utf-8");
/** CP437 is the legacy default for names without the UTF-8 flag; Latin-1 is a close enough fallback. */
const legacy = new TextDecoder("latin1");

async function readRange(read: RangeReader, start: number, length: number): Promise<DataView> {
  if (length <= 0) return new DataView(new ArrayBuffer(0));
  const bytes = await readAll(await read({ start, end: start + length - 1 }));
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function invalid(): never {
  throw new CiFinderError("INVALID_ARCHIVE", "The file is not a valid ZIP archive");
}

const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

function dosToMs(date: number, time: number): number {
  return new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0x0f) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime();
}

export async function readZipEntries(read: RangeReader, fileSize: number): Promise<ZipEntry[]> {
  if (fileSize < 22) invalid();
  const tailLen = Math.min(fileSize, 22 + 0xffff + 20);
  const tailStart = fileSize - tailLen;
  const tail = await readRange(read, tailStart, tailLen);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) invalid();

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64 end of central directory locator sits right before the EOCD.
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const eocd64Offset = u64(tail, eocd - 20 + 8);
    const z = await readRange(read, eocd64Offset, 56);
    if (z.getUint32(0, true) !== 0x06064b50) invalid();
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }
  if (cdOffset + cdSize > fileSize) invalid();

  const cd = await readRange(read, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) invalid();
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const time = cd.getUint16(p + 12, true);
    const date = cd.getUint16(p + 14, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const externalAttrs = cd.getUint32(p + 38, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    const name = (flags & 0x0800 ? utf8 : legacy).decode(nameBytes).replace(/\\/g, "/");

    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, q);
      }
      e += 4 + len;
    }

    const dir = name.endsWith("/") || (externalAttrs & 0x10) !== 0;
    entries.push({ name, dir, method, compressedSize, size, localHeaderOffset, mtime: dosToMs(date, time) });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Returns the decompressed content of one entry as a stream. Supports STORE and DEFLATE. */
export async function openZipEntry(read: RangeReader, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new CiFinderError("UNSUPPORTED", `Compression method ${entry.method} is not supported`);
  }
  const header = await readRange(read, entry.localHeaderOffset, 30);
  if (header.getUint32(0, true) !== 0x04034b50) invalid();
  const dataStart = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (entry.compressedSize === 0) {
    return new ReadableStream({ start: (c) => c.close() });
  }
  const raw = await read({ start: dataStart, end: dataStart + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
}
