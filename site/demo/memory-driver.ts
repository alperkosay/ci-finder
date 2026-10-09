import { CiFinderError, basename, dirname, isInside } from "@ci-finder/core";
import type { ByteRange, DriverStat, StorageDriver, UploadChunk, UploadChunkResult, VolumePath, WriteData } from "@ci-finder/core";

/**
 * In-memory storage for the live demo. Everything lives in a Map keyed by volume path, so a page
 * reload starts from the seed again. Good enough to run the real engine in the browser.
 */

interface Node {
  kind: "file" | "dir";
  mtime: number;
  data?: Uint8Array;
}

const encoder = new TextEncoder();

async function toBytes(data: WriteData): Promise<Uint8Array> {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(await new Response(data).arrayBuffer());
}

export class MemoryDriver implements StorageDriver {
  readonly kind = "local";
  private readonly nodes = new Map<VolumePath, Node>([["/", { kind: "dir", mtime: Date.now() }]]);
  private readonly uploads = new Map<string, Uint8Array>();

  constructor(private readonly quota: number) {}

  private stats(path: VolumePath, node: Node): DriverStat {
    return { name: basename(path), path, kind: node.kind, size: node.data?.byteLength ?? 0, mtime: node.mtime };
  }

  private need(path: VolumePath): Node {
    const node = this.nodes.get(path);
    if (!node) throw new CiFinderError("NOT_FOUND", "File not found");
    return node;
  }

  private parentOf(path: VolumePath): Node {
    const parent = this.nodes.get(dirname(path));
    if (!parent || parent.kind !== "dir") throw new CiFinderError("NOT_FOUND", "Parent folder not found");
    return parent;
  }

  private touch(path: VolumePath) {
    const parent = this.nodes.get(dirname(path));
    if (parent) parent.mtime = Date.now();
  }

  /** The node itself and everything below it, parents before children. */
  private subtree(path: VolumePath): [VolumePath, Node][] {
    return [...this.nodes].filter(([p]) => isInside(path, p)).sort(([a], [b]) => a.length - b.length);
  }

  private used(): number {
    let size = 0;
    for (const node of this.nodes.values()) size += node.data?.byteLength ?? 0;
    for (const buf of this.uploads.values()) size += buf.byteLength;
    return size;
  }

  private reserve(bytes: number) {
    if (this.used() + bytes > this.quota) throw new CiFinderError("TOO_LARGE", "The demo storage is full");
  }

  async stat(path: VolumePath): Promise<DriverStat | null> {
    const node = this.nodes.get(path);
    return node ? this.stats(path, node) : null;
  }

  async list(path: VolumePath): Promise<DriverStat[]> {
    if (this.need(path).kind !== "dir") throw new CiFinderError("NOT_A_DIRECTORY", "Not a directory");
    const out: DriverStat[] = [];
    for (const [p, node] of this.nodes) if (p !== "/" && dirname(p) === path) out.push(this.stats(p, node));
    return out;
  }

  async hasSubdirs(path: VolumePath): Promise<boolean> {
    for (const [p, node] of this.nodes) if (node.kind === "dir" && p !== "/" && dirname(p) === path) return true;
    return false;
  }

  async mkdir(path: VolumePath): Promise<void> {
    this.parentOf(path);
    if (this.nodes.has(path)) throw new CiFinderError("EXISTS", "Already exists");
    this.nodes.set(path, { kind: "dir", mtime: Date.now() });
    this.touch(path);
  }

  async read(path: VolumePath, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const node = this.need(path);
    if (node.kind !== "file") throw new CiFinderError("NOT_A_FILE", "Not a file");
    const data = range ? node.data!.subarray(range.start, range.end + 1) : node.data!;
    return new ReadableStream({
      start(controller) {
        if (data.byteLength) controller.enqueue(data.slice());
        controller.close();
      },
    });
  }

  async write(path: VolumePath, input: WriteData): Promise<void> {
    this.parentOf(path);
    const existing = this.nodes.get(path);
    if (existing?.kind === "dir") throw new CiFinderError("NOT_A_FILE", "Not a file");
    const data = await toBytes(input);
    this.reserve(data.byteLength - (existing?.data?.byteLength ?? 0));
    this.nodes.set(path, { kind: "file", mtime: Date.now(), data });
    this.touch(path);
  }

  async remove(path: VolumePath): Promise<void> {
    this.need(path);
    for (const [p] of this.subtree(path)) this.nodes.delete(p);
    this.touch(path);
  }

  async copy(from: VolumePath, to: VolumePath): Promise<void> {
    this.need(from);
    this.parentOf(to);
    if (this.nodes.has(to)) throw new CiFinderError("EXISTS", "Already exists");
    const items = this.subtree(from);
    this.reserve(items.reduce((n, [, node]) => n + (node.data?.byteLength ?? 0), 0));
    const now = Date.now();
    for (const [p, node] of items) {
      this.nodes.set(to + p.slice(from.length), { kind: node.kind, mtime: now, data: node.data?.slice() });
    }
    this.touch(to);
  }

  async move(from: VolumePath, to: VolumePath): Promise<void> {
    this.need(from);
    this.parentOf(to);
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (this.nodes.has(to) && !caseOnly) throw new CiFinderError("EXISTS", "Already exists");
    const items = this.subtree(from);
    for (const [p] of items) this.nodes.delete(p);
    for (const [p, node] of items) this.nodes.set(to + p.slice(from.length), node);
    this.touch(from);
    this.touch(to);
  }

  async uploadChunk(chunk: UploadChunk): Promise<UploadChunkResult> {
    let session = chunk.session;
    let buffer: Uint8Array | undefined;
    if (!session) {
      this.reserve(chunk.size);
      session = crypto.randomUUID();
      buffer = new Uint8Array(chunk.size);
      this.uploads.set(session, buffer);
    } else {
      buffer = this.uploads.get(session);
      if (!buffer) throw new CiFinderError("BAD_REQUEST", "Upload session expired");
    }
    if (chunk.offset + chunk.data.byteLength > buffer.byteLength) throw new CiFinderError("BAD_REQUEST", "Chunk out of range");
    buffer.set(chunk.data, chunk.offset);

    const done = chunk.index === chunk.total - 1;
    if (done) {
      this.uploads.delete(session);
      this.parentOf(chunk.path);
      this.nodes.set(chunk.path, { kind: "file", mtime: Date.now(), data: buffer });
      this.touch(chunk.path);
    }
    return { session, done };
  }

  async abortUpload(_path: VolumePath, session: string): Promise<void> {
    this.uploads.delete(session);
  }

  async capacity(): Promise<{ total: number; free: number }> {
    return { total: this.quota, free: Math.max(0, this.quota - this.used()) };
  }
}
