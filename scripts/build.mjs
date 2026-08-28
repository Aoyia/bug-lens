import { build, context, transform } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { watch as watchFS } from "node:fs";
import { WebSocketServer } from "ws";

const root = resolve(process.cwd());
const outdir = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");
const isE2e =
  process.argv.includes("--e2e") || process.env.E2E_BUILD === "true";

let wss = null;
if (isWatch) {
  wss = new WebSocketServer({ port: 8899 });
  console.log(
    "[dev-reloader] WebSocket server listening on ws://localhost:8899"
  );
}

function notifyReload() {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send("reload");
    }
  });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

function minifyHtml(html) {
  if (isWatch) return html;
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s+/gm, "")
    .replace(/\n+/g, "\n");
}

async function copyHtmlAsset(src, dest) {
  const content = await readFile(src, "utf-8");
  await writeFile(dest, minifyHtml(content));
}

async function copyCssAsset(src, dest) {
  const css = await readFile(src, "utf-8");
  const result = await transform(css, {
    loader: "css",
    minify: !isWatch,
  });
  await writeFile(dest, result.code);
}

async function buildMergedPreviewCss() {
  const previewStyleNames = [
    "tokens",
    "base",
    "workspace",
    "interactions",
    "console",
    "network",
    "image-viewer",
    "issue-scenes",
    "stream",
    "playwright",
  ];

  const cssChunks = await Promise.all(
    previewStyleNames.map(async (name) => {
      const p =
        name === "tokens"
          ? resolve(root, "src/shared/styles/tokens.css")
          : resolve(root, `src/entrypoints/preview/styles/${name}.css`);
      return readFile(p, "utf-8");
    })
  );

  const merged = cssChunks.join("\n");
  const result = await transform(merged, {
    loader: "css",
    minify: !isWatch,
  });
  await writeFile(resolve(outdir, "preview.css"), result.code);
}

async function copyLocales() {
  const localesDir = resolve(root, "src/_locales");
  const outLocalesDir = resolve(outdir, "_locales");
  const list = await readdir(localesDir, { withFileTypes: true });

  for (const entry of list) {
    if (entry.isDirectory()) {
      const locale = entry.name;
      const srcFile = resolve(localesDir, locale, "messages.json");
      const destFolder = resolve(outLocalesDir, locale);
      await mkdir(destFolder, { recursive: true });

      const raw = await readFile(srcFile, "utf-8");
      const json = JSON.parse(raw);
      const stripped = {};
      for (const [key, val] of Object.entries(json)) {
        if (typeof val === "object" && val !== null && "message" in val) {
          const item = { message: val.message };
          if (val.placeholders) {
            item.placeholders = val.placeholders;
          }
          stripped[key] = item;
        } else {
          stripped[key] = val;
        }
      }
      await writeFile(
        resolve(destFolder, "messages.json"),
        isWatch ? JSON.stringify(stripped, null, 2) : JSON.stringify(stripped)
      );
    }
  }
}

const entries = {
  background: "src/entrypoints/background/index.ts",
  popup: "src/entrypoints/popup/index.tsx",
  permission: "src/entrypoints/permission/index.ts",
  offscreen: "src/entrypoints/offscreen/index.ts",
  content: "src/entrypoints/content/interaction-collector.ts",
  "vue-devtools-hook-inject":
    "src/entrypoints/content/vue-devtools-hook-inject.ts",
  preview: "src/entrypoints/preview/index.ts",
  "report-template": "src/entrypoints/report/index.ts",
};

async function copyStaticAssets() {
  const manifestPath = resolve(root, "src/manifest.json");
  if (isE2e) {
    const raw = await readFile(manifestPath, "utf-8");
    const json = JSON.parse(raw);
    json.host_permissions = ["http://*/*", "https://*/*"];
    await writeFile(
      resolve(outdir, "manifest.json"),
      JSON.stringify(json, null, 2)
    );
  } else {
    await cp(manifestPath, resolve(outdir, "manifest.json"));
  }

  await cp(resolve(root, "src/icons"), resolve(outdir, "icons"), {
    recursive: true,
  });
  await copyLocales();

  for (const file of [
    "popup.html",
    "permission.html",
    "offscreen.html",
    "preview.html",
  ]) {
    await copyHtmlAsset(
      resolve(root, `src/entrypoints/${file.replace(".html", "")}/index.html`),
      resolve(outdir, file)
    );
  }
  await copyHtmlAsset(
    resolve(root, "src/entrypoints/report/index.html"),
    resolve(outdir, "report-template.html")
  );

  await copyCssAsset(
    resolve(root, "src/shared/styles/tokens.css"),
    resolve(outdir, "tokens.css")
  );
  await copyCssAsset(
    resolve(root, "src/entrypoints/report/static.css"),
    resolve(outdir, "report-static.css")
  );
  await copyCssAsset(
    resolve(root, "src/entrypoints/popup/styles/popup.css"),
    resolve(outdir, "popup.css")
  );

  await buildMergedPreviewCss();
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
      define: {
        "process.env.NODE_ENV": '"development"',
        "process.env.BUG_LENS_IS_E2E": JSON.stringify(isE2e),
      },
      plugins: [
        {
          name: "rebuild-notify",
          setup(build) {
            build.onEnd((result) => {
              const time = new Date().toLocaleTimeString();
              if (result.errors.length > 0) {
                console.error(
                  `[${time}] [watch] ${name}.js rebuild failed with errors.`
                );
              } else {
                console.log(`[${time}] [watch] ${name}.js rebuild complete.`);
                notifyReload();
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
  }

  watchFS(
    resolve(root, "src"),
    { recursive: true },
    async (eventType, filename) => {
      if (
        filename &&
        !filename.endsWith(".ts") &&
        !filename.endsWith(".tsx") &&
        !filename.endsWith(".js")
      ) {
        try {
          await copyStaticAssets();
          const time = new Date().toLocaleTimeString();
          console.log(`[${time}] [watch] Static assets updated (${filename}).`);
          notifyReload();
        } catch (e) {
          console.error("[watch] Error updating static assets:", e);
        }
      }
    }
  );

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
      minify: true,
      jsx: "automatic",
      jsxImportSource: "preact",
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.BUG_LENS_IS_E2E": JSON.stringify(isE2e),
      },
    });
  }
  await copyStaticAssets();
  console.log(
    `Built extension to ${outdir}${isE2e ? " (with E2E pre-granted host permissions)" : ""}`
  );
}
