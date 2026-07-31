import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { watch as watchFS } from "node:fs";

const root = resolve(process.cwd());
const outdir = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");

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

async function copyStaticAssets() {
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
}

if (isWatch) {
  console.log("Starting esbuild watch mode...");
  await copyStaticAssets();

  for (const [name, entry] of Object.entries(entries)) {
    const ctx = await context({
      entryPoints: [resolve(root, entry)],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome125"],
      outfile: resolve(outdir, `${name}.js`),
      sourcemap: true,
      minify: false,
      plugins: [
        {
          name: "rebuild-notify",
          setup(build) {
            build.onEnd((result) => {
              const time = new Date().toLocaleTimeString();
              if (result.errors.length > 0) {
                console.error(`[${time}] [watch] ${name}.js rebuild failed with errors.`);
              } else {
                console.log(`[${time}] [watch] ${name}.js rebuild complete.`);
              }
            });
          }
        }
      ]
    });
    await ctx.watch();
  }

  watchFS(resolve(root, "src"), { recursive: true }, async (eventType, filename) => {
    if (filename && !filename.endsWith(".ts") && !filename.endsWith(".js")) {
      try {
        await copyStaticAssets();
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] [watch] Static assets updated (${filename}).`);
      } catch (e) {
        console.error("[watch] Error updating static assets:", e);
      }
    }
  });

  console.log("Watch mode ready. Watching for file changes...");
} else {
  for (const [name, entry] of Object.entries(entries)) {
    await build({
      entryPoints: [resolve(root, entry)],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome125"],
      outfile: resolve(outdir, `${name}.js`),
      sourcemap: false,
      minify: name === "report-template"
    });
  }
  await copyStaticAssets();
  console.log(`Built extension to ${outdir}`);
}
