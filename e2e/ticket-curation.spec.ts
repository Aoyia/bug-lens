import { test, expect } from "./fixtures/extension.ts";
import fs from "node:fs";
import type { Page, Worker } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { verifyExportIntegrity } from "../src/export/export-manifest.ts";
import type { ExportManifest } from "../src/shared/protocol.ts";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const LONG_BREADCRUMB_TAIL = "超长末级页面标题示例";
const LONG_BREADCRUMB_TEXT = `应用详情 / 各种测试放这里 (bpm应用) / 单元管理 / 组件开发对照-H5 / 嵌套子模块列表 / ${LONG_BREADCRUMB_TAIL}`;

interface SeedTicketSessionOptions {
  includeIssueScene?: boolean;
  expectedText?: string;
}

async function setLocalePreference(
  serviceWorker: Worker,
  locale: "zh-CN" | "en-US"
): Promise<void> {
  await serviceWorker.evaluate(async (pref: "zh-CN" | "en-US") => {
    await chrome.storage.sync.set({ user_language_preference: pref });
  }, locale);
}

async function seedTicketSession(
  page: Page,
  extensionId: string,
  sessionId: string,
  opts: SeedTicketSessionOptions = {}
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/preview.html`);
  await page.waitForLoadState("domcontentloaded");

  await page.evaluate(
    async ({
      id,
      longBreadcrumbText,
      includeIssueScene,
      expectedText,
    }: {
      id: string;
      longBreadcrumbText: string;
      includeIssueScene: boolean;
      expectedText?: string;
    }) => {
      const makePngBuffer = async (
        bgColor: string,
        label: string
      ): Promise<ArrayBuffer> => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "20px sans-serif";
        ctx.fillText(label, 32, 180);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/png"
          )
        );
        return blob.arrayBuffer();
      };

      // 生成一小段真实可播放 WebM 分片
      const videoCanvas = document.createElement("canvas");
      videoCanvas.width = 320;
      videoCanvas.height = 180;
      const vCtx = videoCanvas.getContext("2d");
      if (vCtx) {
        vCtx.fillStyle = "#165dff";
        vCtx.fillRect(0, 0, 320, 180);
      }
      const stream = videoCanvas.captureStream(10);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      const recordedBuffer = await new Promise<ArrayBuffer>(
        (resolve, reject) => {
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
            recorder.stop();
            stream.getTracks().forEach((t) => t.stop());
          }, 150);
        }
      );

      const [png1, png2] = await Promise.all([
        makePngBuffer("#165dff", "Ticket Step 1"),
        makePngBuffer("#10b981", "Ticket Step 2"),
      ]);

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
          ensureStore("sessions", "id", [
            { name: "status", keyPath: "status" },
          ]);
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
      const basePage = {
        url: "http://127.0.0.1/ticket-e2e",
        title: "Ticket Curation E2E",
        frameId: 0,
      };
      const baseCoords = {
        clientX: 120,
        clientY: 200,
        pageX: 120,
        pageY: 200,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 1280, height: 800 },
      };

      const session = {
        id,
        schemaVersion: 2,
        extensionVersion: "0.7.43",
        status: "PREVIEW_READY",
        target: {
          tabId: 1,
          initialUrl: basePage.url,
          initialTitle: basePage.title,
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
          createdAtEpochMs: now - 6000,
          startedAtEpochMs: now - 5000,
          stoppedAtEpochMs: now - 500,
          durationMs: 4500,
        },
        quality: {
          videoStatus: "captured",
          screenshotStatus: "captured",
          interactionCount: 4,
          confirmedInteractionCount: 4,
          primaryScreenshotCount: 2,
          fallbackScreenshotCount: 0,
          unavailableScreenshotCount: 2,
          consoleEntryCount: 2,
          networkEntryCount: 2,
          overall: "complete",
          issues: [],
        },
        nonce: "e2e-ticket-nonce",
      };

      const interactions = [
        {
          id: `${id}-step-1`,
          sessionId: id,
          kind: "click",
          status: "confirmed",
          createdAt: now - 4000,
          confirmedAt: now - 3950,
          page: basePage,
          input: { pointerType: "mouse", button: 0, isTrusted: true },
          coordinates: baseCoords,
          element: {
            tagName: "H2",
            classNames: ["breadcrumb-title"],
            text: longBreadcrumbText,
            boundingBox: { x: 40, y: 60, width: 480, height: 28 },
            locators: [],
          },
          screenshot: {
            status: "captured",
            source: "primary",
            assetId: `${id}-asset-1`,
          },
        },
        {
          id: `${id}-step-2`,
          sessionId: id,
          kind: "click",
          status: "confirmed",
          createdAt: now - 3000,
          confirmedAt: now - 2950,
          page: basePage,
          input: { pointerType: "mouse", button: 0, isTrusted: true },
          coordinates: baseCoords,
          element: {
            tagName: "BUTTON",
            classNames: ["primary"],
            text: "Create",
            boundingBox: { x: 100, y: 180, width: 96, height: 34 },
            locators: [],
          },
          screenshot: {
            status: "captured",
            source: "primary",
            assetId: `${id}-asset-2`,
          },
        },
        {
          id: `${id}-step-3-click`,
          sessionId: id,
          kind: "click",
          status: "confirmed",
          createdAt: now - 2000,
          confirmedAt: now - 1960,
          page: basePage,
          input: { pointerType: "mouse", button: 0, isTrusted: true },
          coordinates: baseCoords,
          element: {
            tagName: "INPUT",
            id: "email-input",
            classNames: ["form-input"],
            attributes: { placeholder: "邮箱地址" },
            boundingBox: { x: 100, y: 240, width: 220, height: 32 },
            locators: [],
          },
          screenshot: { status: "unavailable" },
        },
        {
          id: `${id}-step-3-input`,
          sessionId: id,
          kind: "input",
          status: "confirmed",
          createdAt: now - 1600,
          confirmedAt: now - 1550,
          page: basePage,
          input: { pointerType: "keyboard", isTrusted: true },
          coordinates: baseCoords,
          element: {
            tagName: "INPUT",
            id: "email-input",
            classNames: ["form-input"],
            attributes: { placeholder: "邮箱地址" },
            text: "邮箱地址",
            value: "qa@example.com",
            valueLength: 14,
            boundingBox: { x: 100, y: 240, width: 220, height: 32 },
            locators: [],
          },
          screenshot: { status: "unavailable" },
        },
      ];

      const assets = [
        {
          id: `${id}-asset-1`,
          sessionId: id,
          interactionId: `${id}-step-1`,
          kind: "interaction-screenshot",
          mimeType: "image/png",
          bytes: png1,
          width: 640,
          height: 360,
          createdAtEpochMs: now - 3950,
        },
        {
          id: `${id}-asset-2`,
          sessionId: id,
          interactionId: `${id}-step-2`,
          kind: "interaction-screenshot",
          mimeType: "image/png",
          bytes: png2,
          width: 640,
          height: 360,
          createdAtEpochMs: now - 2950,
        },
      ];

      const consoleEntries = [
        {
          id: `${id}-console-1`,
          sessionId: id,
          createdAt: now - 2500,
          level: "error",
          args: [
            {
              type: "string",
              valuePreview:
                "[TKT-ERR-DELETE] TypeError: Cannot read properties of null",
            },
          ],
          text: "[TKT-ERR-DELETE] TypeError: Cannot read properties of null",
        },
        {
          id: `${id}-console-2`,
          sessionId: id,
          createdAt: now - 2200,
          level: "error",
          args: [
            {
              type: "string",
              valuePreview:
                "[TKT-ERR-KEEP] ReferenceError: submitForm is not defined",
            },
          ],
          text: "[TKT-ERR-KEEP] ReferenceError: submitForm is not defined",
        },
      ];

      const networkEntries = [
        {
          id: `${id}-net-fail`,
          sessionId: id,
          createdAt: now - 1800,
          method: "POST",
          url: "http://127.0.0.1/api/ticket/submit",
          status: 500,
          durationMs: 142,
        },
        {
          id: `${id}-net-ok`,
          sessionId: id,
          createdAt: now - 1700,
          method: "GET",
          url: "http://127.0.0.1/api/ticket/health",
          status: 200,
          durationMs: 18,
        },
      ];

      const mediaChunk = {
        id: `${id}-chunk-0`,
        sessionId: id,
        sequence: 0,
        recordedAt: now - 4500,
        mimeType,
        chunk: recordedBuffer,
      };

      const issueScenes = includeIssueScene
        ? [
            {
              id: `${id}-scene-1`,
              sessionId: id,
              status: "complete",
              observedAtEpochMs: now - 1200,
              page: {
                url: basePage.url,
                title: basePage.title,
                frameId: 0,
                viewport: { width: 1280, height: 800 },
                scrollX: 0,
                scrollY: 0,
                devicePixelRatio: 1,
              },
              target: {
                capturedAtEpochMs: now - 1200,
                element: {
                  tagName: "BUTTON",
                  classNames: ["primary"],
                  text: "Create",
                  boundingBox: { x: 100, y: 180, width: 96, height: 34 },
                  locators: [],
                },
                ancestors: [],
                state: {},
                computedStyle: {},
              },
              narrative: {
                actual: "默认问题实际表现",
                ...(expectedText
                  ? {
                      expected: {
                        text: expectedText,
                        confidence: "explicit",
                      },
                    }
                  : {}),
              },
              annotation: {
                type: "arrow-box",
                color: "#ef233c",
                point: { xRatio: 0.2, yRatio: 0.2 },
              },
              screenshot: { status: "unavailable" },
              issues: [],
            },
          ]
        : [];

      const storeNames = [
        "sessions",
        "interactions",
        "consoleEntries",
        "networkEntries",
        "mediaChunks",
        "evidenceAssets",
        "issueScenes",
      ];

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeNames, "readwrite");
        tx.objectStore("sessions").put(session);
        for (const item of interactions) {
          tx.objectStore("interactions").put(item);
        }
        for (const asset of assets) {
          tx.objectStore("evidenceAssets").put(asset);
        }
        for (const entry of consoleEntries) {
          tx.objectStore("consoleEntries").put(entry);
        }
        for (const entry of networkEntries) {
          tx.objectStore("networkEntries").put(entry);
        }
        tx.objectStore("mediaChunks").put(mediaChunk);
        for (const scene of issueScenes) {
          tx.objectStore("issueScenes").put(scene);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    {
      id: sessionId,
      longBreadcrumbText: LONG_BREADCRUMB_TEXT,
      includeIssueScene: Boolean(opts.includeIssueScene),
      expectedText: opts.expectedText,
    }
  );
}

async function openPreviewPage(
  page: Page,
  extensionId: string,
  sessionId: string
): Promise<void> {
  await page.goto(
    `chrome-extension://${extensionId}/preview.html?sessionId=${sessionId}`
  );
  await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
  await expect(page.locator("#preview-ticket-btn")).toBeVisible({
    timeout: 5_000,
  });
}

async function openTicketModal(page: Page): Promise<void> {
  await page.locator("#preview-ticket-btn").click();
  await expect(page.locator("#ticket-modal")).toBeVisible({ timeout: 5_000 });
}

function parseSessionDataJs(raw: string): {
  interactions: Array<{
    id: string;
    screenshot?: { status?: string; dataUrl?: string };
  }>;
  consoleEntries: Array<{ id: string; text: string }>;
  networkEntries: Array<{ id: string; url: string; status?: number }>;
  screenshotSummaries: Array<{ step: number; path: string | null }>;
} {
  const prefix = "window.__BUG_LENS_DATA__ = ";
  const start = raw.indexOf(prefix);
  if (start < 0) {
    throw new Error("Missing window.__BUG_LENS_DATA__ prefix");
  }
  let body = raw.slice(start + prefix.length).trim();
  if (body.endsWith(";")) body = body.slice(0, -1).trim();
  return JSON.parse(body);
}

test.describe("Bug Lens Ticket Curation & Inline Editing E2E", () => {
  test("TKT-001: 语义步骤名统一性与极简纯图标 UI", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();
    const sessionId = `e2e-tkt-001-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId);
    await openPreviewPage(page, extensionId, sessionId);

    // 1. 读取左侧「操作步骤」Tab 语义标题
    await page.locator('.zen-tab-btn[data-tab="steps"]').click();
    await page.waitForSelector("#tab-pane-steps article.item", {
      timeout: 5_000,
    });
    const tabStepTitles = await page
      .locator("#tab-pane-steps article.item .top > strong")
      .allTextContents();
    expect(tabStepTitles).toHaveLength(3);

    // 2. 打开工单草稿弹窗并比对步骤标题
    await openTicketModal(page);
    const modalStepTitles = await page
      .locator(
        '#ticket-rich-view [data-ticket-block="step"] [data-ticket-slot="step-desc"]'
      )
      .allTextContents();
    expect(modalStepTitles).toEqual(tabStepTitles);
    expect(modalStepTitles[0]).toContain(LONG_BREADCRUMB_TAIL);
    expect(modalStepTitles[0]).not.toMatch(/点击\s*h2\b/);
    expect(modalStepTitles[1]).toBe('点击 "Create"');
    expect(modalStepTitles[1]).not.toMatch(/点击\s*button\b/);

    // 3. 校验档位 A 精简文案
    await expect(
      page.locator("#ticket-modal .ticket-modal-subtitle")
    ).toHaveText("支持直接粘贴至 TAPD、飞书、Jira");
    await expect(page.locator("#ticket-tab-rich")).toHaveText("预览");
    await expect(page.locator("#ticket-tab-plain")).toHaveText("Markdown");
    await expect(page.locator("#ticket-modal-summary")).toHaveText(
      /^3 步 · 2 图/
    );
    await expect(page.locator("#ticket-modal-copy-btn")).toHaveText("复制工单");
    await expect(page.locator("#ticket-modal-create-btn")).toHaveText(
      "提工单并下载"
    );

    // 4. 校验纯图标胶囊按钮（无文字、完整 title/aria-label、紧凑宽度）
    const step1 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .first();
    const editBtn = step1.locator(".ticket-block-btn").nth(0);
    const deleteBtn = step1.locator(".ticket-block-btn").nth(1);
    await expect(editBtn).toHaveText("");
    await expect(editBtn).toHaveAttribute("title", "编辑");
    await expect(editBtn).toHaveAttribute("aria-label", "编辑");
    await expect(deleteBtn).toHaveText("");
    await expect(deleteBtn).toHaveAttribute("title", "删除");
    await expect(deleteBtn).toHaveAttribute("aria-label", "删除");

    await step1.hover();
    const actionsBar = step1.locator(".ticket-block-actions");
    await expect(actionsBar).toHaveCSS("opacity", "1");
    const actionsBox = await actionsBar.boundingBox();
    expect(actionsBox).toBeTruthy();
    expect(actionsBox!.width).toBeLessThanOrEqual(76);

    const errRemoveBtn = page
      .locator('#ticket-rich-view [data-ticket-block="console"]')
      .first()
      .locator(".ticket-block-btn");
    await expect(errRemoveBtn).toHaveText("");
    await expect(errRemoveBtn).toHaveAttribute("title", "移除");
  });

  test("TKT-002: 零换行 & 0px 位移内联编辑闭环", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();
    const sessionId = `e2e-tkt-002-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId);
    await openPreviewPage(page, extensionId, sessionId);
    await openTicketModal(page);

    const step2 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1);
    const badgeBefore = step2.locator("> p:first-child > strong");
    const slotBefore = step2.locator('[data-ticket-slot="step-desc"]');
    const imgBefore = step2.locator("img");

    await page.evaluate(() => document.fonts?.ready);
    // 等待弹窗入场动画结束，并将第 2 步滚入视口，避免点击触发自动滚动造成坐标偏差
    await page.waitForTimeout(250);
    await slotBefore.scrollIntoViewIfNeeded();
    const scrollTopBefore = await page
      .locator(".ticket-modal-body")
      .evaluate((el) => el.scrollTop);
    const badgeBoxBefore = (await badgeBefore.boundingBox())!;
    const slotBoxBefore = (await slotBefore.boundingBox())!;
    const imgBoxBefore = (await imgBefore.boundingBox())!;
    expect(badgeBoxBefore && slotBoxBefore && imgBoxBefore).toBeTruthy();

    // 点击文本槽进入编辑态
    await slotBefore.click();
    await expect(step2).toHaveClass(/is-editing/);
    const scrollTopEditing = await page
      .locator(".ticket-modal-body")
      .evaluate((el) => el.scrollTop);
    expect(scrollTopEditing).toBe(scrollTopBefore);
    const input = step2.locator(".ticket-inline-input");
    const confirmBtn = step2.locator(".ticket-inline-confirm");
    const cancelBtn = step2.locator(".ticket-inline-cancel");
    await expect(input).toBeVisible();
    await expect(confirmBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    await expect(step2.locator(".ticket-block-actions")).toHaveCSS(
      "opacity",
      "0"
    );

    // 验证序号徽标、输入框、确认按钮同行且 0px 位移
    const badgeBoxEditing = (await badgeBefore.boundingBox())!;
    const inputBoxEditing = (await input.boundingBox())!;
    const confirmBoxEditing = (await confirmBtn.boundingBox())!;
    const imgBoxEditing = (await imgBefore.boundingBox())!;

    const badgeMidY = badgeBoxEditing.y + badgeBoxEditing.height / 2;
    const inputMidY = inputBoxEditing.y + inputBoxEditing.height / 2;
    const confirmMidY = confirmBoxEditing.y + confirmBoxEditing.height / 2;
    expect(Math.abs(badgeMidY - inputMidY)).toBeLessThanOrEqual(4);
    expect(Math.abs(confirmMidY - inputMidY)).toBeLessThanOrEqual(4);
    expect(inputBoxEditing.x).toBeGreaterThan(
      badgeBoxEditing.x + badgeBoxEditing.width - 10
    );

    expect(Math.abs(inputBoxEditing.x - slotBoxBefore.x)).toBeLessThanOrEqual(
      1.5
    );
    expect(Math.abs(inputBoxEditing.y - slotBoxBefore.y)).toBeLessThanOrEqual(
      1.5
    );
    expect(Math.abs(badgeBoxEditing.y - badgeBoxBefore.y)).toBeLessThanOrEqual(
      1.5
    );
    expect(Math.abs(imgBoxEditing.y - imgBoxBefore.y)).toBeLessThanOrEqual(1.5);

    // Esc 取消编辑
    await input.fill("临时取消文案");
    await input.press("Escape");
    await expect(step2).not.toHaveClass(/is-editing/);
    await expect(step2.locator('[data-ticket-slot="step-desc"]')).toHaveText(
      '点击 "Create"'
    );

    // 悬停 [✎] 进入编辑态后点 × 取消
    await step2.hover();
    await step2.locator(".ticket-block-btn").nth(0).click();
    await expect(step2.locator(".ticket-inline-input")).toBeVisible();
    await step2.locator(".ticket-inline-input").fill("第二次取消");
    await step2.locator(".ticket-inline-cancel").click();
    await expect(step2.locator('[data-ticket-slot="step-desc"]')).toHaveText(
      '点击 "Create"'
    );

    // 点击 ✓ 保存文案，并校验脉冲动效、Markdown 同步、右侧步骤卡同步与刷新持久化
    await step2.locator('[data-ticket-slot="step-desc"]').click();
    await step2.locator(".ticket-inline-input").fill("点击顶部新建按钮");
    await step2.locator(".ticket-inline-confirm").click();

    const updatedSlot = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1)
      .locator('[data-ticket-slot="step-desc"]');
    await expect(updatedSlot).toHaveText("点击顶部新建按钮");
    await expect(updatedSlot).toHaveClass(/ticket-slot-just-saved/);
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator(".ticket-slot-reset-btn")
    ).toBeVisible();

    await page.locator("#ticket-tab-plain").click();
    await expect(page.locator("#ticket-plain-view")).toContainText(
      "2. 点击顶部新建按钮"
    );

    await page.locator("#ticket-modal-close-btn").click();
    await expect(page.locator("#ticket-modal")).toBeHidden();
    await page.locator('.zen-tab-btn[data-tab="steps"]').click();
    await expect(
      page
        .locator("#tab-pane-steps article.item")
        .nth(1)
        .locator(".top > strong")
    ).toHaveText("点击顶部新建按钮");

    // 刷新页面确认持久化
    await page.reload();
    await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await openTicketModal(page);
    const reloadedStep2 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1);
    await expect(
      reloadedStep2.locator('[data-ticket-slot="step-desc"]')
    ).toHaveText("点击顶部新建按钮");

    // 单槽 ↺ 还原
    await reloadedStep2.locator(".ticket-slot-reset-btn").click();
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator('[data-ticket-slot="step-desc"]')
    ).toHaveText('点击 "Create"');
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator(".ticket-slot-reset-btn")
    ).toBeHidden();
  });

  test("TKT-003: IME 防误提交、编辑态直点复制竞态消除与剪贴板净化", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    await context
      .grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => {});

    const page = await context.newPage();
    const sessionId = `e2e-tkt-003-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId);
    await openPreviewPage(page, extensionId, sessionId);
    await openTicketModal(page);

    const step2 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1);
    await step2.locator('[data-ticket-slot="step-desc"]').click();
    const input = step2.locator(".ticket-inline-input");
    await input.fill("点击创建并提交工单");

    // IME 组字期间按 Enter 不提前退出编辑态
    await input.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await expect(input).toBeVisible();

    // 不等失焦直接点击「复制工单」，触发 flushAndSyncBundle 同步提交并写入剪贴板
    await page.locator("#ticket-modal-copy-btn").click();

    await expect
      .poll(async () =>
        page.evaluate(async () => navigator.clipboard.readText())
      )
      .toContain("2. 点击创建并提交工单");

    const copiedText = await page.evaluate(async () =>
      navigator.clipboard.readText()
    );
    expect(copiedText).toContain("2. 点击创建并提交工单");
    for (const forbidden of [
      "ticket-block-btn",
      "ticket-inline-editor",
      "ticket-inline-input",
      "ticket-image-actions",
      "ticket-slot-reset-btn",
      "ticket-add-expected-btn",
      "ticket-curation-btn",
    ]) {
      expect(copiedText).not.toContain(forbidden);
    }

    // 同步确认 Markdown 源码视图也已刷新为最新提交文案
    await page.locator("#ticket-tab-plain").click();
    await expect(page.locator("#ticket-plain-view")).toContainText(
      "2. 点击创建并提交工单"
    );
    await page.locator("#ticket-tab-rich").click();

    // 图片浮层「复制」反馈状态
    const step1ImgWrap = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .first()
      .locator(".ticket-image-wrapper");
    await step1ImgWrap.hover();
    const imgCopyBtn = step1ImgWrap.locator(".ticket-image-copy-btn");
    await imgCopyBtn.click();
    await expect(imgCopyBtn).toHaveClass(/copied/);
  });

  test("TKT-004: 问题说明槽位编辑（实际表现 / 补充预期 / 还原原预期）", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();

    // 场景 A：无 IssueScene 预期时，补填预期与编辑实际表现
    const sessionA = `e2e-tkt-004a-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionA, {
      includeIssueScene: false,
    });
    await openPreviewPage(page, extensionId, sessionA);
    await openTicketModal(page);

    const addExpectedBtn = page.locator(
      "#ticket-rich-view .ticket-add-expected-btn"
    );
    await expect(addExpectedBtn).toBeVisible();
    await expect(addExpectedBtn).toHaveText("+ 补充预期表现");
    await addExpectedBtn.click();
    await page
      .locator("#ticket-rich-view .ticket-inline-input")
      .fill("提交后应跳转到详情页");
    await page.locator("#ticket-rich-view .ticket-inline-confirm").click();

    await expect(
      page.locator('[data-ticket-slot="narrative-expected"]')
    ).toHaveText("提交后应跳转到详情页");

    // 编辑实际表现
    await page.locator('[data-ticket-slot="narrative-actual"]').click();
    await page
      .locator("#ticket-rich-view .ticket-inline-input")
      .fill("点击保存后页面无响应");
    await page.locator("#ticket-rich-view .ticket-inline-confirm").click();

    await expect(
      page.locator('[data-ticket-slot="narrative-actual"]')
    ).toHaveText("点击保存后页面无响应");

    await page.locator("#ticket-tab-plain").click();
    await expect(page.locator("#ticket-plain-view")).toContainText(
      "点击保存后页面无响应"
    );
    await expect(page.locator("#ticket-plain-view")).toContainText(
      "提交后应跳转到详情页"
    );

    await page.reload();
    await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await openTicketModal(page);
    await expect(
      page.locator('[data-ticket-slot="narrative-actual"]')
    ).toHaveText("点击保存后页面无响应");
    await expect(
      page.locator('[data-ticket-slot="narrative-expected"]')
    ).toHaveText("提交后应跳转到详情页");

    // 场景 B：有 IssueScene 默认预期，清空后支持一键「还原原预期」且不改写 issueScenes
    const sessionB = `e2e-tkt-004b-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionB, {
      includeIssueScene: true,
      expectedText: "默认问题预期表现",
    });
    await openPreviewPage(page, extensionId, sessionB);
    await openTicketModal(page);

    await expect(
      page.locator('[data-ticket-slot="narrative-actual"]')
    ).toHaveText("默认问题实际表现");
    await expect(
      page.locator('[data-ticket-slot="narrative-expected"]')
    ).toHaveText("默认问题预期表现");

    await page.locator('[data-ticket-slot="narrative-expected"]').click();
    await page.locator("#ticket-rich-view .ticket-inline-input").fill("");
    await page.locator("#ticket-rich-view .ticket-inline-confirm").click();

    await expect(
      page.locator('[data-ticket-slot="narrative-expected"]')
    ).toHaveCount(0);
    const restoreExpectedBtn = page.locator(
      "#ticket-rich-view .ticket-add-expected-row .ticket-slot-reset-btn"
    );
    await expect(restoreExpectedBtn).toBeVisible();
    await expect(restoreExpectedBtn).toContainText("还原原预期");
    await restoreExpectedBtn.click();

    await expect(
      page.locator('[data-ticket-slot="narrative-expected"]')
    ).toHaveText("默认问题预期表现");

    // 验证底层 IDB issueScenes 原始记录未被覆写
    const storedScene = await page.evaluate(async (sid: string) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("web-bug-recorder", 7);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise<{
        actual?: string;
        expected?: string;
      } | null>((resolve, reject) => {
        const tx = db.transaction(["issueScenes"], "readonly");
        const req = tx.objectStore("issueScenes").get(`${sid}-scene-1`);
        req.onsuccess = () => {
          const val = req.result;
          resolve(
            val
              ? {
                  actual: val.narrative?.actual,
                  expected: val.narrative?.expected?.text,
                }
              : null
          );
        };
        req.onerror = () => reject(req.error);
      });
    }, sessionB);
    expect(storedScene).toEqual({
      actual: "默认问题实际表现",
      expected: "默认问题预期表现",
    });
  });

  test("TKT-005: 结构化裁剪（删合并步 / 仅删截图 / 删异常）与刷新持久化", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();
    const sessionId = `e2e-tkt-005-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId);
    await openPreviewPage(page, extensionId, sessionId);
    await openTicketModal(page);

    // 1. 删除第 3 步（合并步骤：click + input 2 条交互）
    const step3 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(2);
    await step3.hover();
    await step3.locator(".ticket-block-btn").nth(1).click();
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="step"]')
    ).toHaveCount(2);
    await expect(page.locator("#ticket-modal-summary")).toHaveText(
      /^2 步 · 2 图/
    );

    // 2. 仅删除第 2 步截图，保留文案
    const step2 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1);
    const step2ImgWrap = step2.locator(".ticket-image-wrapper");
    await step2ImgWrap.hover();
    await step2ImgWrap.locator(".ticket-image-remove-btn").click();

    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="step"]')
    ).toHaveCount(2);
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator('[data-ticket-slot="step-desc"]')
    ).toHaveText('点击 "Create"');
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator("img")
    ).toHaveCount(0);
    await expect(
      page.locator("#ticket-rich-view img[data-interaction-id]")
    ).toHaveCount(1);
    await expect(page.locator("#ticket-modal-summary")).toHaveText(
      /^2 步 · 1 图/
    );

    // 3. 删除 1 条 Console 报错与 1 条 500 Network
    const err1 = page
      .locator('#ticket-rich-view [data-ticket-block="console"]')
      .first();
    await err1.hover();
    await err1.locator(".ticket-block-btn").click();
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="console"]')
    ).toHaveCount(1);
    await expect(page.locator("#ticket-rich-view")).not.toContainText(
      "[TKT-ERR-DELETE]"
    );

    const net1 = page
      .locator('#ticket-rich-view [data-ticket-block="network"]')
      .first();
    await net1.hover();
    await net1.locator(".ticket-block-btn").click();
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="network"]')
    ).toHaveCount(0);

    // 4. 关闭弹窗并验证各 Tab 同步结果
    await page.locator("#ticket-modal-close-btn").click();
    await expect(page.locator("#ticket-modal")).toBeHidden();

    await page.locator('.zen-tab-btn[data-tab="steps"]').click();
    const stepCards = page.locator("#tab-pane-steps article.item");
    await expect(stepCards).toHaveCount(2);
    await expect(stepCards.nth(0).locator("img.step-shot")).toHaveCount(1);
    await expect(stepCards.nth(1).locator("img.step-shot")).toHaveCount(0);

    await page.locator('.zen-tab-btn[data-tab="console"]').click();
    const consoleRows = page.locator("#tab-pane-console .console-row");
    await expect(consoleRows).toHaveCount(1);
    await expect(consoleRows.first()).toContainText("[TKT-ERR-KEEP]");

    await page.locator('.zen-tab-btn[data-tab="network"]').click();
    const networkRows = page.locator("#tab-pane-network .network-row");
    await expect(networkRows).toHaveCount(1);
    await expect(networkRows.first()).toContainText("/api/ticket/health");

    // 5. 刷新页面后所有裁剪持久化保持不变
    await page.reload();
    await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await openTicketModal(page);
    await expect(page.locator("#ticket-modal-summary")).toHaveText(
      /^2 步 · 1 图/
    );
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="step"]')
    ).toHaveCount(2);
    await expect(
      page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .nth(1)
        .locator("img")
    ).toHaveCount(0);
    await expect(page.locator("#ticket-rich-view")).not.toContainText(
      "[TKT-ERR-DELETE]"
    );
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="network"]')
    ).toHaveCount(0);
  });

  test("TKT-006: 步骤删空兜底、撤回/重做/重置与大图查看器按键隔离", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();
    const sessionId = `e2e-tkt-006-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId, {
      includeIssueScene: true,
      expectedText: "保留的预期说明",
    });
    await openPreviewPage(page, extensionId, sessionId);
    await openTicketModal(page);

    // 1. 删除第 1 步与第 1 条 Console 报错
    const step1 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .first();
    await step1.hover();
    await step1.locator(".ticket-block-btn").nth(1).click();

    const err1 = page
      .locator('#ticket-rich-view [data-ticket-block="console"]')
      .first();
    await err1.hover();
    await err1.locator(".ticket-block-btn").click();

    const footerBtns = page.locator(
      "#ticket-modal-summary .ticket-curation-btn"
    );
    await expect(footerBtns).toHaveCount(2);
    await expect(footerBtns.nth(0)).toHaveText("");
    await expect(footerBtns.nth(0)).toHaveAttribute(
      "title",
      /^撤回 \((⌘Z|Ctrl\+Z)\)$/
    );
    await expect(footerBtns.nth(1)).toHaveText("");
    await expect(footerBtns.nth(1)).toHaveAttribute("title", "重置草稿");

    // 2. 快捷键撤回与重做
    await page.locator("#ticket-modal-title").click();
    await page.keyboard.press(`${MOD_KEY}+z`);
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="console"]')
    ).toHaveCount(2);
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="step"]')
    ).toHaveCount(2);
    await expect(footerBtns).toHaveCount(3);

    await page.keyboard.press(`${MOD_KEY}+Shift+z`);
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="console"]')
    ).toHaveCount(1);

    // 3. 大图查看器打开时 Escape 与 ⌘Z 隔离
    await page
      .locator('#ticket-rich-view [data-ticket-block="step"] img')
      .first()
      .click();
    const imageModal = page.locator("#image-modal");
    await expect(imageModal).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press(`${MOD_KEY}+z`);
    await page.keyboard.press("Escape");
    await expect(imageModal).toBeHidden();
    await expect(page.locator("#ticket-modal")).toBeVisible();
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="console"]')
    ).toHaveCount(1);

    // 4. 删空全部步骤并刷新页面（清空撤回栈），仍提供「恢复全部步骤」
    for (let i = 0; i < 2; i += 1) {
      const s = page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .first();
      await s.hover();
      await s.locator(".ticket-block-btn").nth(1).click();
    }
    const emptyNotice = page.locator(
      '#ticket-rich-view [data-ticket-empty="steps"]'
    );
    await expect(emptyNotice).toBeVisible();
    await expect(emptyNotice).toContainText("撤回");
    await expect(emptyNotice).toContainText("恢复全部步骤");

    await page.reload();
    await page.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await openTicketModal(page);
    const reloadedEmpty = page.locator(
      '#ticket-rich-view [data-ticket-empty="steps"]'
    );
    await expect(reloadedEmpty).toBeVisible();
    await expect(reloadedEmpty).toContainText("恢复全部步骤");
    await reloadedEmpty
      .locator(".ticket-inline-link", { hasText: "恢复全部步骤" })
      .click();
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="step"]')
    ).toHaveCount(3);

    // 5. 点击底部 [↺] 重置全部修改（重置后已无任何自定义裁剪，重置按钮消失，仅保留可撤回本次重置的撤回按钮）
    await page
      .locator('#ticket-modal-summary .ticket-curation-btn[title="重置草稿"]')
      .click();
    await expect(page.locator("#ticket-modal-summary")).toHaveText(
      /^3 步 · 2 图/
    );
    await expect(
      page.locator('#ticket-rich-view [data-ticket-block="console"]')
    ).toHaveCount(2);
    await expect(
      page.locator(
        '#ticket-modal-summary .ticket-curation-btn[title="重置草稿"]'
      )
    ).toHaveCount(0);
    await expect(
      page.locator("#ticket-modal-summary .ticket-curation-btn")
    ).toHaveCount(1);
  });

  test("TKT-007: 方案 A 导出 ZIP 单一数据源同步与完整性校验", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await setLocalePreference(serviceWorker, "zh-CN");
    const page = await context.newPage();
    const sessionId = `e2e-tkt-007-${Date.now()}`;
    await seedTicketSession(page, extensionId, sessionId);
    await openPreviewPage(page, extensionId, sessionId);
    await openTicketModal(page);

    // 1. 改写步骤 1 文案
    await page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(0)
      .locator('[data-ticket-slot="step-desc"]')
      .click();
    await page
      .locator("#ticket-rich-view .ticket-inline-input")
      .fill("自定义步骤一描述");
    await page.locator("#ticket-rich-view .ticket-inline-confirm").click();

    // 2. 仅删除步骤 2 截图
    const step2ImgWrap = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(1)
      .locator(".ticket-image-wrapper");
    await step2ImgWrap.hover();
    await step2ImgWrap.locator(".ticket-image-remove-btn").click();

    // 3. 删除步骤 3（合并步骤）
    const step3 = page
      .locator('#ticket-rich-view [data-ticket-block="step"]')
      .nth(2);
    await step3.hover();
    await step3.locator(".ticket-block-btn").nth(1).click();

    // 4. 删除 1 条 Console 报错
    const err1 = page
      .locator('#ticket-rich-view [data-ticket-block="console"]')
      .first();
    await err1.hover();
    await err1.locator(".ticket-block-btn").click();

    // 5. 点击「提工单并下载」，拦截 ZIP 并解压校验
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#ticket-modal-create-btn").click();
    await expect(page.locator("#ticket-modal")).toBeHidden();

    const download = await downloadPromise;
    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();

    const unzipped = unzipSync(new Uint8Array(fs.readFileSync(zipPath!)));
    const screenshotFiles = Object.keys(unzipped).filter(
      (k) =>
        k.startsWith("screenshots/") &&
        (k.endsWith(".png") || k.endsWith(".jpg"))
    );
    expect(screenshotFiles).toHaveLength(1);
    expect(unzipped[screenshotFiles[0]!]!.byteLength).toBeGreaterThan(0);

    const sessionData = parseSessionDataJs(
      strFromU8(unzipped["data/session-data.js"]!)
    );
    expect(sessionData.interactions).toHaveLength(2);
    expect(sessionData.interactions[0]?.screenshot?.status).toBe("captured");
    expect(sessionData.interactions[1]?.screenshot?.status).toBe("disabled");
    expect(sessionData.screenshotSummaries).toHaveLength(2);
    expect(sessionData.screenshotSummaries[0]?.path).toBeTruthy();
    expect(unzipped[sessionData.screenshotSummaries[0]!.path!]).toBeDefined();
    expect(sessionData.screenshotSummaries[1]?.path).toBeNull();

    expect(
      sessionData.consoleEntries.some((c) => c.text.includes("[TKT-ERR-KEEP]"))
    ).toBe(true);
    expect(
      sessionData.consoleEntries.some((c) =>
        c.text.includes("[TKT-ERR-DELETE]")
      )
    ).toBe(false);

    expect(strFromU8(unzipped["README.md"]!)).not.toContain("[TKT-ERR-DELETE]");

    const manifest = JSON.parse(
      strFromU8(unzipped["manifest.json"]!)
    ) as ExportManifest;
    const integrity = await verifyExportIntegrity(manifest, unzipped);
    expect(integrity.valid).toBe(true);
    expect(integrity.missingFiles).toEqual([]);
    expect(integrity.invalidFiles).toEqual([]);
  });

  test("TKT-008: 中英双语切换与截图浮层零重叠校验", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    try {
      await setLocalePreference(serviceWorker, "en-US");
      const sessionId = `e2e-tkt-008-${Date.now()}`;
      await seedTicketSession(page, extensionId, sessionId);
      await openPreviewPage(page, extensionId, sessionId);
      await openTicketModal(page);

      await expect(
        page.locator("#ticket-modal .ticket-modal-subtitle")
      ).toHaveText("Paste directly into TAPD, Feishu, Jira");
      await expect(page.locator("#ticket-tab-rich")).toHaveText("Preview");
      await expect(page.locator("#ticket-tab-plain")).toHaveText("Markdown");
      await expect(page.locator("#ticket-modal-summary")).toHaveText(
        /^3 steps · 2 images/
      );
      await expect(page.locator("#ticket-modal-copy-btn")).toHaveText(
        "Copy Ticket"
      );
      await expect(page.locator("#ticket-modal-create-btn")).toHaveText(
        "Create & Download"
      );

      // 步骤与异常纯图标悬停提示为英文
      const step1 = page
        .locator('#ticket-rich-view [data-ticket-block="step"]')
        .first();
      await expect(step1.locator(".ticket-block-btn").nth(0)).toHaveAttribute(
        "title",
        "Edit"
      );
      await expect(step1.locator(".ticket-block-btn").nth(1)).toHaveAttribute(
        "title",
        "Delete"
      );
      await expect(
        page
          .locator('#ticket-rich-view [data-ticket-block="console"]')
          .first()
          .locator(".ticket-block-btn")
      ).toHaveAttribute("title", "Remove");

      // 截图浮层按钮英文文案与零重叠几何校验
      const imgWrap = step1.locator(".ticket-image-wrapper");
      await imgWrap.hover();
      await expect(imgWrap.locator(".ticket-image-actions")).toHaveCSS(
        "opacity",
        "1"
      );
      const removeBtn = imgWrap.locator(".ticket-image-remove-btn");
      const copyBtn = imgWrap.locator(".ticket-image-copy-btn");
      await expect(removeBtn.locator("span")).toHaveText("Remove");
      await expect(copyBtn.locator("span")).toHaveText("Copy");

      const wrapperBox = (await imgWrap.boundingBox())!;
      const removeBox = (await removeBtn.boundingBox())!;
      const copyBox = (await copyBtn.boundingBox())!;
      expect(removeBox.x).toBeGreaterThanOrEqual(wrapperBox.x);
      expect(removeBox.x + removeBox.width + 1).toBeLessThanOrEqual(copyBox.x);
      expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(
        wrapperBox.x + wrapperBox.width + 1
      );

      // 删除一步后校验英文底部撤回/重置图标 tooltip
      await step1.hover();
      await step1.locator(".ticket-block-btn").nth(1).click();
      const footerBtns = page.locator(
        "#ticket-modal-summary .ticket-curation-btn"
      );
      await expect(footerBtns).toHaveCount(2);
      await expect(footerBtns.nth(0)).toHaveText("");
      await expect(footerBtns.nth(0)).toHaveAttribute(
        "title",
        /^Undo \((⌘Z|Ctrl\+Z)\)$/
      );
      await expect(footerBtns.nth(1)).toHaveText("");
      await expect(footerBtns.nth(1)).toHaveAttribute("title", "Reset draft");
    } finally {
      await setLocalePreference(serviceWorker, "zh-CN");
    }
  });
});
