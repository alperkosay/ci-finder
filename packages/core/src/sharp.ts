import sharp from "sharp";
import type { Thumbnailer } from "./types";

export interface SharpThumbnailerOptions {
  /** WebP quality, 1–100. Default: 78. */
  quality?: number;
  /** Refuse images above this many pixels (decompression bomb guard). Default: 120 megapixels. */
  maxPixels?: number;
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
      const buffer = await sharp(input, { limitInputPixels, failOn: "none" })
        .rotate()
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 3 })
        .toBuffer();
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    },
  };
}
