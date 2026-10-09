import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", v4: "src/v4.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  platform: "browser",
  external: ["ckeditor5", /^@ckeditor\//, /^@thefinder\//, "react", "react-dom"],
});
