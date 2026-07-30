import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const outdir = resolve(root, "dist");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entries = {
  background: "src/entrypoints/background/index.ts",
  popup: "src/entrypoints/popup/index.ts",
  permission: "src/entrypoints/permission/index.ts",
  offscreen: "src/entrypoints/offscreen/index.ts",
  content: "src/entrypoints/content/interaction-collector.ts",
  preview: "src/entrypoints/preview/index.ts",
  "report-template": "src/entrypoints/report/index.ts"
};

for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome125"],
    outfile: resolve(outdir, `${name}.js`),
    sourcemap: false,
    minify: false
  });
}

await cp(resolve(root, "src/manifest.json"), resolve(outdir, "manifest.json"));
await cp(resolve(root, "src/icons"), resolve(outdir, "icons"), { recursive: true });
await cp(resolve(root, "src/_locales"), resolve(outdir, "_locales"), { recursive: true });
for (const file of ["popup.html", "permission.html", "offscreen.html", "preview.html"]) {
  await cp(resolve(root, `src/entrypoints/${file.replace(".html", "")}/index.html`), resolve(outdir, file));
}
await cp(resolve(root, "src/entrypoints/report/index.html"), resolve(outdir, "report-template.html"));
await cp(resolve(root, "src/entrypoints/report/static.css"), resolve(outdir, "report-static.css"));
for (const style of ["base", "workspace", "interactions", "console", "network", "image-viewer", "issue-scenes"]) {
  await cp(
    resolve(root, `src/entrypoints/preview/styles/${style}.css`),
    resolve(outdir, `preview-${style}.css`)
  );
}
console.log(`Built extension to ${outdir}`);
