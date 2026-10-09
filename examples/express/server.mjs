import express from "express";
import { fileURLToPath } from "node:url";
import { createTheFinder, createFileServer } from "@thefinder/core";
import { localDriver } from "@thefinder/core/local";
import { toExpress } from "@thefinder/core/node";
import { sharpImages, sharpThumbnailer } from "@thefinder/core/sharp";

const driver = localDriver({ root: fileURLToPath(new URL("./uploads", import.meta.url)) });
const finder = createTheFinder({
  volumes: [{ id: "files", name: "Files", driver, url: "/uploads" }],
  thumbnails: { generator: sharpThumbnailer() },
  // Bulk resize / compress / convert (WebP, AVIF...) from the "Optimize images" dialog.
  images: sharpImages(),
  // authorize: ({ request }) => request.headers.get("authorization") === `Bearer ${process.env.TOKEN}`,
});

const app = express();

// Body parsers are fine: theFinder rebuilds the body when Express already consumed it.
app.use(express.json());

app.all("/api/files", toExpress(finder.handler));
app.get("/uploads/*path", toExpress(createFileServer({ driver, prefix: "/uploads" })));

const port = Number(process.env.PORT ?? 3400);
app.listen(port, () => console.log(`theFinder on Express → http://localhost:${port}`));
