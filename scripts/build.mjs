import { build, context } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { watch as watchFS } from "node:fs";

const root = resolve(process.cwd());
const outdir = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");
const isE2e = process.argv.includes("--e2e") || process.env.E2E_BUILD === "true";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entries = {
  background: "src/entrypoints/background/index.ts",
  popup: "src/entrypoints/popup/index.tsx",
  permission: "src/entrypoints/permission/index.ts",
  offscreen: "src/entrypoints/offscreen/index.ts",
  content: "src/entrypoints/content/interaction-collector.ts",
  preview: "src/entrypoints/preview/index.ts",
  "report-template": "src/entrypoints/report/index.ts"
};

async function copyStaticAssets() {
  const manifestPath = resolve(root, "src/manifest.json");
  if (isE2e) {
    const raw = await readFile(manifestPath, "utf-8");
    const json = JSON.parse(raw);
    json.host_permissions = ["http://*/*", "https://*/*"];
    await writeFile(resolve(outdir, "manifest.json"), JSON.stringify(json, null, 2));
  } else {
    await cp(manifestPath, resolve(outdir, "manifest.json"));
  }

  await cp(resolve(root, "src/icons"), resolve(outdir, "icons"), { recursive: true });
  await cp(resolve(root, "src/_locales"), resolve(outdir, "_locales"), { recursive: true });
  for (const file of ["popup.html", "permission.html", "offscreen.html", "preview.html"]) {
    await cp(resolve(root, `src/entrypoints/${file.replace(".html", "")}/index.html`), resolve(outdir, file));
  }
  await cp(resolve(root, "src/entrypoints/report/index.html"), resolve(outdir, "report-template.html"));
  await cp(resolve(root, "src/entrypoints/report/static.css"), resolve(outdir, "report-static.css"));
  await cp(resolve(root, "src/shared/styles/tokens.css"), resolve(outdir, "tokens.css"));
  await cp(resolve(root, "src/entrypoints/popup/styles/popup.css"), resolve(outdir, "popup.css"));
  await cp(resolve(root, "src/entrypoints/content/collector/styles/content-collector.css"), resolve(outdir, "content-collector.css"));
  for (const style of ["base", "workspace", "interactions", "console", "network", "image-viewer", "issue-scenes", "stream"]) {
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
      jsx: "automatic",
      jsxImportSource: "preact",
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
    if (filename && !filename.endsWith(".ts") && !filename.endsWith(".tsx") && !filename.endsWith(".js")) {
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
      minify: name === "report-template",
      jsx: "automatic",
      jsxImportSource: "preact"
    });
  }
  await copyStaticAssets();
  console.log(`Built extension to ${outdir}${isE2e ? " (with E2E pre-granted host permissions)" : ""}`);
}
