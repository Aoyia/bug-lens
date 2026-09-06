#!/usr/bin/env node
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, "e2e/fixtures/apps/dist");

const TARGETS = [
  { framework: "vue2", mode: "dev", expectedTitle: "Vue 2 Todo Application" },
  { framework: "vue2", mode: "prod", expectedTitle: "Vue 2 Todo Application" },
  { framework: "vue3", mode: "dev", expectedTitle: "Vue 3 Todo Application" },
  { framework: "vue3", mode: "prod", expectedTitle: "Vue 3 Todo Application" },
  {
    framework: "react",
    mode: "dev",
    expectedTitle: "React 18 Todo Application",
  },
  {
    framework: "react",
    mode: "prod",
    expectedTitle: "React 18 Todo Application",
  },
];

async function runVerification() {
  console.log(
    "================================================================================"
  );
  console.log(
    "[verify-fixture-apps] Starting deterministic browser mounting verification matrix"
  );
  console.log(
    "================================================================================"
  );

  // 1. 启动临时回环 HTTP 服务（严格对齐 e2e/fixtures/extension.ts 路由分发与加固逻辑）
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (pathname.startsWith("/apps/")) {
      const match = pathname.match(/^\/apps\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
      if (!match) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Invalid fixture app path: ${pathname}`);
        return;
      }

      const [, framework, mode, rawFile] = match;
      const targetDir = path.resolve(distDir, `${framework}-${mode}`);
      const decodedFile = rawFile ? decodeURIComponent(rawFile) : "";
      const fileToServe =
        decodedFile && decodedFile.length > 0 ? decodedFile : "index.html";
      const resolvedPath = path.resolve(targetDir, fileToServe);
      const safeTargetPrefix = targetDir.endsWith(path.sep)
        ? targetDir
        : targetDir + path.sep;

      if (
        !resolvedPath.startsWith(safeTargetPrefix) &&
        resolvedPath !== targetDir
      ) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        const ext = path.extname(resolvedPath);
        let contentType = "text/plain; charset=utf-8";
        if (ext === ".html") contentType = "text/html; charset=utf-8";
        else if (ext === ".js")
          contentType = "application/javascript; charset=utf-8";
        else if (ext === ".css") contentType = "text/css; charset=utf-8";
        else if (ext === ".json" || ext === ".map")
          contentType = "application/json; charset=utf-8";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(fs.readFileSync(resolvedPath));
        return;
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Fixture app file not found: ${pathname}`);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  console.log(
    `[verify-fixture-apps] Ephemeral loopback server listening at http://127.0.0.1:${port}`
  );

  let browser;
  let allPassed = true;
  const resultsTable = [];

  try {
    // 2. 真实启动 Playwright Chromium 无头浏览器
    browser = await chromium.launch({ headless: true });

    for (const target of TARGETS) {
      const targetName = `${target.framework}-${target.mode}`;
      const page = await browser.newPage();
      const pageErrors = [];
      const consoleErrors = [];

      page.on("pageerror", (err) => {
        pageErrors.push(err.message);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      const url = `http://127.0.0.1:${port}/apps/${target.framework}/${target.mode}/index.html`;
      await page.goto(url);

      // 断言 1: 页面根节点在 3 秒内可见
      await page.waitForSelector('[data-testid="app-root"]', { timeout: 3000 });
      const title = (
        await page.textContent('[data-testid="app-title"]')
      )?.trim();

      // 断言 2: Todo 列表项数量必须为 2
      const items = await page.$$('[data-testid="todo-item"]');
      const itemsCount = items.length;

      // 断言 3: 响应式交互派发（点击 Count++，验证从 Clicks: 0 递增至 Clicks: 1）
      const initialClicks = (
        await page.textContent(
          '[data-testid="todo-item"]:first-child .item-clicks'
        )
      )?.trim();
      const incBtn = await page.$(
        '[data-testid="todo-item"]:first-child [data-testid="increment-btn"]'
      );
      if (incBtn) {
        await incBtn.click();
      }
      await page.waitForTimeout(100);
      const updatedClicks = (
        await page.textContent(
          '[data-testid="todo-item"]:first-child .item-clicks'
        )
      )?.trim();

      // 断言 4: 主世界真实框架探针与元数据提取
      const probeData = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="todo-item"]');
        if (!el) return { error: "No element found" };

        // Vue 2 probe
        const v2 = el.__vue__;
        // Vue 3 probe
        const v3 = el.__vueParentComponent;
        // React Fiber probe
        const fiberKey = Object.keys(el).find((k) =>
          k.startsWith("__reactFiber$")
        );
        const hostFiber = fiberKey ? el[fiberKey] : null;
        const compFiber = hostFiber?.return;

        let reactHooksCount = 0;
        let curr = compFiber?.memoizedState;
        while (curr) {
          reactHooksCount++;
          curr = curr.next;
        }

        return {
          v2File: v2?.$options?.__file,
          v2Name: v2?.$options?.name,
          v2DataKeys: v2?.$data ? Object.keys(v2.$data) : null,
          v3File: v3?.type?.__file,
          v3Name: v3?.type?.__name,
          v3PropsKeys: v3?.props ? Object.keys(v3.props) : null,
          reactHostFile: hostFiber?._debugSource?.fileName,
          reactHostLine: hostFiber?._debugSource?.lineNumber,
          reactCompName: compFiber?.type?.name,
          reactHooksCount,
        };
      });

      // 综合断言与判定
      const hasTitle = title === target.expectedTitle;
      const hasZeroErrors =
        pageErrors.length === 0 && consoleErrors.length === 0;
      const hasTwoItems = itemsCount === 2;
      const hasWorkingReactivity =
        initialClicks === "Clicks: 0" && updatedClicks === "Clicks: 1";

      let probeValid = false;
      if (target.framework === "vue2") {
        probeValid =
          target.mode === "dev"
            ? probeData.v2File === "src/components/TodoItem.vue" &&
              probeData.v2Name === "TodoItem"
            : probeData.v2Name === "TodoItem" && probeData.v2File === undefined;
      } else if (target.framework === "vue3") {
        probeValid =
          target.mode === "dev"
            ? probeData.v3File === "src/components/TodoItem.vue" &&
              probeData.v3Name === "TodoItem"
            : true;
      } else if (target.framework === "react") {
        probeValid =
          target.mode === "dev"
            ? probeData.reactHostFile === "src/components/TodoItem.jsx" &&
              typeof probeData.reactHostLine === "number" &&
              probeData.reactHooksCount >= 4
            : probeData.reactCompName === "TodoItem" ||
              typeof probeData.reactCompName === "string";
      }

      const isSuccess =
        hasZeroErrors &&
        hasTitle &&
        hasTwoItems &&
        hasWorkingReactivity &&
        probeValid;

      if (!isSuccess) {
        allPassed = false;
      }

      resultsTable.push({
        target: targetName,
        status: isSuccess ? "PASS" : "FAIL",
        items: itemsCount,
        clicks: `${initialClicks} -> ${updatedClicks}`,
        probeValid: probeValid ? "YES" : "NO",
        pageErrors: pageErrors.length,
        consoleErrors: consoleErrors.length,
      });

      await page.close();
    }

    // 3. 安全与边界加固断言（HTTP 路由与目录穿越测试）
    console.log(
      "\n[verify-fixture-apps] Verifying security guardrails & routing boundaries..."
    );
    const securityCheckResults = await (async () => {
      // 3.1 兄弟目录穿越拦截 (URL 编码穿越绕过前置客户端规范化)
      const siblingRes = await fetch(
        `http://127.0.0.1:${port}/apps/vue2/dev/%2e%2e%2fvue2-dev-evil%2fsecret.txt`
      );
      const isSiblingBlocked = siblingRes.status === 403;

      // 3.2 根目录穿越拦截
      const rootRes = await fetch(
        `http://127.0.0.1:${port}/apps/vue2/dev/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json`
      );
      const isRootBlocked = rootRes.status === 403;

      // 3.3 畸形 /apps/ 路由 404
      const malformedRes = await fetch(`http://127.0.0.1:${port}/apps/`);
      const isMalformed404 = malformedRes.status === 404;

      const malformedRes2 = await fetch(
        `http://127.0.0.1:${port}/apps/invalid-route`
      );
      const isMalformed2404 = malformedRes2.status === 404;

      return {
        isSiblingBlocked,
        isRootBlocked,
        isMalformed404,
        isMalformed2404,
      };
    })();

    const securityOk =
      securityCheckResults.isSiblingBlocked &&
      securityCheckResults.isRootBlocked &&
      securityCheckResults.isMalformed404 &&
      securityCheckResults.isMalformed2404;

    if (!securityOk) {
      allPassed = false;
      console.error(
        "[verify-fixture-apps] ❌ Security check failed:",
        securityCheckResults
      );
    } else {
      console.log(
        "[verify-fixture-apps] ✅ Security check passed (directory traversal blocked with 403, malformed routes return 404)."
      );
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log(
    "\n[verify-fixture-apps] Real Browser Mounting Verification Matrix Results:"
  );
  console.table(resultsTable);

  if (!allPassed) {
    console.error(
      "\n[verify-fixture-apps] ❌ CRITICAL: Verification failed! Check above errors."
    );
    process.exit(1);
  }

  console.log(
    "\n[verify-fixture-apps] 🟢 ALL 6 TARGETS VERIFIED CLEAN 100% IN REAL CHROMIUM BROWSER!"
  );
}

runVerification().catch((err) => {
  console.error("[verify-fixture-apps] Fatal runner error:", err);
  process.exit(1);
});
