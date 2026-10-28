import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(__dirname, "dist/index.js");

mkdirSync(dirname(outFile), { recursive: true });

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  minify: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

chmodSync(outFile, 0o755);
console.log("[bug-lens-mcp] Built dist/index.js");
