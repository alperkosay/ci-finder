import { createCiFinder, createFileServer } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";
import { sharpImages, sharpThumbnailer } from "@ci-finder/core/sharp";
import { join } from "node:path";
import index from "./index.html";

const driver = localDriver({ root: join(import.meta.dir, "uploads") });

const finder = createCiFinder({
  volumes: [{ id: "files", name: "Files", driver, url: "/uploads" }],
  thumbnails: { generator: sharpThumbnailer() },
  // Bulk resize / compress / convert (WebP, AVIF...) from the "Optimize images" dialog.
  images: sharpImages(),
});

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3300),
  routes: {
    // Bun bundles the React UI (TSX + CSS) on the fly.
    "/": index,
    "/api/files": finder.handler,
    "/uploads/*": createFileServer({ driver, prefix: "/uploads" }),
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`ciFinder on Bun → ${server.url}`);
