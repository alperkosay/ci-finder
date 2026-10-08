import { CiFinderError } from "./errors";
import type { ImageFormat, ImageProcessor, ImageTransformOptions, Thumbnailer } from "./types";

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

export interface SharpImagesOptions {
  /** Refuse images above this many pixels (decompression bomb guard). Default: 120 megapixels. */
  maxPixels?: number;
  /** Encoder effort for WebP/AVIF, trading speed for size. Default: 4. */
  effort?: number;
}

const ANIMATED = new Set<ImageFormat>(["gif", "webp"]);

/**
 * Bulk resize / recompress / convert backed by `sharp`. Honors EXIF orientation, strips metadata,
 * never upscales and keeps animations when both the source and the target format support them.
 */
export function sharpImages(options: SharpImagesOptions = {}): ImageProcessor {
  const limitInputPixels = options.maxPixels ?? 120_000_000;
  const effort = options.effort ?? 4;
  return {
    extensions: ["jpg", "jpeg", "jfif", "png", "webp", "gif", "avif", "tif", "tiff", "heic", "heif"],
    formats: ["jpeg", "png", "webp", "avif", "gif"],
    async transform(input, options) {
      const sharp = await loadSharp();
      if (!sharp) throw new CiFinderError("UNSUPPORTED", "Image processing is unavailable");
      try {
        return await run(sharp, input, options);
      } catch (e) {
        if (e instanceof CiFinderError) throw e;
        const message = String((e as Error)?.message ?? e).split("\n")[0]!;
        // Corrupt or unknown input is a property of the file, not a server failure.
        throw new CiFinderError(/pixel limit/i.test(message) ? "TOO_LARGE" : "INVALID_IMAGE", message);
      }
    },
  };

  async function run(sharp: Sharp, input: Uint8Array, { format, width, height, quality = 80 }: ImageTransformOptions) {
    const meta = await sharp(input, { limitInputPixels, failOn: "none" }).metadata();
    const animated = (meta.pages ?? 1) > 1 && ANIMATED.has(format);
    let pipeline = sharp(input, { limitInputPixels, failOn: "none", animated }).rotate();
    if (width || height) pipeline = pipeline.resize(width || null, height || null, { fit: "inside", withoutEnlargement: true });
    const q = Math.min(100, Math.max(1, Math.round(quality)));
    switch (format) {
      case "jpeg":
        pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: q, mozjpeg: true });
        break;
      case "png":
        pipeline = pipeline.png(q < 100 ? { palette: true, quality: q, compressionLevel: 9, effort: 8 } : { compressionLevel: 9 });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality: q, effort });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality: q, effort });
        break;
      case "gif":
        pipeline = pipeline.gif({ effort: 7 });
        break;
      default:
        throw new CiFinderError("UNSUPPORTED", `Cannot write ${String(format)} images`);
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: animated && info.pageHeight ? info.pageHeight : info.height,
    };
  }
}
