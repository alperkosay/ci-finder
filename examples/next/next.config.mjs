import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Monorepo root: lets standalone tracing (and Turbopack) follow the workspace packages.
const repoRoot = join(here, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Never trace runtime uploads into the build output.
  outputFileTracingExcludes: { "*": ["uploads/**", "**/uploads/**"] },
};

export default nextConfig;
