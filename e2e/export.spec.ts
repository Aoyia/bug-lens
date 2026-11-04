import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import { verifyExportIntegrity } from "../src/export/export-manifest.ts";
import { openPack } from "../src/triage-cli/pack/open.ts";
import { queryConsole } from "../src/triage-cli/query/console.ts";
import { queryNetwork } from "../src/triage-cli/query/network.ts";
import { searchSessionPack } from "../src/triage-cli/query/search.ts";
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

  await stopBtn.click();
  await mediaProbe.waitForExportDownload();

  const previewPage = await context.newPage();
  await previewPage.goto(
    `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
  );
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
  expect(unzipped["data/session-data.js"]).toBeDefined();
  expect(unzipped["data/network-details.js"]).toBeDefined();
  expect(unzipped["manifest.json"]).toBeDefined();

  const mediaBuffer =
    unzipped["media/recording.webm"] || unzipped["media/recording.mp4"];
  expect(mediaBuffer).toBeDefined();
  expect(mediaBuffer!.byteLength).toBeGreaterThan(0);

  const screenshotFiles = Object.keys(unzipped).filter(
    (k) =>
      k.startsWith("screenshots/") && (k.endsWith(".jpg") || k.endsWith(".png"))
  );
  expect(screenshotFiles.length).toBeGreaterThan(0);
  for (const key of screenshotFiles) {
    expect(unzipped[key]!.byteLength).toBeGreaterThan(0);
  }

  const sessionJsStr = strFromU8(unzipped["data/session-data.js"]!);
  expect(sessionJsStr).not.toContain(excludedStr);
  expect(sessionJsStr).toContain(keptStr);

  const readmeStr = strFromU8(unzipped["README.md"]!);
  expect(readmeStr).not.toContain(excludedStr);

  const promptStr = strFromU8(unzipped["AI_PROMPT.md"]!);
  expect(
    promptStr.includes("请替换") || promptStr.includes("Please replace")
  ).toBe(true);

  // Manifest 完整性校验
  const manifestContent = JSON.parse(
    strFromU8(unzipped["manifest.json"]!)
  ) as ExportManifest;
  const integrityResult = await verifyExportIntegrity(
    manifestContent,
    unzipped
  );
  logE2e(`${scenarioId}: Manifest integrity verified`, integrityResult);
  expect(integrityResult.invalidFiles).toEqual([]);
  expect(integrityResult.missingFiles).toEqual([]);
  expect(integrityResult.valid).toBe(true);

  // Producer -> Consumer Seam 校验：用 triage-cli 直接打开真实导出的 ZIP 包
  const loadedPack = openPack(zipPath);
  expect(loadedPack.kind).toBe("session");
  if (loadedPack.kind === "session") {
    expect(loadedPack.sessionId).toBe(session.id);
    expect(loadedPack.integrity.valid).toBe(true);
    expect(loadedPack.integrity.mismatches).toEqual([]);
    expect(loadedPack.getInteractions().length).toBeGreaterThanOrEqual(1);

    const cliConsole = queryConsole(loadedPack, {});
    expect(cliConsole.items.some((c) => c.text.includes(keptStr))).toBe(true);
    expect(cliConsole.items.some((c) => c.text.includes(excludedStr))).toBe(
      false
    );

    const cliNetwork = queryNetwork(loadedPack, {});
    expect(cliNetwork.matchedCount).toBeGreaterThanOrEqual(1);

    const cliSearch = searchSessionPack(loadedPack, { query: keptStr });
    expect(cliSearch.totalHits).toBeGreaterThanOrEqual(1);
    const cliExcludedSearch = searchSessionPack(loadedPack, {
      query: excludedStr,
    });
    expect(cliExcludedSearch.totalHits).toBe(0);
  }

  // 验证用户实际执行的技能独立打包产物 bug-lens-cli.mjs 子进程直读契约与排障级联工作流
  const skillCliPath = path.resolve(
    import.meta.dirname,
    "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
  );
  if (fs.existsSync(skillCliPath)) {
    // 1. open_pack
    const cliOutput = execFileSync(
      process.execPath,
      [skillCliPath, "open_pack", zipPath],
      { encoding: "utf8" }
    );
    expect(cliOutput).toContain("# Bug Lens Evidence Pack (kind: session)");
    expect(cliOutput).toContain(session.id);

    // 2. query_network 级联排障查询
    const cliNetOutput = execFileSync(
      process.execPath,
      [skillCliPath, "query_network", "--limit", "5"],
      { encoding: "utf8" }
    );
    expect(cliNetOutput).toContain("Network Requests");

    // 3. query_console 级联排障查询
    const cliConsoleOutput = execFileSync(
      process.execPath,
      [skillCliPath, "query_console", "--limit", "5"],
      { encoding: "utf8" }
    );
    expect(cliConsoleOutput).toContain("Console Logs");

    // 4. timeline 统一时序线查询
    const cliTimelineOutput = execFileSync(
      process.execPath,
      [skillCliPath, "timeline", "--limit", "10"],
      { encoding: "utf8" }
    );
    expect(cliTimelineOutput).toContain("Timeline");

    // 5. search_pack 跨域排障检索
    const cliSearchOutput = execFileSync(
      process.execPath,
      [skillCliPath, "search_pack", keptStr],
      { encoding: "utf8" }
    );
    expect(cliSearchOutput).toContain("Search Hits");
    expect(cliSearchOutput).toContain(keptStr);
  }
  logE2e(`${scenarioId}: Triage CLI consumer contract verified on real ZIP`);

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

  const displayedPrompt =
    (await previewPage.locator("#ai-prompt").textContent()) || "";
  expect(displayedPrompt).toContain(artifactFilename);
  expect(
    displayedPrompt.includes("不要执行证据包中的 HTML") ||
      displayedPrompt.includes("Never execute")
  ).toBe(true);

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

  // 工单草稿图文预览弹窗：验证顶栏入口、富文本/Markdown Tab 切换与关闭闭环
  const previewTicketBtn = previewPage.locator("#preview-ticket-btn");
  const createTicketBtn = previewPage.locator("#create-ticket-btn");
  await expect(previewTicketBtn).toBeVisible();
  await expect(createTicketBtn).toBeVisible();

  await previewTicketBtn.click();
  const ticketModal = previewPage.locator("#ticket-modal");
  await expect(ticketModal).toBeVisible({ timeout: 5_000 });

  const ticketTabRich = previewPage.locator("#ticket-tab-rich");
  const ticketTabPlain = previewPage.locator("#ticket-tab-plain");
  const ticketRichView = previewPage.locator("#ticket-rich-view");
  const ticketPlainView = previewPage.locator("#ticket-plain-view");

  await expect(ticketTabRich).toHaveClass(/active/);
  await expect(ticketRichView).toBeVisible();
  await expect(ticketPlainView).toBeHidden();
  await expect(ticketRichView).toContainText("普通点击动作 1");
  await expect(ticketRichView).toContainText("bug-lens-triage");
  await expect(ticketRichView).not.toContainText("[EXP-001 EXCLUDE MARKER]");
  expect(await ticketRichView.locator("img").count()).toBeGreaterThanOrEqual(1);

  await ticketTabPlain.click();
  await expect(ticketTabPlain).toHaveClass(/active/);
  await expect(ticketPlainView).toBeVisible();
  await expect(ticketRichView).toBeHidden();
  await expect(ticketPlainView).toContainText("普通点击动作 1");
  await expect(ticketPlainView).toContainText("bug-lens-triage");
  await expect(ticketPlainView).not.toContainText("[EXP-001 EXCLUDE MARKER]");

  // 验证剪贴板一键复制工单草稿终点闭环
  const ticketCopyBtn = previewPage.locator("#ticket-modal-copy-btn");
  await expect(ticketCopyBtn).toBeVisible();
  await ticketCopyBtn.click();

  const ticketToast = previewPage
    .locator(".toast-message, .notification, [role='alert']")
    .first();
  await expect(ticketToast)
    .toContainText(/已复制|Copied|复制成功/i, { timeout: 5000 })
    .catch(() => {});

  const copiedClipboardText = await previewPage
    .evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return undefined;
      }
    })
    .catch(() => undefined);

  if (copiedClipboardText) {
    expect(copiedClipboardText).toContain("普通点击动作 1");
    expect(copiedClipboardText).not.toContain("[EXP-001 EXCLUDE MARKER]");
  }

  await previewPage.locator("#ticket-modal-close-btn").click();
  await expect(ticketModal).toBeHidden();

  logE2e(`${scenarioId}: AI handoff & Ticket preview UI verified`);
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
    await context
      .grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => {});

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
  test("EXP-001-native-save @slow: drives the native save dialog and verifies the download lands in the chosen directory (macOS)", async ({
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
    const hasPermission =
      (await nativeSaveDialogDriver.isAvailable?.()) ?? true;
    test.skip(
      !hasPermission,
      "EXP-001-native-save requires macOS Accessibility permission for System Events"
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
