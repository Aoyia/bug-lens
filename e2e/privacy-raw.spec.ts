import { test, expect, safeUrlForLog } from "./fixtures/extension.ts";
import type { CdpPopup } from "./fixtures/cdp-popup.ts";

function logE2e(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(
    `[Bug Lens E2E][${new Date().toISOString()}] ${message}${suffix}`
  );
}

async function waitForPopupChecked(
  popup: CdpPopup,
  selector: string,
  expected: boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checked = await popup.evaluate<boolean>(
      `Boolean(document.querySelector(${JSON.stringify(selector)})?.checked)`
    );
    if (checked === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const actual = await popup.evaluate<boolean>(
    `Boolean(document.querySelector(${JSON.stringify(selector)})?.checked)`
  );
  throw new Error(
    `ACTION_POPUP_CHECKBOX_TIMEOUT: ${selector} expected=${expected} actual=${actual}`
  );
}

test.describe("Bug Lens Chrome Extension E2E PRIV-002: Raw Mode Risk Warning & Evidence Semantics", () => {
  test("PRIV-002: raw mode cancel & confirm branches, password security boundary, and evidence validation", async ({
    context,
    extensionId,
    openActionPopup,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const emailCanary = `canary-user-${runId}@test-privacy-raw.org`;
    const passwordCanary = `P@ssw0rd-Canary-Raw-${runId}-Secret!`;
    const tokenCanary = `Bearer-Token-Canary-Raw-${runId}-AbCdEf12345`;
    const apiKeyCanary = `ApiKey-Canary-Raw-${runId}-XyZ987654321`;
    const nestedSecretCanary = `Nested-Secret-Canary-Raw-${runId}-TopSecret999`;

    const canaries = [
      { name: "emailCanary", value: emailCanary },
      { name: "passwordCanary", value: passwordCanary },
      { name: "tokenCanary", value: tokenCanary },
      { name: "apiKeyCanary", value: apiKeyCanary },
      { name: "nestedSecretCanary", value: nestedSecretCanary },
    ];

    logE2e("Generated PRIV-002 synthetic test canaries", {
      runId,
      canaryCount: canaries.length,
    });

    const privacyUrl = serverUrl.replace(
      "mock-page.html",
      `privacy-page.html?token=${encodeURIComponent(tokenCanary)}&email=${encodeURIComponent(emailCanary)}`
    );

    context.on("console", (message) => {
      logE2e(`Browser console.${message.type()}`, {
        url:
          safeUrlForLog(message.page()?.url()) ?? "extension-worker-or-popup",
      });
    });

    let targetPage = context.pages()[0];
    if (!targetPage) targetPage = await context.newPage();
    await targetPage.goto(privacyUrl);
    await targetPage.bringToFront();
    await targetPage.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 2_000,
    });

    await targetPage.evaluate(
      ({ apiKey, secret }) => {
        (window as unknown as Record<string, string>).__CANARY_API_KEY__ =
          apiKey;
        (window as unknown as Record<string, string>).__CANARY_NESTED_SECRET__ =
          secret;
      },
      { apiKey: apiKeyCanary, secret: nestedSecretCanary }
    );

    const targetTabId = await activeTabId();
    expect(targetTabId).toBeTruthy();

    const baselineSessionCount = await mediaProbe.sessionCount();
    logE2e("Initial environment state recorded", { baselineSessionCount });

    // ==========================================
    // 1. Raw 模式直接录制（不再弹二次确认窗）
    // ==========================================
    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    if (!(await popup.isVisible(".privacy-select"))) {
      await popup.click("#toggle-options");
    }
    await popup.waitForSelector(".privacy-select");

    await popup.selectOptionByKeys(".privacy-select", "raw");
    const selectedMode = await popup.evaluate<string>(
      "document.querySelector('.privacy-select')?.value || ''"
    );
    expect(selectedMode).toBe("raw");

    // raw 模式改为内联警告，不应再出现 confirm 弹窗
    await popup.waitForSelector(".raw-mode-inline-warning");
    expect(await popup.isVisible(".raw-mode-inline-warning")).toBe(true);
    const inlineWarning = await popup.text(".raw-mode-inline-warning");
    expect(inlineWarning).toContain("原始模式");
    expect(inlineWarning).toContain("未脱敏");

    await popup.click("#video");
    await waitForPopupChecked(popup, "#video", false);

    await popup.click("#screenshots");
    await waitForPopupChecked(popup, "#screenshots", false);

    logE2e("Configured Raw mode options", {
      privacyMode: "raw",
      video: false,
      screenshots: false,
    });

    // 点击 Start Recording 直接开始录制（无二次确认弹窗）
    await popup.click('[data-testid="start-recording-btn"]');
    expect(await popup.isVisible(".confirm-overlay")).toBe(false);
    await popup.dispose();

    // 等待 Session 建立
    const session = await mediaProbe.waitForSession(targetTabId!);
    expect(session.status).toBe("RECORDING");
    expect(session.options.privacyMode).toBe("raw");
    expect(session.options.captureVideo).toBe(false);
    expect(session.options.captureScreenshots).toBe(false);
    expect(session.options.captureConsole).toBe(true);
    expect(session.options.captureNetwork).toBe(true);
    expect(session.options.captureNetworkBodies).toBe(true);

    // 环境信息由页面主帧自动附带，无需用户手动填写
    expect(session.target.environment).toBeTruthy();
    expect(session.target.environment?.userAgent).toContain("Mozilla");
    expect(session.target.environment?.screenWidth).toBeGreaterThan(0);
    expect(session.target.environment?.viewportWidth).toBeGreaterThan(0);

    const sessionCountAfterConfirm = await mediaProbe.sessionCount();
    expect(sessionCountAfterConfirm).toBe(baselineSessionCount + 1);

    logE2e("Raw mode session created without secondary confirmation", {
      sessionId: session.id,
      privacyMode: session.options.privacyMode,
      environment: session.target.environment
        ? {
            screen: `${session.target.environment.screenWidth}x${session.target.environment.screenHeight}`,
            viewport: `${session.target.environment.viewportWidth}x${session.target.environment.viewportHeight}`,
          }
        : undefined,
    });

    // ==========================================
    // 3. 执行真实页面敏感数据操作
    // ==========================================
    await targetPage.bringToFront();
    await targetPage.fill('[data-testid="email-input"]', emailCanary);
    await targetPage.fill('[data-testid="password-input"]', passwordCanary);
    await targetPage.fill('[data-testid="token-input"]', tokenCanary);

    await targetPage.click('[data-testid="send-sensitive-request-btn"]');
    await expect(
      targetPage.locator('[data-testid="status-output"]')
    ).toHaveText("请求完成", { timeout: 5_000 });

    logE2e("Target page sensitive operations completed in raw mode");

    // 轮询等待 Network / interaction 证据成功落盘，代替固定 sleep
    await mediaProbe.waitForEvidenceCounts(session.id, {
      networkCount: 1,
      interactionCount: 3,
    });

    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    const previewPagePromise = context.waitForEvent("page", {
      predicate: (page) =>
        page.url().startsWith(`chrome-extension://${extensionId}/preview.html`),
      timeout: 10_000,
    });
    await stopButton.click();
    const previewPage = await previewPagePromise;
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    // ==========================================
    // 4. IndexedDB Raw 证据语义验证
    // ==========================================
    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);

    expect(fullEvidence.session?.status).toBe("PREVIEW_READY");
    expect(fullEvidence.session?.options.privacyMode).toBe("raw");

    // 1. Initial URL 保留 query 参数
    const initialUrlHasToken =
      fullEvidence.session?.target.initialUrl.includes(
        encodeURIComponent(tokenCanary)
      ) ?? false;
    const initialUrlHasEmail =
      fullEvidence.session?.target.initialUrl.includes(
        encodeURIComponent(emailCanary)
      ) ?? false;
    expect(initialUrlHasToken, "initialUrl retains token query param").toBe(
      true
    );
    expect(initialUrlHasEmail, "initialUrl retains email query param").toBe(
      true
    );

    // 2. 普通输入 interactions 保留原始 Canary
    const inputInteractions = fullEvidence.interactions.filter(
      (i) => i.kind === "input" || i.kind === "change"
    );
    const emailInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "email-input" ||
        i.element.locators.some((l) => l.expression.includes("email-input"))
    );
    expect(emailInteraction).toBeDefined();
    expect(
      emailInteraction?.metadata?.value === emailCanary,
      "email interaction value retains raw emailCanary"
    ).toBe(true);

    const tokenInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "token-input" ||
        i.element.locators.some((l) => l.expression.includes("token-input"))
    );
    expect(tokenInteraction).toBeDefined();
    expect(
      tokenInteraction?.metadata?.value === tokenCanary,
      "token interaction value retains raw tokenCanary"
    ).toBe(true);

    // 3. 密码输入框安全边界：interaction metadata 不保存明文密码
    const passwordInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "password-input" ||
        i.element.locators.some((l) => l.expression.includes("password-input"))
    );
    expect(passwordInteraction).toBeDefined();
    expect(
      passwordInteraction?.metadata?.value,
      "password interaction value must be undefined in raw mode"
    ).toBeUndefined();
    const passwordTextHasPlaintext = (
      passwordInteraction?.element.text ?? ""
    ).includes(passwordCanary);
    expect(
      passwordTextHasPlaintext,
      "password element text must not retain plaintext password"
    ).toBe(false);

    // 4. Console 记录保留 Canary 原文
    const targetConsoleLog = fullEvidence.consoleEntries.find((entry) =>
      entry.text.includes("[PRIV-001 Log Marker]")
    );
    expect(targetConsoleLog).toBeDefined();
    const logHasEmail = targetConsoleLog?.text.includes(emailCanary) ?? false;
    const logHasToken = targetConsoleLog?.text.includes(tokenCanary) ?? false;
    const logHasApiKey = targetConsoleLog?.text.includes(apiKeyCanary) ?? false;
    expect(logHasEmail, "console log retains emailCanary").toBe(true);
    expect(logHasToken, "console log retains tokenCanary").toBe(true);
    expect(logHasApiKey, "console log retains apiKeyCanary").toBe(true);

    // 5. Network 记录在 Raw 模式下保留 Query, Headers, RequestBody, ResponseBody 原值
    const targetNetwork = fullEvidence.networkEntries.find((entry) =>
      entry.url.includes("/api/privacy-test")
    );
    expect(targetNetwork).toBeDefined();
    const netUrlHasToken =
      targetNetwork?.url.includes(`token=${encodeURIComponent(tokenCanary)}`) ??
      false;
    const netUrlHasEmail =
      targetNetwork?.url.includes(`email=${encodeURIComponent(emailCanary)}`) ??
      false;
    expect(netUrlHasToken, "network url retains token query param").toBe(true);
    expect(netUrlHasEmail, "network url retains email query param").toBe(true);

    const authHeader =
      targetNetwork?.requestHeaders?.["authorization"] ||
      targetNetwork?.requestHeaders?.["Authorization"] ||
      "";
    const apiKeyHeader =
      targetNetwork?.requestHeaders?.["x-api-key"] ||
      targetNetwork?.requestHeaders?.["X-Api-Key"] ||
      "";
    expect(
      authHeader.includes(tokenCanary),
      "authorization header retains tokenCanary"
    ).toBe(true);
    expect(
      apiKeyHeader.includes(apiKeyCanary),
      "x-api-key header retains apiKeyCanary"
    ).toBe(true);

    const reqBodyHasEmail =
      targetNetwork?.requestBody?.includes(emailCanary) ?? false;
    const reqBodyHasPassword =
      targetNetwork?.requestBody?.includes(passwordCanary) ?? false;
    const reqBodyHasToken =
      targetNetwork?.requestBody?.includes(tokenCanary) ?? false;
    const reqBodyHasApiKey =
      targetNetwork?.requestBody?.includes(apiKeyCanary) ?? false;
    const reqBodyHasNestedSecret =
      targetNetwork?.requestBody?.includes(nestedSecretCanary) ?? false;
    expect(reqBodyHasEmail, "requestBody retains emailCanary").toBe(true);
    expect(reqBodyHasPassword, "requestBody retains passwordCanary").toBe(true);
    expect(reqBodyHasToken, "requestBody retains tokenCanary").toBe(true);
    expect(reqBodyHasApiKey, "requestBody retains apiKeyCanary").toBe(true);
    expect(
      reqBodyHasNestedSecret,
      "requestBody retains nestedSecretCanary"
    ).toBe(true);

    const resBodyHasEmail =
      targetNetwork?.response?.body?.includes(emailCanary) ?? false;
    const resBodyHasPassword =
      targetNetwork?.response?.body?.includes(passwordCanary) ?? false;
    const resBodyHasNestedSecret =
      targetNetwork?.response?.body?.includes(nestedSecretCanary) ?? false;
    expect(resBodyHasEmail, "responseBody retains emailCanary").toBe(true);
    expect(resBodyHasPassword, "responseBody retains passwordCanary").toBe(
      true
    );
    expect(
      resBodyHasNestedSecret,
      "responseBody retains nestedSecretCanary"
    ).toBe(true);

    logE2e("Raw evidence semantics assertions passed");

    // ==========================================
    // 5. Preview UI 界面验证 (无敏感值泄露)
    // ==========================================
    await previewPage.waitForSelector(".zen-app-frame", { timeout: 10_000 });

    await previewPage.locator('[data-tab="console"]').click();
    await expect(previewPage.locator("#tab-pane-console")).toContainText(
      "[PRIV-001 Log Marker]"
    );

    await previewPage.locator('[data-tab="network"]').click();
    await expect(previewPage.locator("#tab-pane-network")).toContainText(
      "/api/privacy-test"
    );

    const networkRow = previewPage
      .locator("#tab-pane-network .network-row[data-network-id]")
      .first();
    await expect(networkRow).toBeVisible();
    await networkRow.click();

    const detailPanel = previewPage.locator(".network-detail-panel");
    await expect(detailPanel).toBeVisible();

    // 验证五个 Canary 均包含在 detailText 中，不直接展开敏感字符串到 log 管道
    const detailText = await detailPanel.innerText();
    expect(
      detailText.includes(tokenCanary),
      "network detail retains tokenCanary"
    ).toBe(true);
    expect(
      detailText.includes(emailCanary),
      "network detail retains emailCanary"
    ).toBe(true);
    expect(
      detailText.includes(passwordCanary),
      "network detail retains passwordCanary"
    ).toBe(true);
    expect(
      detailText.includes(apiKeyCanary),
      "network detail retains apiKeyCanary"
    ).toBe(true);
    expect(
      detailText.includes(nestedSecretCanary),
      "network detail retains nestedSecretCanary"
    ).toBe(true);

    await expect(previewPage.locator("body")).not.toContainText("未知错误");
    await expect(previewPage.locator("body")).not.toContainText("加载失败");

    logE2e("PRIV-002 Raw mode E2E test completely passed!");
  });
});
