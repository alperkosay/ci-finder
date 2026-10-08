import { CiFinderError } from "./errors";
import { dirname, extname } from "./path";
import { readAll } from "./stream";
import type { DriverStat, ThumbnailOptions, VolumePath } from "./types";
import type { Volume } from "./volume";

/**
 * Server-side thumbnails. Generated on first request by a pluggable `Thumbnailer` (e.g. sharp) and
 * cached inside the volume under `/.cf-thumbs/<size>/<sha1(path)>.<ext>`, so they work on local
 * disk and S3 alike. A cached thumbnail is reused while it is newer than its source.
 */
export const THUMBS_ROOT = "/.cf-thumbs";
export const THUMBS_NAME = ".cf-thumbs";

export function isThumbsPath(path: VolumePath): boolean {
  return path === THUMBS_ROOT || path.startsWith(THUMBS_ROOT + "/");
}

const DEFAULT_SIZES = [128, 256, 512];

async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class ThumbnailService {
  readonly sizes: number[];
  readonly extensions: Set<string>;
  private readonly maxInputSize: number;
  private readonly concurrency: number;
  private running = 0;
  private readonly queue: (() => void)[] = [];
  private readonly inflight = new Map<string, Promise<DriverStat>>();

  constructor(private readonly options: ThumbnailOptions) {
    this.sizes = [...(options.sizes?.length ? options.sizes : DEFAULT_SIZES)].sort((a, b) => a - b);
    this.extensions = new Set(options.generator.extensions.map((e) => e.toLowerCase()));
    this.maxInputSize = options.maxInputSize ?? 40 * 1024 * 1024;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  supports(stat: DriverStat): boolean {
    return stat.kind === "file" && stat.size > 0 && this.extensions.has(extname(stat.name));
  }

  /** Snaps a requested size to the closest allowed size (never generates arbitrary sizes). */
  pick(requested: number): number {
    return this.sizes.find((s) => s >= requested) ?? this.sizes[this.sizes.length - 1]!;
  }

  private async pathFor(vol: Volume, source: VolumePath, size: number): Promise<VolumePath> {
    return `${THUMBS_ROOT}/${size}/${await sha1(`${vol.id}:${source}`)}.${this.options.generator.extension ?? "webp"}`;
  }

  /** Runs `fn` once a generation slot is free; protects the CPU when a folder of photos opens. */
  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }

  /** Returns the stat of an up-to-date thumbnail, generating and caching it when needed. */
  async get(vol: Volume, source: DriverStat, size: number): Promise<DriverStat> {
    const path = await this.pathFor(vol, source.path, size);
    const cached = await vol.driver.stat(path);
    if (cached && cached.mtime >= source.mtime) return cached;

    const key = `${vol.id}:${path}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = this.limit(async () => {
      if (source.size > this.maxInputSize) throw new CiFinderError("TOO_LARGE", "Image is too large for a thumbnail");
      const input = await readAll(await vol.driver.read(source.path), this.maxInputSize);
      const output = await this.options.generator.generate(input, size);
      await vol.mkdirp(dirname(path));
      await vol.driver.write(path, output);
      const stat = await vol.driver.stat(path);
      if (!stat) throw new CiFinderError("STORAGE", "Thumbnail was not stored");
      return stat;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** Best-effort removal of the cached thumbnails of a file that was deleted, moved or renamed. */
  async forget(vol: Volume, source: VolumePath): Promise<void> {
    await Promise.all(
      this.sizes.map(async (size) => {
        const path = await this.pathFor(vol, source, size);
        if (await vol.driver.stat(path).catch(() => null)) await vol.driver.remove(path).catch(() => {});
      }),
    );
  }
}
