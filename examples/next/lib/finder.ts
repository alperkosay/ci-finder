import { sharpThumbnailer } from "@ci-finder/core/sharp";
import { createCiFinder, localDriver, s3Driver, uploadsDir, type VolumeOptions } from "@ci-finder/next";

/**
 * One shared ciFinder instance for the app.
 * Files are stored in `<project root>/uploads` (also under `output: "standalone"`)
 * and served by `app/uploads/[...path]/route.ts`.
 */
const volumes: VolumeOptions[] = [
  {
    id: "uploads",
    name: "Uploads",
    driver: localDriver({ root: uploadsDir() }),
    url: "/uploads",
    denyExtensions: ["php", "phtml", "exe", "sh", "bat", "cmd"],
    maxUploadSize: 1024 * 1024 * 1024,
  },
];

// Optional second volume on S3 / R2 / MinIO, enabled through environment variables.
if (process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
  volumes.push({
    id: "s3",
    name: process.env.S3_NAME ?? "S3",
    driver: s3Driver({
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      prefix: process.env.S3_PREFIX,
    }),
    url: process.env.S3_PUBLIC_URL,
  });
}

export const finder = createCiFinder({
  volumes,
  // sharp ships with Next.js (next/image), so thumbnails need no extra install here.
  thumbnails: { generator: sharpThumbnailer() },
  // authorize: async ({ request }) => Boolean(await getSession(request)),
});
