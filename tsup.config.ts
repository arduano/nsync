import path from "path";
import { defineConfig } from "tsup";

export default defineConfig(({ watch, entry, external }) => {
  let args = process.argv;
  if (args.includes("--")) {
    args = args.slice(args.indexOf("--") + 1);
  } else {
    args = [];
  }

  return {
    entry: ["src/main.ts"],
    splitting: false,
    sourcemap: true,
    clean: true,
    format: ["cjs"],
    platform: "node",
    minify: true,
    dts: false,
    bundle: true,
    metafile: true,
    treeshake: true,
    noExternal: ["cmd-ts", "execa", "ink"],
    onSuccess: `node --enable-source-maps dist/main.js ${args.join(" ")}`,
    loader: {
      ".json": "copy",
    },
  };
});
