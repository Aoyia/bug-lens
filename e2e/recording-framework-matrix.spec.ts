import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E Recording Matrix][${new Date().toISOString()}] ${message}${suffix}`
  );
}

const FRAMEWORKS: Array<{
  framework: "vue2" | "vue3" | "react" | "react19";
  expectedFramework: "vue" | "react";
  /** 期望的框架主版本号：vue2=2, vue3=3, react18=18, react19=19。 */
  expectedVersion: number;
}> = [
  { framework: "vue2", expectedFramework: "vue", expectedVersion: 2 },
  { framework: "vue3", expectedFramework: "vue", expectedVersion: 3 },
  { framework: "react", expectedFramework: "react", expectedVersion: 18 },
  { framework: "react19", expectedFramework: "react", expectedVersion: 19 },
];

test.describe("Bug Lens Recording Matrix E2E: Vue 2/3 & React 18/19 真实录制、父链穿透、Portal 溯源与 Schema v5 终态", () => {
  test.setTimeout(90_000);

  for (const { framework, expectedFramework, expectedVersion } of FRAMEWORKS) {
    test(`REC-MATRIX (${framework}-dev): 真实录制 -> UI包装父组件穿透 -> body Portal 标点 -> 异步 settled & final 帧 -> Schema v5 CLI 闭环`, async ({
      context,
      extensionId,
      openActionPopup,
      mediaProbe,
      getAppUrl,
    }) => {
      context.on("console", (msg) => {
        if (msg.type() === "error") {
          logE2e(`Console error (${framework})`, {
            url: safeUrlForLog(msg.page()?.url()) ?? "ext",
            text: msg.text(),
          });
        }
      });

      let targetPage = context.pages()[0];
      if (!targetPage) targetPage = await context.newPage();
      await targetPage.goto(getAppUrl(framework, "dev"));
      await targetPage.waitForSelector('[data-testid="app-root"]', {
        timeout: 5_000,
      });
      await targetPage.bringToFront();
      await targetPage
        .waitForFunction(() => document.hasFocus(), undefined, {
          timeout: 2_000,
        })
        .catch(() => undefined);

      // 1. 打开 Action Popup 并启动真实录制
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

      const markIssueButton = targetPage.locator("#__wbr_issue_btn__");
      await expect(markIssueButton).toBeVisible({ timeout: 5_000 });

      // 2. 点击 UI 库包装按钮 [data-testid="el-wrapper-btn"] 触发 420ms 异步 settled 变化
      await targetPage.click('[data-testid="el-wrapper-btn"]');
      await expect(
        targetPage.locator('[data-testid="async-result"]')
      ).toHaveText("Saved OK (settled)", { timeout: 3_000 });
      // 留足智能 settled 窗口 (~350-650ms) 让 step-1-settled 与 settled framework 状态落盘
      await targetPage.waitForTimeout(700);

      // 3. 点击触发按钮打开 body Portal / Teleport 弹窗
      await targetPage.click('[data-testid="open-portal-btn"]');
      const portalDialog = targetPage.locator('[data-testid="portal-dialog"]');
      await expect(portalDialog).toBeVisible({ timeout: 3_000 });

      // 4. 在录制中触发「标记问题」并使用纯症状标签 (tag-only)
      await markIssueButton.click();
      const expectedCard = targetPage.locator("#__wbr_expected_card__");
      await expect(expectedCard).toBeVisible({ timeout: 3_000 });
      await expectedCard
        .locator('[data-expected-chip="expectedChipNoResponse"]')
        .click();
      await expectedCard.locator('[data-expected-confirm="true"]').click();

      // 5. 在 selection overlay 中框选 Portal 对话框并进入编辑提交
      const selectionOverlay = targetPage.locator("#__wbr_issue_selection__");
      await expect(selectionOverlay).toBeVisible({ timeout: 3_000 });
      const portalBox = (await portalDialog.boundingBox())!;
      expect(portalBox).toBeTruthy();

      await targetPage.mouse.click(
        portalBox.x + portalBox.width / 2,
        portalBox.y + portalBox.height / 2
      );
      const finishBtn = selectionOverlay.locator("button", {
        hasText: /进入截图|Proceed|Screenshot/i,
      });
      await expect(finishBtn).toBeVisible({ timeout: 3_000 });
      await finishBtn.click();

      const issueEditor = targetPage.locator("#__wbr_issue_editor__");
      await expect(issueEditor).toBeVisible({ timeout: 5_000 });
      // 验证 tag-only 胶囊已回显在编辑器
      await expect(
        issueEditor.locator("[data-issue-expected-pill]")
      ).toBeVisible();
      await issueEditor
        .locator("[data-issue-actual]")
        .fill(`${framework} Portal 弹层异常反馈`);
      await issueEditor.locator("[data-issue-save]").click();
      await expect(issueEditor).toBeHidden({ timeout: 5_000 });

      // 6. 点击录制停止 -> 等待静默导出 Schema v5 ZIP 完成
      await targetPage.locator("#__wbr_stop_btn__").click();
      const exported = await mediaProbe.waitForExportDownload();
      expect(exported.filename).toBeTruthy();

      const zipBuf = fs.readFileSync(exported.filename);
      const unzipped = unzipSync(new Uint8Array(zipBuf));
      const fileKeys = Object.keys(unzipped);

      // 7. 验证 Schema v5 核心产物布局
      expect(unzipped["session-data.json"]).toBeDefined();
      expect(unzipped["network-details.json"]).toBeDefined();
      expect(unzipped["README.md"]).toBeDefined();
      expect(unzipped["AI_PROMPT.md"]).toBeDefined();
      expect(unzipped["report.html"]).toBeUndefined(); // 默认 ai-minimal

      const settledShots = fileKeys.filter((k) =>
        /^screenshots\/step-\d+-settled\.jpg$/.test(k)
      );
      expect(settledShots.length).toBeGreaterThanOrEqual(1);
      expect(unzipped["screenshots/final-frame.jpg"]).toBeDefined();

      const sessionData = JSON.parse(strFromU8(unzipped["session-data.json"]!));
      expect(sessionData.schemaVersion).toBe(5);
      expect(sessionData.packMode).toBe("ai-minimal");
      expect(sessionData.interactions.length).toBeGreaterThanOrEqual(1);

      // 8. 验证框架组件与父业务链在真实录制中的提取结果
      const fwStates = sessionData.frameworkStates ?? [];
      expect(fwStates.length).toBeGreaterThanOrEqual(1);
      const matchedStates = fwStates.filter(
        (s: any) => s.framework === expectedFramework
      );
      expect(
        matchedStates.length,
        `frameworkStates 中必须存在 framework=${expectedFramework} 的快照`
      ).toBeGreaterThanOrEqual(1);

      // 8.1 父链穿透：按数据模型区分「根快照」与「非根快照」
      // FrameworkSnapshot = { rootComponent?, targetComponent?, parentChain[] }（src/shared/protocol.ts:339-343）
      // - 根快照：targetComponent 就是本次探测到的最顶层组件。start 触发的 captureFrameworkTick("start")
      //   不带元素，探针兜底命中 #app/#root（src/domain/framework-state-capture.ts:291-314），
      //   componentPath 只有 1 项 → ancestorNames=[] → rootComponent=undefined、parentChain=[]（:220-262）。
      //   这类快照天然没有父组件，断言 parentChain 非空是假红（单测 tests/framework-state-capture.test.ts 亦如此断言）。
      // - 非根快照：存在 snapshot.rootComponent（至少回溯到一级祖先）。本用例点击的 el-wrapper-btn
      //   位于 TodoList 内、TodoList 位于 App 内，因此这类快照必须穿透出 ≥1 层 parentChain。
      const targetSnapshots = matchedStates.filter(
        (s: any) => s.snapshot?.targetComponent
      );
      expect(
        targetSnapshots.length,
        "至少一个框架快照必须包含 snapshot.targetComponent"
      ).toBeGreaterThanOrEqual(1);

      const rootSnapshots: any[] = [];
      const nonRootSnapshots: any[] = [];
      for (const state of targetSnapshots) {
        const snapshot = state.snapshot;
        expect(
          String(snapshot.targetComponent.componentName ?? "").trim(),
          `快照 ${state.id} 的 targetComponent.componentName 必须非空`
        ).not.toBe("");

        const parentChain: any[] = Array.isArray(snapshot.parentChain)
          ? snapshot.parentChain
          : [];
        parentChain.forEach((node: any, index: number) => {
          expect(
            String(node?.componentName ?? "").trim(),
            `快照 ${state.id} (trigger=${state.trigger}) 的 parentChain[${index}].componentName 必须非空`
          ).not.toBe("");
        });

        const rootName = String(
          snapshot.rootComponent?.componentName ?? ""
        ).trim();
        if (rootName === "") {
          rootSnapshots.push(state);
        } else {
          nonRootSnapshots.push(state);
        }
      }

      // 核心验收点：必须至少存在一个非根快照，否则说明探针只抓到根组件、父链穿透根本没生效
      expect(
        nonRootSnapshots.length,
        "至少一个框架快照必须是「非根快照」（含 snapshot.rootComponent），否则父链穿透未生效"
      ).toBeGreaterThanOrEqual(1);
      expect(
        rootSnapshots.length + nonRootSnapshots.length,
        "根快照 + 非根快照必须覆盖全部带 targetComponent 的快照"
      ).toBe(targetSnapshots.length);

      // rootComponent = ancestorNames[0], parentChain = ancestorNames.slice(1)
      // （src/domain/framework-state-capture.ts:255-261）
      // 两层链 App > TodoList 的合法形状是 rootComponent=App + parentChain=[]
      // （tests/framework-state-capture.test.ts:487-495 有同形断言）。
      // 因此「穿透生效」的正确判据是：会话中至少有一个快照拿到了中间祖先，
      // 而不是要求每个快照都有。
      const penetrationSnapshots = targetSnapshots.filter(
        (s: any) => (s.snapshot.parentChain?.length ?? 0) >= 1
      );
      expect(penetrationSnapshots.length).toBeGreaterThanOrEqual(1);

      // 8.2 版本区分：vue2=2 / vue3=3 / react18=18 / react19=19
      // 若 react19 实测返回 18，说明框架版本探测把 React 19 误判为 18，这是真实缺陷，禁止放宽断言。
      // 版本未知（0）同样视为失败：那意味着主世界探针没拿到运行时证据。
      for (const state of targetSnapshots) {
        expect(
          state.snapshot.targetComponent.version,
          `快照 ${state.id} (trigger=${state.trigger}) 的框架主版本号必须为 ${expectedVersion}`
        ).toBe(expectedVersion);
      }

      // 验证 Issue Scene 产物及 Portal / tag-only 元数据
      expect(sessionData.issueScenes.length).toBe(1);
      const scene0 = sessionData.issueScenes[0];
      expect(scene0.scene?.narrative?.expected?.confidence).toBe("tag-only");
      expect(scene0.domContextPath).toBeTruthy();
      expect(scene0.domStylesPath).toBeTruthy();
      expect(unzipped[scene0.domContextPath]).toBeDefined();
      expect(unzipped[scene0.domStylesPath]).toBeDefined();

      const domContext = JSON.parse(
        strFromU8(unzipped[scene0.domContextPath]!)
      );
      const domStyles = JSON.parse(strFromU8(unzipped[scene0.domStylesPath]!));
      expect(domStyles.computedLayoutStyles).toBeDefined();
      expect(domContext.targetElement).toBeDefined();

      // 8.3 Portal 双向溯源：标注 body Portal 弹层时，必须能反查宿主 triggerElement，
      // 或至少给出关联浮层 relatedOverlays，二者不可同时为空。
      const portalTrigger = domContext.triggerElement;
      const portalOverlays: any[] = Array.isArray(domContext.relatedOverlays)
        ? domContext.relatedOverlays
        : [];
      const hasTriggerElement = Boolean(
        portalTrigger &&
        Object.values(portalTrigger).some(
          (value) => value !== undefined && value !== null
        )
      );
      expect(
        hasTriggerElement || portalOverlays.length > 0,
        "Portal 场景必须至少存在 triggerElement 或 relatedOverlays 之一"
      ).toBe(true);
      if (portalOverlays.length > 0) {
        expect(
          portalOverlays.some(
            (overlay) =>
              Boolean(overlay?.relationReason) || Boolean(overlay?.selectorPath)
          ),
          "relatedOverlays 至少一项必须带可识别字段 relationReason 或 selectorPath"
        ).toBe(true);
      }

      // 8.4 settled 稳定帧与 final 终态帧必须真实落盘到 ZIP
      const interactions: any[] = sessionData.interactions ?? [];
      const settledInteractions = interactions.filter(
        (item: any) =>
          typeof item.screenshots?.settledPath === "string" &&
          item.screenshots.settledPath.length > 0
      );
      expect(
        settledInteractions.length,
        "至少一条交互必须带非空 screenshots.settledPath"
      ).toBeGreaterThanOrEqual(1);
      for (const item of settledInteractions) {
        expect(
          unzipped[item.screenshots.settledPath],
          `settled 截图 ${item.screenshots.settledPath} 必须存在于 ZIP 内`
        ).toBeDefined();
      }
      const finalFramePath = sessionData.summary?.finalFramePath;
      expect(
        String(finalFramePath ?? "").length,
        "session-data.summary.finalFramePath 必须非空"
      ).toBeGreaterThan(0);
      expect(
        unzipped[finalFramePath],
        `final 帧 ${finalFramePath} 必须存在于 ZIP 内`
      ).toBeDefined();

      // 9. 通过 Preview 页面补充会话级 userNarrative
      const previewPage = await context.newPage();
      await previewPage.goto(
        `chrome-extension://${extensionId}/preview.html?sessionId=${session.id}`
      );
      await previewPage.waitForSelector("#session-narrative-actual", {
        timeout: 5_000,
      });
      await previewPage
        .locator("#session-narrative-expected")
        .fill(`${framework} 会话级预期：应正常提交并关闭弹层`);
      await previewPage.waitForTimeout(350);
      await previewPage.close();

      // 10. 端到端校验 triage-cli 打包脚本消费真实 Schema v5 ZIP
      const skillCliPath = path.resolve(
        import.meta.dirname,
        "../.agents/skills/bug-lens-triage/scripts/bug-lens-cli.mjs"
      );
      const workspaceTmp = fs.mkdtempSync(
        path.join(os.tmpdir(), `rec-matrix-${framework}-`)
      );
      try {
        const cliEnv = {
          ...process.env,
          BUG_LENS_CLI_WORKSPACE: workspaceTmp,
        };
        const openOut = execFileSync(
          process.execPath,
          [skillCliPath, "open_pack", exported.filename],
          { encoding: "utf8", env: cliEnv }
        );
        expect(openOut).toContain("# Bug Lens Evidence Pack (kind: session)");
        expect(openOut).toContain("confidence=tag-only");
        // open_pack 必须显式声明 Schema v5，避免 CLI 静默降级读取旧格式
        expect(openOut, "open_pack 输出必须包含 Schema v5 标识").toContain(
          "**Schema**: v5"
        );

        const cssOut = execFileSync(
          process.execPath,
          [skillCliPath, "get_css", "--scene", "0"],
          { encoding: "utf8", env: cliEnv }
        );
        expect(cssOut).toContain("Computed Layout Styles");

        const fwOut = execFileSync(
          process.execPath,
          [skillCliPath, "get_framework_state", "--diff"],
          { encoding: "utf8", env: cliEnv }
        );
        // 用具体组件名与分区标题替换无意义的长度断言：空 diff 也必须先有结构
        expect(fwOut).toContain("# Framework State Diff");
        expect(fwOut).toContain("## Component State Changes");
        expect(
          fwOut,
          "get_framework_state --diff 必须给出具体组件名（如 ElButton/TodoList/TodoItem/App）"
        ).toMatch(/\*\*(ElButton|TodoList|TodoItem|App)\*\*/);
      } finally {
        fs.rmSync(workspaceTmp, { recursive: true, force: true });
      }
    });
  }
});
