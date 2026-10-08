import express from "express";
import { fileURLToPath } from "node:url";
import { createCiFinder, createFileServer } from "@ci-finder/core";
import { localDriver } from "@ci-finder/core/local";
import { toExpress } from "@ci-finder/core/node";

const driver = localDriver({ root: fileURLToPath(new URL("./uploads", import.meta.url)) });
const finder = createCiFinder({
  volumes: [{ id: "files", name: "Files", driver, url: "/uploads" }],
  // authorize: ({ request }) => request.headers.get("authorization") === `Bearer ${process.env.TOKEN}`,
});

const app = express();

// Body parsers are fine: ciFinder rebuilds the body when Express already consumed it.
app.use(express.json());

app.all("/api/files", toExpress(finder.handler));
app.get("/uploads/*path", toExpress(createFileServer({ driver, prefix: "/uploads" })));

const port = Number(process.env.PORT ?? 3400);
app.listen(port, () => console.log(`ciFinder on Express → http://localhost:${port}`));
