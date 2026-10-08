// `output: "standalone"` does not copy client assets; this mirrors the steps from the Next.js docs.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
// With outputFileTracingRoot at the monorepo root, the app lives under examples/next inside standalone.
const target = join(app, ".next", "standalone", "examples", "next");

cpSync(join(app, ".next", "static"), join(target, ".next", "static"), { recursive: true });
if (existsSync(join(app, "public"))) cpSync(join(app, "public"), join(target, "public"), { recursive: true });
console.log("standalone assets copied");
