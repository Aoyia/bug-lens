#!/usr/bin/env node
import esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sfc2 = require("vue2/compiler-sfc");
const sfc3 = require("vue/compiler-sfc");

const rootDir = process.cwd();
const appsDir = path.resolve(rootDir, "e2e/fixtures/apps");
const distDir = path.resolve(appsDir, "dist");

/**
 * Vue 2 SFC esbuild plugin
 */
function vue2Plugin({ isDev, appDir }) {
  return {
    name: "vue2-sfc",
    setup(build) {
      build.onResolve({ filter: /\.vue$/ }, (args) => {
        const resolvedPath = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(args.resolveDir, args.path);
        return { path: resolvedPath, namespace: "vue2" };
      });

      build.onLoad({ filter: /.*/, namespace: "vue2" }, async (args) => {
        const source = await fs.promises.readFile(args.path, "utf-8");
        const relativeFilename = path
          .relative(appDir, args.path)
          .replace(/\\/g, "/");

        const parsed = sfc2.parse({ source, filename: relativeFilename });
        const scriptBlock = parsed.script;
        const templateBlock = parsed.template;

        let scriptCode = "const __sfc_main = {};";
        if (scriptBlock && scriptBlock.content) {
          scriptCode = sfc2.rewriteDefault(scriptBlock.content, "__sfc_main");
        }

        let templateCode = "";
        if (templateBlock && templateBlock.content) {
          const compiled = sfc2.compileTemplate({
            source: templateBlock.content,
            filename: relativeFilename,
          });
          templateCode = `
${compiled.code}
__sfc_main.render = render;
__sfc_main.staticRenderFns = staticRenderFns;
`;
        }

        const fileAttachment = isDev
          ? `__sfc_main.__file = ${JSON.stringify(relativeFilename)};`
          : "";

        const code = `
${scriptCode}
${templateCode}
${fileAttachment}
export default __sfc_main;
`;

        return {
          contents: code,
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

/**
 * Vue 3 SFC esbuild plugin
 */
function vue3Plugin({ isDev, appDir }) {
  return {
    name: "vue3-sfc",
    setup(build) {
      build.onResolve({ filter: /\.vue$/ }, (args) => {
        const resolvedPath = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(args.resolveDir, args.path);
        return { path: resolvedPath, namespace: "vue3" };
      });

      build.onLoad({ filter: /.*/, namespace: "vue3" }, async (args) => {
        const source = await fs.promises.readFile(args.path, "utf-8");
        const relativeFilename = path
          .relative(appDir, args.path)
          .replace(/\\/g, "/");
        const scopeId = `data-v-${Buffer.from(relativeFilename).toString("hex").slice(0, 8)}`;

        const { descriptor } = sfc3.parse(source, {
          filename: relativeFilename,
        });

        let scriptContent = "export default {};";
        let bindings;

        if (descriptor.script || descriptor.scriptSetup) {
          const scriptBlock = sfc3.compileScript(descriptor, {
            id: scopeId,
            isProd: !isDev,
          });
          scriptContent = scriptBlock.content;
          bindings = scriptBlock.bindings;
        }

        const rewrittenScript = sfc3.rewriteDefault(
          scriptContent,
          "__sfc_main"
        );

        let templateCode = "";
        if (descriptor.template) {
          const compiled = sfc3.compileTemplate({
            id: scopeId,
            filename: relativeFilename,
            source: descriptor.template.content,
            compilerOptions: {
              bindingMetadata: bindings,
            },
          });
          templateCode = `
${compiled.code}
__sfc_main.render = render;
`;
        }

        const fileAttachment = isDev
          ? `__sfc_main.__file = ${JSON.stringify(relativeFilename)};`
          : "";

        const code = `
${rewrittenScript}
${templateCode}
${fileAttachment}
export default __sfc_main;
`;

        return {
          contents: code,
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

async function buildTarget(framework, mode) {
  const isDev = mode === "dev";
  const targetDirName = `${framework}-${mode}`;
  const outDir = path.resolve(distDir, targetDirName);
  await fs.promises.mkdir(outDir, { recursive: true });

  const appDir = path.resolve(appsDir, `${framework}-app`);
  const indexHtmlSrc = path.resolve(appDir, "index.html");
  const indexHtmlDest = path.resolve(outDir, "index.html");
  await fs.promises.copyFile(indexHtmlSrc, indexHtmlDest);

  if (framework === "vue2") {
    await esbuild.build({
      absWorkingDir: appDir,
      entryPoints: ["src/main.js"],
      outfile: path.resolve(outDir, "bundle.js"),
      bundle: true,
      format: "iife",
      minify: !isDev,
      sourcemap: isDev ? "inline" : false,
      tsconfigRaw: "{}",
      alias: {
        vue: "vue2",
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          isDev ? "development" : "production"
        ),
      },
      plugins: [vue2Plugin({ isDev, appDir })],
    });
  } else if (framework === "vue3") {
    await esbuild.build({
      absWorkingDir: appDir,
      entryPoints: ["src/main.js"],
      outfile: path.resolve(outDir, "bundle.js"),
      bundle: true,
      format: "iife",
      minify: !isDev,
      sourcemap: isDev ? "inline" : false,
      tsconfigRaw: "{}",
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          isDev ? "development" : "production"
        ),
        __VUE_OPTIONS_API__: "true",
        __VUE_PROD_DEVTOOLS__: isDev ? "true" : "false",
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
      },
      plugins: [vue3Plugin({ isDev, appDir })],
    });
  } else if (framework === "react") {
    await esbuild.build({
      absWorkingDir: appDir,
      entryPoints: ["src/main.jsx"],
      outfile: path.resolve(outDir, "bundle.js"),
      bundle: true,
      format: "iife",
      jsx: "automatic",
      jsxDev: isDev,
      minify: !isDev,
      sourcemap: isDev ? "inline" : false,
      tsconfigRaw: {
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "react18",
        },
      },
      alias: {
        react: "react18",
        "react-dom": "react-dom18",
        "react/jsx-dev-runtime": "react18/jsx-dev-runtime",
        "react/jsx-runtime": "react18/jsx-runtime",
        "react-dom/client": "react-dom18/client",
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          isDev ? "development" : "production"
        ),
      },
    });
  }
}

async function main() {
  const startTime = performance.now();
  console.log("[build-fixture-apps] Starting dual-mode fixture apps build...");

  await fs.promises.mkdir(distDir, { recursive: true });

  const tasks = [
    buildTarget("vue2", "dev"),
    buildTarget("vue2", "prod"),
    buildTarget("vue3", "dev"),
    buildTarget("vue3", "prod"),
    buildTarget("react", "dev"),
    buildTarget("react", "prod"),
  ];

  await Promise.all(tasks);

  const durationMs = Math.round(performance.now() - startTime);
  console.log(
    `[build-fixture-apps] Successfully built 6 fixture targets in ${durationMs}ms.`
  );
}

main().catch((err) => {
  console.error("[build-fixture-apps] Build failed:", err);
  process.exit(1);
});
