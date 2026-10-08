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
  // sharp's native libraries (libvips DLL/.so) are loaded by the binary, not by `require`, so
  // file tracing misses them; ship them explicitly so thumbnails work in standalone deploys.
  // In a non-monorepo app the path is "./node_modules/@img/**/*".
  outputFileTracingIncludes: { "/api/files": ["../../node_modules/@img/**/*"] },
};

export default nextConfig;
