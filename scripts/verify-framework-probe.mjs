#!/usr/bin/env node
/**
 * 独立验证脚本：不加载 Chrome 扩展、不依赖 Action Popup 与 macOS 辅助功能权限，
 * 直接用 Playwright Chromium + 把主世界探针打包成 IIFE 注入页面，复现采集端核心逻辑。
 *
 * 运行：npx tsx scripts/verify-framework-probe.mjs
 * 说明：脚本自身是纯 JS（.mjs），通过 tsx 运行时才能直接 import src 下的 .ts 模块
 *       （probeEntryToFrameworkSnapshot / findRelatedPortalOverlays）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { probeEntryToFrameworkSnapshot } from "../src/domain/framework-state-capture.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "e2e/fixtures/apps/dist");

const FRAMEWORKS = [
  { name: "vue2-dev", framework: "vue", expectedVersion: 2 },
  { name: "vue3-dev", framework: "vue", expectedVersion: 3 },
  { name: "react-dev", framework: "react", expectedVersion: 18 },
  { name: "react19-dev", framework: "react", expectedVersion: 19 },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** 最小静态服务器：只服务 e2e/fixtures/apps/dist 下的产物。 */
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname === "/" ? "/index.html" : pathname;
      const resolved = path.resolve(DIST, "." + relative);
      if (!resolved.startsWith(DIST + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(resolved).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404).end("Not Found");
        return;
      }
      const body = await readFile(resolved);
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(resolved)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

/** 把 TS 模块打包成 IIFE，并把指定导出挂到 window 上。 */
async function bundleToWindow({ entryFile, exportName, windowKey }) {
  const result = await build({
    stdin: {
      contents: [
        `import { ${exportName} } from ${JSON.stringify(entryFile)};`,
        `window[${JSON.stringify(windowKey)}] = ${exportName};`,
      ].join("\n"),
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`
  );
}
function info(label) {
  console.log(`      ${label}`);
}

async function main() {
  const probeScript = await bundleToWindow({
    entryFile: path.join(ROOT, "src/screenshot/probes/main-world-probe.ts"),
    exportName: "runMainWorldFrameworkProbe",
    windowKey: "__bugLensProbe",
  });
  let portalScript = null;
  let portalBuildError = null;
  try {
    portalScript = await bundleToWindow({
      entryFile: path.join(
        ROOT,
        "src/entrypoints/content/collector/dom-snapshot.ts"
      ),
      exportName: "findRelatedPortalOverlays",
      windowKey: "__bugLensFindPortalOverlays",
    });
  } catch (error) {
    portalBuildError = error;
  }

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const collected = [];

  try {
    for (const fw of FRAMEWORKS) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      try {
        await page.goto(`${origin}/${fw.name}/index.html`, {
          waitUntil: "load",
        });
        await page.waitForSelector('[data-testid="app-root"]', {
          timeout: 5000,
        });

        // 标记根容器与目标按钮，供主世界探针按 id 查找。
        await page.evaluate(() => {
          const root = document.querySelector("#app, #root");
          if (root) root.setAttribute("data-bug-lens-probe-id", "probe-root");
          const target = document.querySelector(
            '[data-testid="el-wrapper-btn"]'
          );
          if (target)
            target.setAttribute("data-bug-lens-probe-id", "probe-target");
        });
        await page.addScriptTag({ content: probeScript });

        const rootProbe = await page.evaluate(
          () => window.__bugLensProbe(["probe-root"])["probe-root"]
        );
        const rootSnapshot = rootProbe
          ? probeEntryToFrameworkSnapshot(rootProbe, "safe")
          : undefined;

        await page.click('[data-testid="el-wrapper-btn"]');
        await page.waitForTimeout(200);

        const entry = await page.evaluate(
          () => window.__bugLensProbe(["probe-target"])["probe-target"]
        );
        const snapshot = entry
          ? probeEntryToFrameworkSnapshot(entry, "safe")
          : undefined;
        const target = snapshot?.targetComponent;
        const version =
          target?.version ?? snapshot?.rootComponent?.version ?? 0;
        const parentChain = snapshot?.parentChain ?? [];

        const base = `${fw.name}`;
        const detail = `name=${JSON.stringify(
          target?.componentName ?? null
        )} version=${version} parents=[${parentChain
          .map((p) => p.componentName)
          .join(",")}]`;

        record(
          version === fw.expectedVersion,
          `${base} version`,
          `expected=${fw.expectedVersion} actual=${version} (${detail})`
        );
        record(
          Boolean(target?.componentName),
          `${base} targetComponent.componentName`,
          `actual=${JSON.stringify(target?.componentName ?? null)}`
        );
        record(
          parentChain.length >= 1,
          `${base} parentChain.length`,
          `actual=${parentChain.length} chain=[${parentChain
            .map((p) => p.componentName)
            .join(" > ")}] root=${JSON.stringify(
            snapshot?.rootComponent?.componentName ?? null
          )}`
        );

        if (fw.name === "react19-dev") {
          // fixture 是 esbuild 单文件 bundle：_debugStack 帧天然只含
          // .../react19-dev/bundle.js，不含真实源码模块路径。因此这里只验证
          // normalizeFilePath 已完成 URL → 相对路径的归一（无 scheme:// 前缀），
          // 不要求出现 src/。真实 Vite dev server 下的源码定位未在此 fixture 验证。
          const file = target?.componentFile ?? "";
          const hasUrlScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(file);
          record(
            file.length > 0 && !hasUrlScheme,
            "react19-dev componentFile 已剥离 URL 前缀",
            `actual=${JSON.stringify(file)}`
          );
          info(
            "react19-dev 说明：fixture 为 esbuild 单文件 bundle，_debugStack 只含 bundle 路径；" +
              "真实 Vite dev server 环境下的源码文件定位 = 未验证"
          );
        }

        info(
          `${base} rootSnapshot: rootComponent=${JSON.stringify(
            rootSnapshot?.rootComponent?.componentName ?? null
          )} target=${JSON.stringify(
            rootSnapshot?.targetComponent?.componentName ?? null
          )} parentChain.length=${rootSnapshot?.parentChain?.length ?? 0}`
        );
        if (pageErrors.length > 0) {
          info(`${base} pageerror: ${pageErrors.slice(0, 2).join(" | ")}`);
        }

        // Portal：仅对含 Teleport / createPortal 的 vue3-dev、react19-dev 做。
        let portalResult = null;
        if (
          portalScript &&
          (fw.name === "vue3-dev" || fw.name === "react19-dev")
        ) {
          await page.addScriptTag({ content: portalScript });
          await page.click('[data-testid="open-portal-btn"]');
          await page
            .waitForSelector('[data-testid="portal-dialog"]', { timeout: 3000 })
            .catch(() => undefined);
          portalResult = await page.evaluate(() => {
            const host = document.querySelector(
              '[data-testid="open-portal-btn"]'
            );
            const dialog = document.querySelector(
              "body > .el-dialog.portal-dialog"
            );
            const overlays = host
              ? window.__bugLensFindPortalOverlays(host)
              : [];
            const matched = dialog
              ? overlays.some(
                  (o) =>
                    Array.isArray(o.classNames) &&
                    o.classNames.includes("portal-dialog")
                )
              : false;
            return {
              dialogInBody: Boolean(dialog),
              overlayCount: overlays.length,
              relationReasons: overlays.map((o) => o.relationReason),
              matchedDialog: matched,
            };
          });
          record(
            portalResult.dialogInBody && portalResult.matchedDialog,
            `${base} portal 关联`,
            `dialogInBody=${portalResult.dialogInBody} overlays=${portalResult.overlayCount} reasons=[${portalResult.relationReasons.join(",")}]`
          );
        }

        collected.push({
          framework: fw.name,
          version,
          componentName: target?.componentName ?? null,
          parentChain: parentChain.map((p) => p.componentName),
          rootComponent: snapshot?.rootComponent?.componentName ?? null,
          componentFile: target?.componentFile ?? null,
          rootSnapshotShape: {
            rootComponent: rootSnapshot?.rootComponent?.componentName ?? null,
            parentChainLength: rootSnapshot?.parentChain?.length ?? 0,
          },
          portal: portalResult,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== 汇总 ===");
  for (const item of collected) {
    console.log(
      `${item.framework}: version=${item.version} componentName=${JSON.stringify(
        item.componentName
      )} parentChain=[${item.parentChain.join(" > ")}] root=${JSON.stringify(
        item.rootComponent
      )} file=${JSON.stringify(item.componentFile)}`
    );
  }
  if (portalBuildError) {
    console.log(`Portal 模块打包失败: ${portalBuildError.message}`);
  }
  const failed = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.warn);
  console.log(
    `\nTOTAL=${results.length} PASS=${
      results.length - failed.length
    } FAIL=${failed.length} WARN=${warned.length}`
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("运行失败:", error);
  process.exitCode = 1;
});
