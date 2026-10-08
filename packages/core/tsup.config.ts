import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    local: "src/drivers/local.ts",
    s3: "src/drivers/s3.ts",
    node: "src/adapters/node.ts",
    client: "src/client/index.ts",
    sharp: "src/sharp.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  external: [/^node:/, "sharp"],
  splitting: true,
  treeshake: true,
});
