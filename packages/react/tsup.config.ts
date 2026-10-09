import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  platform: "browser",
  external: ["react", "react-dom", "react/jsx-runtime", /^@thefinder\//],
  // Next.js App Router: the whole UI is a client component.
  banner: { js: '"use client";' },
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
