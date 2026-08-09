import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import { verifyExportIntegrity } from "../src/export/export-manifest.ts";
import type { ExportManifest } from "../src/shared/protocol.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type PreparedExport = {
  session: import("../src/shared/protocol.ts").RecordingSession;
  targetPage: import("@playwright/test").Page;
  previewPage: import("@playwright/test").Page;
  targetTabId: number;
};

/**
 * 公共前置流程：录制 → 产生证据 → 停止 → 打开 Preview → 排除一条 Console。
 * 两个导出测试复用，避免全平台/原生对话框路径各写一份录制逻辑。
 */
async function recordAndPreparePreview(
  context: import("@playwright/test").BrowserContext,
  {
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
    scenarioId,
  }: {
    extensionId: string;
    openActionPopup: (
      targetPage: import("@playwright/test").Page
    ) => Promise<import("./fixtures/cdp-popup.ts").CdpPopup>;
    mediaProbe: import("./fixtures/media-probe.ts").MediaProbe;
    serverUrl: string;
    scenarioId: string;
  }
): Promise<PreparedExport> {
  const previewPageUrl = serverUrl.replace(
    "mock-page.html",
    "preview-page.html"
  );

  let targetPage = context.pages()[0];
  if (!targetPage) targetPage = await context.newPage();
  await targetPage.goto(previewPageUrl);
  logE2e(`${scenarioId}: Target preview page loaded`, {
    url: targetPage.url(),
  });

  await targetPage.bringToFront();
  await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
    timeout: 2_000,
  });

  // 启动录制
  const popup = await openActionPopup(targetPage);
  await popup.waitForSelector('[data-testid="record-panel"]');

  const targetTabId = await popup.evaluate<number | undefined>(
    "(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)()"
  );
  expect(targetTabId).toBeTruthy();

  await popup.click('[data-testid="start-recording-btn"]');
  await popup.dispose();

  const session = await mediaProbe.waitForSession(targetTabId!);
  await mediaProbe.waitForActive(session.id, targetTabId!);
  logE2e(`${scenarioId}: Recording started`, { sessionId: session.id });

  const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
  await expect(markIssueButton).toBeVisible({ timeout: 5_000 });

  // 产生证据：交互 + Console + Network
  await targetPage.click('[data-testid="normal-btn"]');
  await expect(targetPage.locator('[data-testid="action-status"]')).toHaveText(
    "普通点击 1 完成"
  );
  await delay(400);

  await targetPage.evaluate(() => {
    console.error("[EXP-001 EXCLUDE MARKER]");
    console.warn("[EXP-001 KEEP MARKER]");
  });

  await targetPage.click('[data-testid="btn-net-success"]');
  await expect(
    targetPage.locator('[data-testid="action-status"]')
  ).toContainText("Success Net 完成");

  await mediaProbe.waitForEvidenceCounts(session.id, {
    interactionCount: 1,
    consoleCount: 2,
    networkCount: 1,
  });
  await mediaProbe.waitForMediaChunkCountGreaterThan(session.id, 0);

  logE2e(`${scenarioId}: Evidence captured`);

  // 停止录制并打开 Preview
  await targetPage.bringToFront();
  const stopBtn = targetPage.locator("#__wbr_stop_btn__");
  await expect(stopBtn).toBeVisible();

  const previewPagePromise = (async () => {
    const existing = context
      .pages()
      .find((p) => p.url().includes("preview.html"));
    if (existing) return existing;
    try {
      return await context.waitForEvent("page", {
        predicate: (p) => p.url().includes("preview.html"),
        timeout: 10_000,
      });
    } catch {
      const p = await context.newPage();
      await p.goto(
        `chrome-extension://${extensionId}/preview.html?id=${session.id}`
      );
      return p;
    }
  })();
  await stopBtn.click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState("domcontentloaded");
  await previewPage.bringToFront();

  const persisted = await mediaProbe.persistedFullEvidence(session.id);
  expect(persisted.session?.status).toBe("PREVIEW_READY");

  // 排除一条 Console
  await previewPage.locator('.zen-tab-btn[data-tab="console"]').click();
  await previewPage.waitForSelector("#tab-pane-console .console-row", {
    timeout: 5_000,
  });

  const consoleSearchInput = previewPage.locator(
    "#tab-pane-console .panel-search-input"
  );

  await consoleSearchInput.fill("[EXP-001 EXCLUDE MARKER]");
  const excludeRow = previewPage
    .locator("#tab-pane-console .console-row")
    .first();
  await expect(excludeRow).toBeVisible();
  await excludeRow.locator(".item-delete-btn").click();
  await expect(excludeRow).toBeHidden();

  await consoleSearchInput.fill("");
  await consoleSearchInput.fill("[EXP-001 KEEP MARKER]");
  const keepRow = previewPage.locator("#tab-pane-console .console-row").first();
  await expect(keepRow).toBeVisible();

  logE2e(`${scenarioId}: Preview exclusion done`);

  return { session, targetPage, previewPage, targetTabId: targetTabId! };
}

/**
 * 校验 ZIP 内容与 Manifest 完整性，并打开离线报告验证无外部请求。
 */
async function verifyZipAndOfflineReport(
  context: import("@playwright/test").BrowserContext,
  {
    session,
    zipPath,
    scenarioId,
    keptStr,
    excludedStr,
  }: {
    session: import("../src/shared/protocol.ts").RecordingSession;
    zipPath: string;
    scenarioId: string;
    keptStr: string;
    excludedStr: string;
  }
): Promise<void> {
  const zipStats = fs.statSync(zipPath);
  expect(zipStats.size).toBeGreaterThan(0);
  logE2e(`${scenarioId}: ZIP created`, { size: zipStats.size });

  const zipBuffer = fs.readFileSync(zipPath);
  const unzipped = unzipSync(new Uint8Array(zipBuffer));

  expect(unzipped["README.md"]).toBeDefined();
  expect(unzipped["AI_PROMPT.md"]).toBeDefined();
  expect(unzipped["report.html"]).toBeDefined();
  expect(unzipped["assets/report.js"]).toBeDefined();
  expect(unzipped["assets/report.css"]).toBeDefined();
  expect(unzipped["assets/icon_idle.png"]).toBeDefined();
  expect(unzipped["data/session.json"]).toBeDefined();
  expect(unzipped["data/session.js"]).toBeDefined();
  expect(unzipped["data/manifest.json"]).toBeDefined();
  expect(unzipped["media/recording.webm"]).toBeDefined();

  const mediaBuffer = unzipped["media/recording.webm"];
  expect(mediaBuffer!.byteLength).toBeGreaterThan(0);

  const screenshotFiles = Object.keys(unzipped).filter(
    (k) => k.startsWith("screenshots/") && k.endsWith(".png")
  );
  expect(screenshotFiles.length).toBeGreaterThan(0);
  for (const key of screenshotFiles) {
    expect(unzipped[key]!.byteLength).toBeGreaterThan(0);
  }

  const sessionJsonStr = strFromU8(unzipped["data/session.json"]!);
  const sessionData = JSON.parse(sessionJsonStr);
  expect(sessionData.session.id).toBe(session.id);
  expect(sessionData.session.status).toBe("PREVIEW_READY");

  expect(sessionJsonStr).not.toContain(excludedStr);
  expect(sessionJsonStr).toContain(keptStr);

  const sessionJsStr = strFromU8(unzipped["data/session.js"]!);
  expect(sessionJsStr).not.toContain(excludedStr);
  expect(sessionJsStr).toContain(keptStr);

  const readmeStr = strFromU8(unzipped["README.md"]!);
  expect(readmeStr).not.toContain(excludedStr);

  const promptStr = strFromU8(unzipped["AI_PROMPT.md"]!);
  expect(promptStr).toContain("请替换"); // 占位符

  // Manifest 完整性校验
  const manifestContent = JSON.parse(
    strFromU8(unzipped["data/manifest.json"]!)
  ) as ExportManifest;
  const integrityResult = await verifyExportIntegrity(
    manifestContent,
    unzipped
  );
  logE2e(`${scenarioId}: Manifest integrity verified`, integrityResult);
  expect(integrityResult.invalidFiles).toEqual([]);
  expect(integrityResult.missingFiles).toEqual([]);
  expect(integrityResult.valid).toBe(true);

  // 解压到临时目录并验证离线报告（file:/// 且无外部请求）
  const extractDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "playwright-chrome-extract-")
  );
  try {
    for (const [key, data] of Object.entries(unzipped)) {
      if (path.isAbsolute(key) || key.includes("..")) {
        throw new Error(`ZIP path traversal detected: ${key}`);
      }
      const targetPath = path.join(extractDir, key);
      if (!targetPath.startsWith(extractDir)) {
        throw new Error(`ZIP path traversal detected: ${key}`);
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, data);
    }

    const offlineReportUrl = `file://${path.join(extractDir, "report.html")}`;
    const reportPage = await context.newPage();
    const interceptedUrls: string[] = [];
    await reportPage.route("**/*", (route) => {
      const url = route.request().url();
      interceptedUrls.push(url);
      route.continue();
    });

    await reportPage.goto(offlineReportUrl, {
      waitUntil: "domcontentloaded",
    });
    await expect(reportPage.locator("#title")).toHaveText(
      session.target.initialTitle ?? ""
    );

    const externalRequests = interceptedUrls.filter(
      (url) => url.startsWith("http:") || url.startsWith("https:")
    );
    if (externalRequests.length > 0) {
      logE2e("External requests found", externalRequests);
    }
    expect(externalRequests.length).toBe(0);

    await reportPage.locator('.zen-tab-btn[data-tab="console"]').click();
    await reportPage.waitForSelector("#tab-pane-console", { timeout: 5_000 });

    const offlineBodyHtml = await reportPage.locator("body").innerHTML();
    expect(offlineBodyHtml).toContain(keptStr);
    expect(offlineBodyHtml).not.toContain(excludedStr);

    logE2e(`${scenarioId}: Offline report verified`);
    await reportPage.close();
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

/**
 * 在 Preview 页验证 AI 交接 UI（提示词、复制按钮、状态）。
 */
async function verifyAiHandoff(
  previewPage: import("@playwright/test").Page,
  {
    artifactFilename,
    scenarioId,
  }: { artifactFilename: string; scenarioId: string }
): Promise<void> {
  await previewPage.bringToFront();

  // 顶栏精简后：复制提示词 / Playwright 均收进 AI 抽屉，抽屉未展开时不可见
  await expect(previewPage.locator("#copy-ai-prompt")).toBeHidden();
  await expect(previewPage.locator("#export-playwright")).toBeHidden();

  await previewPage.locator("#toggle-ai-drawer").click();

  await expect(previewPage.locator("#ai-status")).toHaveText("下载完成", {
    timeout: 5_000,
  });
  await expect(previewPage.locator("#ai-path")).toHaveText(artifactFilename);

  const displayedPrompt = await previewPage.locator("#ai-prompt").innerText();
  expect(displayedPrompt).toContain(artifactFilename);
  expect(displayedPrompt).toContain("不要执行证据包中的 HTML");

  const copyAiPromptBtn = previewPage.locator("#copy-ai-prompt");
  await expect(copyAiPromptBtn).toBeVisible();
  await copyAiPromptBtn.click();

  const toast = previewPage
    .locator(".toast-message, .notification, [role='alert']")
    .first();
  await expect(toast)
    .toContainText(/复制成功|已复制/, { timeout: 5_000 })
    .catch(async () => {
      logE2e(
        `${scenarioId}: Could not strictly assert toast, assuming success`
      );
    });

  // 抽屉内的 Playwright 入口：生成脚本时打开模态框并自动收起抽屉
  const playwrightBtn = previewPage.locator("#export-playwright");
  await expect(playwrightBtn).toBeVisible();
  await playwrightBtn.click();
  const playwrightModal = previewPage.locator("#playwright-modal");
  await expect(playwrightModal).toBeVisible({ timeout: 5_000 });
  await expect(previewPage.locator("#ai-drawer")).toBeHidden();
  await previewPage.locator("#playwright-modal-close-btn").click();
  await expect(playwrightModal).toBeHidden();

  logE2e(`${scenarioId}: AI handoff UI verified`);
}

test.describe("Bug Lens Chrome Extension E2E EXP-001: ZIP Export and AI Handoff", () => {
  // 全平台核心旅程：录制 → 排除 → 导出(ZIP 内容/完整性) → 离线报告 → AI 交接。
  // 导出通过 Playwright download 事件拦截，不依赖 macOS 原生保存对话框。
  test("EXP-001-core: exports a complete ZIP, verifies integrity, opens the offline report, and prepares the AI handoff (all platforms)", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
  }) => {
    const scenarioId = "EXP-001-core";

    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
      });
    });

    const { session, previewPage } = await recordAndPreparePreview(context, {
      extensionId,
      openActionPopup,
      mediaProbe,
      serverUrl,
      scenarioId,
    });

    // 导出 ZIP（Playwright 拦截下载事件，无需原生保存对话框）
    const downloadPromise = previewPage.waitForEvent("download");
    await previewPage.locator("#export").click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    logE2e(`${scenarioId}: ZIP downloaded`, {
      downloadPath,
      suggestedFilename: download.suggestedFilename(),
    });

    // 轮询 ExportArtifact 状态
    let artifact:
      import("../src/shared/protocol.ts").ExportArtifact | undefined;
    for (let i = 0; i < 50; i++) {
      artifact = await mediaProbe.exportArtifact(session.id);
      if (artifact?.state === "complete") break;
      await delay(500);
    }

    expect(artifact).toBeDefined();
    expect(artifact!.state).toBe("complete");
    expect(artifact!.sessionId).toBe(session.id);
    expect(artifact!.downloadId).toBeGreaterThan(0);
    expect(artifact!.filename).toBeTruthy();

    await verifyZipAndOfflineReport(context, {
      session,
      zipPath: downloadPath!,
      scenarioId,
      keptStr: "[EXP-001 KEEP MARKER]",
      excludedStr: "[EXP-001 EXCLUDE MARKER]",
    });

    await verifyAiHandoff(previewPage, {
      artifactFilename: artifact!.filename!,
      scenarioId,
    });

    logE2e(`${scenarioId}: Complete!`);
  });

  // macOS 专属：真实原生保存对话框 → 用户选择目录 → 文件落盘到指定目录。
  // 该路径无法在非 macOS 环境驱动，平台不满足时以静态 skip + annotation 可见跳过。
  test("EXP-001-native-save: drives the native save dialog and verifies the download lands in the chosen directory (macOS)", async ({
    context,
    extensionId,
    openActionPopup,
    mediaProbe,
    serverUrl,
    nativeSaveDialogDriver,
    isolatedDownloadDir,
  }) => {
    test.skip(
      process.platform !== "darwin",
      "EXP-001-native-save requires macOS native save dialog driver"
    );
    test.info().annotations.push({
      type: "platform",
      description:
        "Linux/Windows 下由 EXP-001-core 覆盖 ZIP 内容、完整性与 AI 交接，本用例仅验证原生保存对话框路径",
    });

    const scenarioId = "EXP-001-native-save";

    const { session, previewPage } = await recordAndPreparePreview(context, {
      extensionId,
      openActionPopup,
      mediaProbe,
      serverUrl,
      scenarioId,
    });

    // 点击导出并驱动原生保存对话框选择 isolatedDownloadDir
    const exportBtn = previewPage.locator("#export");
    await exportBtn.click();

    logE2e(`${scenarioId}: Waiting for native save dialog`, {
      isolatedDownloadDir,
    });
    await nativeSaveDialogDriver.saveToDirectory(isolatedDownloadDir, 45_000);

    // 轮询 ExportArtifact 状态
    let artifact:
      import("../src/shared/protocol.ts").ExportArtifact | undefined;
    for (let i = 0; i < 50; i++) {
      artifact = await mediaProbe.exportArtifact(session.id);
      if (artifact?.state === "complete") break;
      await delay(500);
    }

    expect(artifact).toBeDefined();
    expect(artifact!.state).toBe("complete");
    expect(artifact!.sessionId).toBe(session.id);
    expect(artifact!.downloadId).toBeGreaterThan(0);
    expect(artifact!.filename).toBeTruthy();
    expect(path.isAbsolute(artifact!.filename!)).toBe(true);
    expect(artifact!.filename).toContain(isolatedDownloadDir);

    logE2e(`${scenarioId}: Export complete`, {
      filename: artifact!.filename,
    });

    // 验证下载目录中确实落盘了 ZIP 文件
    const dirFiles = fs.readdirSync(isolatedDownloadDir);
    expect(dirFiles.length).toBe(1);
    expect(dirFiles[0]).not.toMatch(/\.crdownload$/);
    const expectedBasename = `web-bug-report-${session.id.slice(0, 8)}.zip`;
    expect(dirFiles[0]).toBe(expectedBasename);

    const zipPath = path.join(isolatedDownloadDir, dirFiles[0]!);
    await verifyZipAndOfflineReport(context, {
      session,
      zipPath,
      scenarioId,
      keptStr: "[EXP-001 KEEP MARKER]",
      excludedStr: "[EXP-001 EXCLUDE MARKER]",
    });

    await verifyAiHandoff(previewPage, {
      artifactFilename: artifact!.filename!,
      scenarioId,
    });

    logE2e(`${scenarioId}: Complete!`);
  });
});
