import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "@playwright/test";
import {
  buildEvidencePackage,
  type EvidencePackageSnapshot,
} from "../src/preview/evidence-package.ts";

const WORKSPACE_SPLIT_STORAGE_KEY = "bug-lens-workspace-split-ratio";

async function seedPreviewSession(
  page: Page,
  extensionId: string,
  sessionId: string
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/preview.html`);
  await page.waitForLoadState("domcontentloaded");

  await page.evaluate(async (id: string) => {
    // 生成一小段真实可播放的 WebM 视频分片，确保左侧 <video> 区域真实挂载可见
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#165dff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "16px sans-serif";
      ctx.fillText("Bug Lens E2E Video", 48, 96);
    }

    const stream = canvas.captureStream(10);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const recordedBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: mimeType });
          resolve(await blob.arrayBuffer());
        } catch (err) {
          reject(err);
        }
      };
      recorder.onerror = (err) => reject(err);
      recorder.start();
      setTimeout(() => {
        if (ctx) {
          ctx.fillStyle = "#00b42a";
          ctx.fillRect(10, 10, 20, 20);
        }
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      }, 180);
    });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("web-bug-recorder", 7);
      req.onupgradeneeded = () => {
        const database = req.result;
        const tx = req.transaction!;
        const ensureStore = (
          name: string,
          keyPath: string,
          indexes: Array<{ name: string; keyPath: string | string[] }> = []
        ) => {
          const store = database.objectStoreNames.contains(name)
            ? tx.objectStore(name)
            : database.createObjectStore(name, { keyPath });
          for (const index of indexes) {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath);
            }
          }
        };
        ensureStore("control", "key");
        ensureStore("sessions", "id", [{ name: "status", keyPath: "status" }]);
        ensureStore("interactions", "id", [
          { name: "sessionId", keyPath: "sessionId" },
        ]);
        ensureStore("consoleEntries", "id", [
          { name: "sessionId", keyPath: "sessionId" },
        ]);
        ensureStore("networkEntries", "id", [
          { name: "sessionId", keyPath: "sessionId" },
        ]);
        ensureStore("mediaChunks", "id", [
          { name: "sessionId", keyPath: "sessionId" },
          { name: "sessionIdSequence", keyPath: ["sessionId", "sequence"] },
        ]);
        ensureStore("exportSelections", "sessionId");
        ensureStore("exportArtifacts", "sessionId");
        ensureStore("issueScenes", "id", [
          { name: "sessionId", keyPath: "sessionId" },
          {
            name: "sessionIdObservedAt",
            keyPath: ["sessionId", "observedAtEpochMs"],
          },
        ]);
        ensureStore("evidenceAssets", "id", [
          { name: "sessionId", keyPath: "sessionId" },
          { name: "issueSceneId", keyPath: "issueSceneId" },
        ]);
        ensureStore("frameworkStates", "id", [
          { name: "sessionId", keyPath: "sessionId" },
          {
            name: "sessionIdCapturedAt",
            keyPath: ["sessionId", "capturedAtEpochMs"],
          },
        ]);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const now = Date.now();
    const session = {
      id,
      schemaVersion: 2,
      extensionVersion: "0.0.0",
      status: "PREVIEW_READY",
      target: {
        tabId: 1,
        initialUrl: "http://127.0.0.1/resizer-e2e",
        initialTitle: "Workspace Resizer E2E Session",
      },
      options: {
        captureVideo: true,
        captureAudio: false,
        captureScreenshots: true,
        captureConsole: true,
        captureNetwork: true,
        privacyMode: "safe",
      },
      timeline: {
        createdAtEpochMs: now - 5000,
        startedAtEpochMs: now - 4000,
        stoppedAtEpochMs: now - 1000,
        durationMs: 3000,
      },
      quality: {
        videoStatus: "captured",
        screenshotStatus: "captured",
        interactionCount: 1,
        confirmedInteractionCount: 1,
        primaryScreenshotCount: 0,
        fallbackScreenshotCount: 0,
        unavailableScreenshotCount: 1,
        consoleEntryCount: 1,
        networkEntryCount: 1,
        overall: "complete",
        issues: [],
      },
      nonce: "e2e-resizer-nonce",
    };

    const interaction = {
      id: `${id}-step-1`,
      sessionId: id,
      kind: "click",
      status: "confirmed",
      createdAt: now - 3000,
      confirmedAt: now - 2950,
      page: {
        url: "http://127.0.0.1/resizer-e2e",
        title: "Workspace Resizer E2E Session",
        frameId: 0,
      },
      input: {
        pointerType: "mouse",
        button: 0,
        isTrusted: true,
      },
      coordinates: {
        clientX: 120,
        clientY: 200,
        pageX: 120,
        pageY: 200,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 1280, height: 800 },
      },
      element: {
        tagName: "button",
        classNames: ["primary"],
        attributes: { "data-testid": "trigger-btn" },
        text: "Trigger Action",
        boundingBox: { x: 100, y: 180, width: 120, height: 36 },
        locators: [
          {
            kind: "css",
            expression: '[data-testid="trigger-btn"]',
            matchCount: 1,
            stabilityScore: 0.95,
            reasons: ["data-testid"],
          },
        ],
      },
      screenshot: { status: "unavailable" },
    };

    const consoleEntry = {
      id: `${id}-console-1`,
      sessionId: id,
      createdAt: now - 2500,
      level: "error",
      args: [{ type: "string", valuePreview: "Resizer E2E Console Error" }],
      text: "Resizer E2E Console Error",
    };

    const networkEntry = {
      id: `${id}-net-1`,
      sessionId: id,
      createdAt: now - 2000,
      method: "GET",
      url: "http://127.0.0.1/api/resizer-check",
      status: 200,
      durationMs: 24,
    };

    const mediaChunk = {
      id: `${id}-chunk-0`,
      sessionId: id,
      sequence: 0,
      recordedAt: now - 3500,
      mimeType,
      chunk: recordedBuffer,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [
          "sessions",
          "interactions",
          "consoleEntries",
          "networkEntries",
          "mediaChunks",
        ],
        "readwrite"
      );
      tx.objectStore("sessions").put(session);
      tx.objectStore("interactions").put(interaction);
      tx.objectStore("consoleEntries").put(consoleEntry);
      tx.objectStore("networkEntries").put(networkEntry);
      tx.objectStore("mediaChunks").put(mediaChunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    db.close();
    localStorage.removeItem("bug-lens-workspace-split-ratio");
  }, sessionId);
}

async function getPanelMetrics(page: Page) {
  return page.evaluate(() => {
    const workspace = document.querySelector(".zen-workspace") as HTMLElement;
    const left = document.querySelector(".zen-left-panel") as HTMLElement;
    const right = document.querySelector(".zen-right-panel") as HTMLElement;
    const resizer = document.querySelector("#workspace-resizer") as HTMLElement;
    const workspaceRect = workspace.getBoundingClientRect();
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const resizerRect = resizer.getBoundingClientRect();
    return {
      workspaceWidth: workspaceRect.width,
      workspaceScrollWidth: workspace.scrollWidth,
      workspaceClientWidth: workspace.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      leftWidth: leftRect.width,
      leftHeight: leftRect.height,
      leftX: leftRect.x,
      leftY: leftRect.y,
      rightWidth: rightRect.width,
      rightHeight: rightRect.height,
      rightX: rightRect.x,
      rightY: rightRect.y,
      resizerWidth: resizerRect.width,
      hasResizedClass: workspace.classList.contains("zen-workspace--resized"),
      inlineLeftVar: workspace.style.getPropertyValue("--zen-workspace-left"),
      ariaValueNow: resizer.getAttribute("aria-valuenow"),
      storedRatio: localStorage.getItem("bug-lens-workspace-split-ratio"),
    };
  });
}

async function dragResizerToX(
  page: Page,
  resizer: Locator,
  targetX: number
): Promise<void> {
  const box = await resizer.boundingBox();
  expect(box).toBeTruthy();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, startY, { steps: 12 });
  await page.mouse.up();
}

async function startStaticDirServer(
  rootDir: string
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const reqPath = new URL(
      req.url || "/",
      `http://${req.headers.host || "127.0.0.1"}`
    ).pathname;
    if (reqPath === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const relPath =
      reqPath === "/" ? "report.html" : reqPath.replace(/^\/+/, "");
    const resolved = path.resolve(rootDir, relPath);
    if (
      !resolved.startsWith(rootDir + path.sep) &&
      resolved !== path.resolve(rootDir, "report.html")
    ) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(resolved);
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".png"
              ? "image/png"
              : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(fs.readFileSync(resolved));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test.describe("Preview & Offline Report Workspace Resizer E2E", () => {
  test("场景 1: Preview 工作区左右拖拽分隔栏交互、边界钳制、持久化、双击重置、键盘无障碍与窄屏堆叠", async ({
    context,
    extensionId,
  }) => {
    const sessionId = `resizer-e2e-${Date.now()}`;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await seedPreviewSession(page, extensionId, sessionId);
    await page.goto(
      `chrome-extension://${extensionId}/preview.html?sessionId=${sessionId}`
    );
    await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await page.waitForSelector("#workspace-resizer", { timeout: 5_000 });

    const video = page.locator("#video");
    await expect(video).toBeVisible({ timeout: 10_000 });

    const resizer = page.locator("#workspace-resizer");
    await expect(resizer).toBeVisible();
    await expect(resizer).toHaveAttribute("role", "separator");
    await expect(resizer).toHaveAttribute("aria-orientation", "vertical");
    await expect(resizer).toHaveAttribute("aria-valuemin", "20");
    await expect(resizer).toHaveAttribute("aria-valuemax", "80");

    // 校验 1280x800 下默认比例（@media max-width: 1440px -> 44fr : 56fr）
    const initial = await getPanelMetrics(page);
    expect(initial.hasResizedClass).toBe(false);
    expect(initial.resizerWidth).toBe(5);
    expect(initial.leftWidth).toBeGreaterThan(520);
    expect(initial.rightWidth).toBeGreaterThan(680);
    expect(initial.rightWidth).toBeGreaterThan(initial.leftWidth);
    expect(initial.docScrollWidth).toBeLessThanOrEqual(initial.docClientWidth);

    // 1. 真实鼠标向右拖拽
    const resizerBox1 = await resizer.boundingBox();
    expect(resizerBox1).toBeTruthy();
    await dragResizerToX(page, resizer, resizerBox1!.x + 180);

    const afterRightDrag = await getPanelMetrics(page);
    expect(afterRightDrag.hasResizedClass).toBe(true);
    expect(afterRightDrag.leftWidth).toBeGreaterThan(initial.leftWidth + 140);
    expect(afterRightDrag.rightWidth).toBeLessThan(initial.rightWidth - 140);
    expect(afterRightDrag.storedRatio).toBeTruthy();

    // 2. 真实鼠标向左拖拽（直接拖向 .zen-left-panel 视频区域之上）
    const videoBox = await video.boundingBox();
    expect(videoBox).toBeTruthy();
    const targetOverVideoX = videoBox!.x + videoBox!.width * 0.6;
    await dragResizerToX(page, resizer, targetOverVideoX);

    const afterLeftDragOverVideo = await getPanelMetrics(page);
    expect(afterLeftDragOverVideo.leftWidth).toBeLessThan(
      afterRightDrag.leftWidth - 120
    );
    expect(afterLeftDragOverVideo.rightWidth).toBeGreaterThan(
      afterRightDrag.rightWidth + 120
    );

    // 3. 边界钳制：拖到极左与极右
    await dragResizerToX(page, resizer, 10);
    const atExtremeLeft = await getPanelMetrics(page);
    expect(atExtremeLeft.leftWidth).toBeGreaterThanOrEqual(259);
    expect(atExtremeLeft.leftWidth).toBeLessThanOrEqual(265);
    expect(atExtremeLeft.rightWidth).toBeGreaterThanOrEqual(319);
    expect(atExtremeLeft.workspaceScrollWidth).toBeLessThanOrEqual(
      atExtremeLeft.workspaceClientWidth
    );
    expect(atExtremeLeft.docScrollWidth).toBeLessThanOrEqual(
      atExtremeLeft.docClientWidth
    );

    await dragResizerToX(page, resizer, 1270);
    const atExtremeRight = await getPanelMetrics(page);
    expect(atExtremeRight.leftWidth).toBeGreaterThanOrEqual(259);
    expect(atExtremeRight.rightWidth).toBeGreaterThanOrEqual(319);
    expect(atExtremeRight.rightWidth).toBeLessThanOrEqual(325);
    expect(atExtremeRight.workspaceScrollWidth).toBeLessThanOrEqual(
      atExtremeRight.workspaceClientWidth
    );
    expect(atExtremeRight.docScrollWidth).toBeLessThanOrEqual(
      atExtremeRight.docClientWidth
    );

    // 校验 1440x900 视口下无溢出且极右/极左边界有效
    await page.setViewportSize({ width: 1440, height: 900 });
    await dragResizerToX(page, resizer, 1430);
    const at1440Right = await getPanelMetrics(page);
    expect(at1440Right.rightWidth).toBeGreaterThanOrEqual(319);
    expect(at1440Right.workspaceScrollWidth).toBeLessThanOrEqual(
      at1440Right.workspaceClientWidth
    );
    expect(at1440Right.docScrollWidth).toBeLessThanOrEqual(
      at1440Right.docClientWidth
    );

    // 切回 1280x800，拖拽到一个明确中间比例并测试刷新持久化
    await page.setViewportSize({ width: 1280, height: 800 });
    await dragResizerToX(page, resizer, 700);
    const beforeReload = await getPanelMetrics(page);
    expect(beforeReload.hasResizedClass).toBe(true);
    expect(beforeReload.leftWidth).toBeGreaterThan(680);
    expect(beforeReload.leftWidth).toBeLessThan(720);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".zen-workspace.zen-workspace--resized", {
      timeout: 5_000,
    });
    const afterReload = await getPanelMetrics(page);
    expect(afterReload.hasResizedClass).toBe(true);
    expect(
      Math.abs(afterReload.leftWidth - beforeReload.leftWidth)
    ).toBeLessThanOrEqual(2);
    expect(afterReload.storedRatio).toBe(beforeReload.storedRatio);

    // 5. 双击分隔栏恢复默认宽度比例并移除 zen-workspace--resized 类
    await resizer.dblclick();
    await expect(page.locator(".zen-workspace")).not.toHaveClass(
      /zen-workspace--resized/
    );
    const afterDblClick = await getPanelMetrics(page);
    expect(afterDblClick.hasResizedClass).toBe(false);
    expect(afterDblClick.inlineLeftVar).toBe("");
    expect(afterDblClick.ariaValueNow).toBe("38");
    expect(afterDblClick.storedRatio).toBeNull();
    expect(
      Math.abs(afterDblClick.leftWidth - initial.leftWidth)
    ).toBeLessThanOrEqual(2);

    // 6. 键盘无障碍：ArrowRight / ArrowLeft
    await resizer.focus();
    await page.keyboard.press("ArrowRight");
    const afterArrowRight = await getPanelMetrics(page);
    expect(afterArrowRight.hasResizedClass).toBe(true);
    expect(afterArrowRight.leftWidth).toBeGreaterThan(afterDblClick.leftWidth);
    expect(Number(afterArrowRight.ariaValueNow)).toBeGreaterThan(
      Number(afterDblClick.ariaValueNow)
    );

    await page.keyboard.press("ArrowRight");
    const afterSecondArrowRight = await getPanelMetrics(page);
    expect(afterSecondArrowRight.leftWidth).toBeGreaterThan(
      afterArrowRight.leftWidth
    );

    await page.keyboard.press("ArrowLeft");
    const afterArrowLeft = await getPanelMetrics(page);
    expect(afterArrowLeft.leftWidth).toBeLessThan(
      afterSecondArrowRight.leftWidth
    );
    expect(Number(afterArrowLeft.ariaValueNow)).toBeLessThan(
      Number(afterSecondArrowRight.ariaValueNow)
    );

    // 7. 窄屏响应式：切到 1024x768（<= 1100px），即使刚拖拽/调整过也自动隐藏分隔栏并回归单列堆叠
    expect(afterArrowLeft.hasResizedClass).toBe(true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(resizer).toBeHidden();
    const atNarrow = await getPanelMetrics(page);
    expect(
      Math.abs(atNarrow.leftWidth - atNarrow.rightWidth)
    ).toBeLessThanOrEqual(2);
    expect(atNarrow.leftWidth).toBeGreaterThan(1000);
    expect(atNarrow.rightY).toBeGreaterThanOrEqual(
      atNarrow.leftY + atNarrow.leftHeight - 1
    );
    expect(atNarrow.docScrollWidth).toBeLessThanOrEqual(1024);

    // 清理 localStorage 并断言无页面错误
    await page.evaluate((key: string) => {
      localStorage.removeItem(key);
    }, WORKSPACE_SPLIT_STORAGE_KEY);
    expect(pageErrors).toEqual([]);
  });

  test("场景 2: 离线报告 (buildEvidencePackage) 在 file:// 与 http:// 严格 CSP 下的 i18n 渲染、0 CSP 报错与分隔栏拖拽重置", async ({
    context,
  }) => {
    const distDir = path.resolve(process.cwd(), "dist");
    const reportHtmlTemplate = fs.readFileSync(
      path.join(distDir, "report-template.html"),
      "utf-8"
    );
    const previewCss = fs.readFileSync(
      path.join(distDir, "preview.css"),
      "utf-8"
    );
    const reportStaticCss = fs.readFileSync(
      path.join(distDir, "report-static.css"),
      "utf-8"
    );
    const reportJs = fs.readFileSync(
      path.join(distDir, "report-template.js"),
      "utf-8"
    );
    const iconPng = fs.readFileSync(
      path.join(distDir, "icons/icon_idle_32.png")
    );
    const localeMessages = JSON.parse(
      fs.readFileSync(
        path.join(distDir, "_locales/zh_CN/messages.json"),
        "utf-8"
      )
    ) as Record<string, { message: string }>;

    const tmpReportDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "bug-lens-offline-resizer-")
    );

    const now = Date.now();
    const snapshot: EvidencePackageSnapshot = {
      session: {
        id: "offline-resizer-session",
        schemaVersion: 2,
        extensionVersion: "0.0.0",
        status: "PREVIEW_READY",
        target: {
          tabId: 1,
          initialUrl: "http://127.0.0.1/offline-report-test",
          initialTitle: "Offline Report Resizer E2E",
        },
        options: {
          captureVideo: false,
          captureAudio: false,
          captureScreenshots: false,
          captureConsole: true,
          captureNetwork: true,
          captureNetworkBodies: true,
          privacyMode: "safe",
          mediaTimesliceMs: 1_000,
          maxResponseBodyBytes: 1_000_000,
          maxSessionBytes: 10_000_000,
        },
        timeline: {
          createdAtEpochMs: now - 3000,
          startedAtEpochMs: now - 2500,
          stoppedAtEpochMs: now - 500,
          durationMs: 2000,
        },
        quality: {
          interactionCount: 1,
          confirmedInteractionCount: 1,
          primaryScreenshotCount: 0,
          fallbackScreenshotCount: 0,
          unavailableScreenshotCount: 1,
          consoleEntryCount: 1,
          networkEntryCount: 0,
          overall: "complete",
          issues: [],
        },
        nonce: "offline-nonce",
      },
      interactions: [
        {
          id: "offline-step-1",
          sessionId: "offline-resizer-session",
          kind: "click",
          status: "confirmed",
          createdAt: now - 1800,
          confirmedAt: now - 1750,
          page: {
            url: "http://127.0.0.1/offline-report-test",
            title: "Offline Report Resizer E2E",
            frameId: 0,
          },
          input: {
            pointerType: "mouse",
            button: 0,
            isTrusted: true,
          },
          coordinates: {
            clientX: 120,
            clientY: 200,
            pageX: 120,
            pageY: 200,
            scrollX: 0,
            scrollY: 0,
            devicePixelRatio: 1,
            viewport: { width: 1280, height: 800 },
          },
          element: {
            tagName: "button",
            id: "submit-btn",
            classNames: ["primary"],
            attributes: { id: "submit-btn" },
            text: "Submit",
            boundingBox: { x: 100, y: 180, width: 100, height: 36 },
            locators: [
              {
                kind: "css",
                expression: "#submit-btn",
                matchCount: 1,
                stabilityScore: 0.95,
                reasons: ["id"],
              },
            ],
          },
          screenshot: { status: "unavailable" },
        },
      ],
      consoleEntries: [
        {
          id: "offline-console-1",
          sessionId: "offline-resizer-session",
          createdAt: now - 1500,
          level: "error",
          args: [
            { type: "string", valuePreview: "Offline report error sample" },
          ],
          text: "Offline report error sample",
        },
      ],
      networkEntries: [],
      issueScenes: [],
      frameworkStates: [],
      excluded: { interaction: 0, console: 0, network: 0 },
      hasMedia: false,
    };

    let serverControl:
      { baseUrl: string; close: () => Promise<void> } | undefined;

    try {
      const packageFiles = buildEvidencePackage(snapshot, {
        html: reportHtmlTemplate,
        script: reportJs,
        styles: `${previewCss}\n${reportStaticCss}`,
        icon: iconPng,
        localeMessages,
      });

      for (const file of packageFiles) {
        const outPath = path.join(tmpReportDir, file.name);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, file.data);
      }

      const generatedHtml = fs.readFileSync(
        path.join(tmpReportDir, "report.html"),
        "utf-8"
      );
      expect(generatedHtml).toContain(
        '<script src="assets/i18n-data.js"></script>'
      );
      expect(generatedHtml).toContain(
        '<script src="data/session-data.js"></script>'
      );
      expect(generatedHtml).toContain(
        '<script src="data/network-details.js"></script>'
      );
      expect(
        /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(
          generatedHtml
        )
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tmpReportDir, "assets/i18n-data.js"))
      ).toBe(true);

      serverControl = await startStaticDirServer(tmpReportDir);
      const reportFileUrl = pathToFileURL(
        path.join(tmpReportDir, "report.html")
      ).href;

      const verifyOfflineReportPage = async (targetUrl: string) => {
        const page = await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });

        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        try {
          await page.goto(targetUrl);
          await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
          await expect(page.locator("#title")).toContainText(
            "Offline Report Resizer E2E"
          );

          // 1. 验证外链 i18n-data.js 成功加载，且动态文案真实渲染中文而非 raw key
          const loadedI18n = await page.evaluate(
            () => (window as any).__WEB_BUG_REPORT_I18N__
          );
          expect(loadedI18n).toBeTruthy();
          expect(loadedI18n.locale).toBe("zh-CN");
          expect(loadedI18n.dict?.metricSteps?.message).toBe("有效步骤");

          const metricsText = await page.locator("#metrics").innerText();
          expect(metricsText).toContain("有效步骤");
          expect(metricsText).toContain("步骤截图");
          expect(metricsText).not.toContain("metricSteps");
          expect(metricsText).not.toContain("metricScreenshots");

          // 验证 <truncated-text> 使用 Constructable Stylesheets 而非内联 <style>
          const truncatedShadowInfo = await page.evaluate(() => {
            const el = document.querySelector("#meta");
            const shadow = el?.shadowRoot;
            return {
              hasShadow: Boolean(shadow),
              adoptedCount: shadow?.adoptedStyleSheets?.length ?? 0,
              inlineStyleCount: shadow?.querySelectorAll("style").length ?? -1,
            };
          });
          expect(truncatedShadowInfo.hasShadow).toBe(true);
          expect(truncatedShadowInfo.adoptedCount).toBeGreaterThan(0);
          expect(truncatedShadowInfo.inlineStyleCount).toBe(0);

          // 2. 验证分隔栏拖拽与双击重置
          const resizer = page.locator("#workspace-resizer");
          await expect(resizer).toBeVisible();
          await expect(resizer).toHaveAttribute("role", "separator");

          const initial = await getPanelMetrics(page);
          expect(initial.hasResizedClass).toBe(false);
          expect(initial.docScrollWidth).toBeLessThanOrEqual(
            initial.docClientWidth
          );

          // 向右拖拽
          const box = await resizer.boundingBox();
          expect(box).toBeTruthy();
          await dragResizerToX(page, resizer, box!.x + 160);

          const afterRightDrag = await getPanelMetrics(page);
          expect(afterRightDrag.hasResizedClass).toBe(true);
          expect(afterRightDrag.leftWidth).toBeGreaterThan(
            initial.leftWidth + 120
          );
          expect(afterRightDrag.rightWidth).toBeLessThan(
            initial.rightWidth - 120
          );

          // 向左拖拽（拖入左侧面板区域）
          await dragResizerToX(page, resizer, 360);
          const afterLeftDrag = await getPanelMetrics(page);
          expect(afterLeftDrag.leftWidth).toBeLessThan(
            afterRightDrag.leftWidth
          );
          expect(afterLeftDrag.leftWidth).toBeGreaterThanOrEqual(259);
          expect(afterLeftDrag.rightWidth).toBeGreaterThanOrEqual(319);

          // 双击重置
          await resizer.dblclick();
          await expect(page.locator(".zen-workspace")).not.toHaveClass(
            /zen-workspace--resized/
          );
          const afterReset = await getPanelMetrics(page);
          expect(afterReset.hasResizedClass).toBe(false);
          expect(afterReset.inlineLeftVar).toBe("");
          expect(
            Math.abs(afterReset.leftWidth - initial.leftWidth)
          ).toBeLessThanOrEqual(2);

          // 窄屏响应式（<= 900px）：隐藏分隔栏并单列堆叠
          await page.setViewportSize({ width: 880, height: 768 });
          await expect(resizer).toBeHidden();
          const atNarrow = await getPanelMetrics(page);
          expect(atNarrow.rightY).toBeGreaterThanOrEqual(
            atNarrow.leftY + atNarrow.leftHeight - 1
          );
          expect(atNarrow.docScrollWidth).toBeLessThanOrEqual(880);

          // 3. 严格 0 pageErrors 与 0 consoleErrors（含 0 CSP 报错）
          expect(pageErrors).toEqual([]);
          expect(consoleErrors).toEqual([]);
        } finally {
          await page.close();
        }
      };

      await verifyOfflineReportPage(reportFileUrl);
      await verifyOfflineReportPage(`${serverControl.baseUrl}/report.html`);
    } finally {
      if (serverControl) {
        await serverControl.close();
      }
      fs.rmSync(tmpReportDir, { recursive: true, force: true });
    }
  });
});
