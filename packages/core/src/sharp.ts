import { CiFinderError } from "./errors";
import type { Thumbnailer } from "./types";

export interface SharpThumbnailerOptions {
  /** WebP quality, 1–100. Default: 78. */
  quality?: number;
  /** Refuse images above this many pixels (decompression bomb guard). Default: 120 megapixels. */
  maxPixels?: number;
}

type Sharp = typeof import("sharp").default;

let loaded: Promise<Sharp | null> | null = null;

/**
 * Loads sharp on first use. A missing or broken sharp install (e.g. native binaries not copied
 * into a deployment) must never take the file manager down: thumbnails are then disabled and the
 * original images are served instead.
 */
function loadSharp(): Promise<Sharp | null> {
  loaded ??= import("sharp").then(
    (mod) => (mod as unknown as { default?: Sharp }).default ?? (mod as unknown as Sharp),
    (error: unknown) => {
      console.warn(
        `[ci-finder] sharp could not be loaded, serving original images instead of thumbnails: ${(error as Error)?.message?.split("\n")[0] ?? error}`,
      );
      return null;
    },
  );
  return loaded;
}

/**
 * Thumbnail generator backed by `sharp` (already installed in every Next.js app for `next/image`;
 * elsewhere `npm i sharp`). Honors EXIF orientation, keeps the aspect ratio and never upscales.
 */
export function sharpThumbnailer(options: SharpThumbnailerOptions = {}): Thumbnailer {
  const quality = options.quality ?? 78;
  const limitInputPixels = options.maxPixels ?? 120_000_000;
  return {
    extensions: ["jpg", "jpeg", "jfif", "png", "webp", "gif", "avif", "tif", "tiff", "heic", "heif"],
    extension: "webp",
    async generate(input, size) {
      const sharp = await loadSharp();
      if (!sharp) throw new CiFinderError("UNSUPPORTED", "Thumbnails are unavailable");
      const buffer = await sharp(input, { limitInputPixels, failOn: "none" })
        .rotate()
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 3 })
        .toBuffer();
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },
  };
}
