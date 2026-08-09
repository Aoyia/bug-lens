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

function countCanaryOccurrences(obj: unknown, canary: string): number {
  if (!canary) return 0;
  let count = 0;
  function walk(value: unknown, depth = 0): void {
    if (depth > 50 || value == null) return;
    if (typeof value === "string") {
      let idx = 0;
      while ((idx = value.indexOf(canary, idx)) !== -1) {
        count += 1;
        idx += canary.length;
      }
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") return;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const val of Object.values(value)) walk(val, depth + 1);
    }
  }
  walk(obj);
  return count;
}

test.describe("Bug Lens Chrome Extension E2E PRIV-001: Safe Mode Sensitive Data Redaction", () => {
  test("PRIV-001: end-to-end synthetic sensitive data redaction in safe mode", async ({
    context,
    extensionId,
    openActionPopup,
    activeTabId,
    mediaProbe,
    serverUrl,
  }) => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const emailCanary = `canary-user-${runId}@test-privacy-safe.org`;
    const passwordCanary = `P@ssw0rd-Canary-${runId}-Secret!`;
    const tokenCanary = `Bearer-Token-Canary-${runId}-AbCdEf12345`;
    const apiKeyCanary = `ApiKey-Canary-${runId}-XyZ987654321`;
    const nestedSecretCanary = `Nested-Secret-Canary-${runId}-TopSecret999`;

    const canaries = [
      { name: "emailCanary", value: emailCanary, length: emailCanary.length },
      {
        name: "passwordCanary",
        value: passwordCanary,
        length: passwordCanary.length,
      },
      { name: "tokenCanary", value: tokenCanary, length: tokenCanary.length },
      {
        name: "apiKeyCanary",
        value: apiKeyCanary,
        length: apiKeyCanary.length,
      },
      {
        name: "nestedSecretCanary",
        value: nestedSecretCanary,
        length: nestedSecretCanary.length,
      },
    ];

    logE2e("Generated test synthetic canaries", {
      runId,
      canaryCounts: canaries.length,
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

    const popup = await openActionPopup(targetPage);
    await popup.waitForSelector('[data-testid="record-panel"]');
    await popup.click("#toggle-options");
    await popup.waitForSelector(".privacy-select");
    const privacyModeVal = await popup.evaluate<string>(
      "document.querySelector('.privacy-select')?.value || ''"
    );
    expect(privacyModeVal).toBe("safe");

    await popup.click("#video");
    await waitForPopupChecked(popup, "#video", false);

    await popup.click("#screenshots");
    await waitForPopupChecked(popup, "#screenshots", false);
    const autoExportChecked = await popup.evaluate<boolean>(
      "Boolean(document.querySelector('#opt-auto-export')?.checked)"
    );
    if (autoExportChecked) {
      await popup.click("#opt-auto-export");
      await waitForPopupChecked(popup, "#opt-auto-export", false);
    }

    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#console')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#network')?.checked)"
      )
    ).toBe(true);
    expect(
      await popup.evaluate<boolean>(
        "Boolean(document.querySelector('#bodies')?.checked)"
      )
    ).toBe(true);

    logE2e("Safe mode options configured", {
      privacyMode: "safe",
      video: false,
      screenshots: false,
      console: true,
      network: true,
      networkBodies: true,
    });

    await popup.click('[data-testid="start-recording-btn"]');
    await popup.dispose();

    const session = await mediaProbe.waitForSession(targetTabId!);
    expect(session.status).toBe("RECORDING");
    expect(session.options.privacyMode).toBe("safe");
    expect(session.options.captureVideo).toBe(false);
    expect(session.options.captureAudio).toBe(false);
    expect(session.options.captureScreenshots).toBe(false);
    expect(session.options.captureConsole).toBe(true);
    expect(session.options.captureNetwork).toBe(true);
    expect(session.options.captureNetworkBodies).toBe(true);

    await targetPage.bringToFront();
    await targetPage.fill('[data-testid="email-input"]', emailCanary);
    await targetPage.fill('[data-testid="password-input"]', passwordCanary);
    await targetPage.fill('[data-testid="token-input"]', tokenCanary);

    await targetPage.click('[data-testid="send-sensitive-request-btn"]');
    await expect(
      targetPage.locator('[data-testid="status-output"]')
    ).toHaveText("请求完成", { timeout: 5_000 });

    logE2e("Synthetic sensitive interactions and fetch completed");

    await targetPage.waitForTimeout(1_000);
    const stopButton = targetPage.locator("#__wbr_stop_btn__");
    await expect(stopButton).toBeVisible();

    await stopButton.click();
    await mediaProbe.waitForSessionStatus(session.id, "PREVIEW_READY");
    let previewPage = context
      .pages()
      .find((p) => p.url().includes("preview.html"));
    if (!previewPage) {
      previewPage = await context.newPage();
      await previewPage.goto(
        `chrome-extension://${extensionId}/preview.html?id=${session.id}`
      );
    }
    await previewPage.waitForLoadState("domcontentloaded");
    await previewPage.bringToFront();

    const fullEvidence = await mediaProbe.persistedFullEvidence(session.id);
    const summaryEvidence = await mediaProbe.persistedEvidence(
      previewPage,
      session.id
    );

    logE2e("Persisted IndexedDB evidence loaded", {
      sessionId: session.id,
      sessionStatus: fullEvidence.session?.status,
      qualityOverall: fullEvidence.session?.quality.overall,
      qualityIssues: fullEvidence.session?.quality.issues,
      mediaChunks: fullEvidence.mediaChunks.length,
      interactionCount: fullEvidence.interactions.length,
      consoleCount: fullEvidence.consoleEntries.length,
      networkCount: fullEvidence.networkEntries.length,
      assetCount: fullEvidence.evidenceAssets.length,
    });

    expect(fullEvidence.session?.status).toBe("PREVIEW_READY");
    expect(fullEvidence.session?.quality.overall).toBe("complete");
    expect(fullEvidence.session?.quality.issues).toEqual([]);
    expect(fullEvidence.mediaChunks).toEqual([]);
    expect(
      fullEvidence.evidenceAssets.filter(
        (asset) => asset.kind === "interaction-screenshot"
      )
    ).toEqual([]);

    expect(fullEvidence.session?.options.captureVideo).toBe(false);
    expect(fullEvidence.session?.options.captureAudio).toBe(false);
    expect(fullEvidence.session?.options.captureScreenshots).toBe(false);
    expect(fullEvidence.session?.options.captureConsole).toBe(true);
    expect(fullEvidence.session?.options.captureNetwork).toBe(true);
    expect(fullEvidence.session?.options.captureNetworkBodies).toBe(true);
    expect(fullEvidence.session?.options.privacyMode).toBe("safe");

    for (const c of canaries) {
      expect(fullEvidence.session?.target.initialUrl.includes(c.value)).toBe(
        false
      );
      expect(fullEvidence.session?.target.initialTitle.includes(c.value)).toBe(
        false
      );
      expect(JSON.stringify(fullEvidence.session).includes(c.value)).toBe(
        false
      );
    }

    expect(fullEvidence.interactions.length).toBeGreaterThan(0);
    const inputInteractions = fullEvidence.interactions.filter(
      (i) => i.kind === "input" || i.kind === "change"
    );
    expect(inputInteractions.length).toBeGreaterThan(0);

    const emailInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "email-input" ||
        i.element.locators.some((l) => l.expression.includes("email-input"))
    );
    expect(emailInteraction).toBeDefined();
    expect(emailInteraction?.metadata?.value).toBeUndefined();
    expect(emailInteraction?.metadata?.valueRedacted).toBe(true);
    expect(emailInteraction?.metadata?.valueLength).toBe(emailCanary.length);

    const passwordInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "password-input" ||
        i.element.locators.some((l) => l.expression.includes("password-input"))
    );
    expect(passwordInteraction).toBeDefined();
    expect(passwordInteraction?.metadata?.value).toBeUndefined();
    expect(passwordInteraction?.metadata?.valueRedacted).toBe(true);
    expect(passwordInteraction?.metadata?.valueLength).toBe(
      passwordCanary.length
    );
    expect(passwordInteraction?.element.text ?? "").not.toContain(
      passwordCanary
    );
    expect(passwordInteraction?.element.accessibleName ?? "").not.toContain(
      passwordCanary
    );
    expect(JSON.stringify(passwordInteraction?.element.locators)).not.toContain(
      passwordCanary
    );
    expect(
      JSON.stringify(passwordInteraction?.element.attributes)
    ).not.toContain(passwordCanary);

    const tokenInteraction = inputInteractions.find(
      (i) =>
        i.element.id === "token-input" ||
        i.element.locators.some((l) => l.expression.includes("token-input"))
    );
    expect(tokenInteraction).toBeDefined();
    expect(tokenInteraction?.metadata?.value).toBeUndefined();
    expect(tokenInteraction?.metadata?.valueRedacted).toBe(true);
    expect(tokenInteraction?.metadata?.valueLength).toBe(tokenCanary.length);

    for (const interaction of fullEvidence.interactions) {
      expect(interaction.screenshot.status).toBe("disabled");
      expect(interaction.screenshot.assetId).toBeUndefined();
      for (const c of canaries) {
        expect(JSON.stringify(interaction).includes(c.value)).toBe(false);
      }
    }

    expect(fullEvidence.consoleEntries.length).toBeGreaterThan(0);
    const targetConsoleLog = fullEvidence.consoleEntries.find((entry) =>
      entry.text.includes("[PRIV-001 Log Marker]")
    );
    expect(targetConsoleLog).toBeDefined();
    for (const c of canaries) {
      expect(targetConsoleLog?.text.includes(c.value)).toBe(false);
    }
    expect(targetConsoleLog?.text).toContain("[REDACTED");

    expect(fullEvidence.networkEntries.length).toBeGreaterThan(0);
    const targetNetwork = fullEvidence.networkEntries.find((entry) =>
      entry.url.includes("/api/privacy-test")
    );
    expect(targetNetwork).toBeDefined();
    expect(targetNetwork?.method).toBe("POST");
    expect(targetNetwork?.status).toBe(200);
    expect(targetNetwork?.url).toContain("token=[REDACTED]");
    expect(targetNetwork?.url).toContain("email=[REDACTED]");
    expect(targetNetwork?.url).not.toContain(tokenCanary);
    expect(targetNetwork?.url).not.toContain(emailCanary);

    expect(targetNetwork?.requestHeaders).toBeDefined();
    const authHeader =
      targetNetwork?.requestHeaders?.["authorization"] ||
      targetNetwork?.requestHeaders?.["Authorization"];
    const apiKeyHeader =
      targetNetwork?.requestHeaders?.["x-api-key"] ||
      targetNetwork?.requestHeaders?.["X-Api-Key"];
    expect(authHeader).toBeDefined();
    expect(authHeader).not.toContain(tokenCanary);
    expect(authHeader).toContain("[REDACTED");
    expect(apiKeyHeader).toBeDefined();
    expect(apiKeyHeader).not.toContain(apiKeyCanary);
    expect(apiKeyHeader).toContain("[REDACTED");

    const contentTypeHeader =
      targetNetwork?.requestHeaders?.["content-type"] ||
      targetNetwork?.requestHeaders?.["Content-Type"];
    expect(contentTypeHeader).toBe("application/json");

    expect(targetNetwork?.requestBody).toBeDefined();
    for (const c of canaries) {
      expect(targetNetwork?.requestBody?.includes(c.value)).toBe(false);
    }
    expect(targetNetwork?.requestBody).toContain("email");
    expect(targetNetwork?.requestBody).toContain("password");
    expect(targetNetwork?.requestBody).toContain("[REDACTED");

    expect(targetNetwork?.response).toBeDefined();
    expect(targetNetwork?.response?.bodyStatus).toBe("captured");
    expect(targetNetwork?.response?.body).toBeDefined();
    expect(targetNetwork?.response?.body).toContain("requestId");
    expect(targetNetwork?.response?.body).toContain("req-privacy-12345");
    for (const c of canaries) {
      expect(targetNetwork?.response?.body?.includes(c.value)).toBe(false);
    }

    const canaryLeakCounts: Record<string, number> = {};
    let totalLeaks = 0;
    for (const c of canaries) {
      const occurrencesInSession = countCanaryOccurrences(
        fullEvidence.session,
        c.value
      );
      const occurrencesInInteractions = countCanaryOccurrences(
        fullEvidence.interactions,
        c.value
      );
      const occurrencesInConsole = countCanaryOccurrences(
        fullEvidence.consoleEntries,
        c.value
      );
      const occurrencesInNetwork = countCanaryOccurrences(
        fullEvidence.networkEntries,
        c.value
      );
      const occurrencesInAssets = countCanaryOccurrences(
        fullEvidence.evidenceAssets,
        c.value
      );
      const sum =
        occurrencesInSession +
        occurrencesInInteractions +
        occurrencesInConsole +
        occurrencesInNetwork +
        occurrencesInAssets;
      canaryLeakCounts[c.name] = sum;
      totalLeaks += sum;
    }

    logE2e("Global Canary leak scan completed", {
      canaryLeakCounts,
      totalLeaks,
    });

    expect(totalLeaks).toBe(0);

    await previewPage.waitForSelector(".zen-app-frame", { timeout: 10_000 });
    await expect(previewPage.locator("#video")).toBeHidden();
    await expect(previewPage.locator("#video-empty")).toHaveText(
      /没有可播放的媒体分片|No playable media chunks|正在读取/
    );

    const summaryInteractions = summaryEvidence.interactionCount;
    expect(summaryInteractions).toBe(fullEvidence.interactions.length);
    expect(summaryEvidence.consoleCount).toBe(
      fullEvidence.consoleEntries.length
    );
    expect(summaryEvidence.networkCount).toBe(
      fullEvidence.networkEntries.length
    );

    await previewPage.locator('[data-tab="console"]').click();
    await previewPage.locator('[data-tab="network"]').click();
    await expect(previewPage.locator("#tab-pane-network")).toBeVisible();

    const detailPanel = previewPage.locator(".network-detail-panel");
    const networkRow = previewPage.locator(".network-row").first();
    if ((await networkRow.count()) > 0) {
      await expect(networkRow).toBeVisible();
      await networkRow.click();
      await expect(detailPanel).toBeVisible();
    }

    const detailText = await detailPanel.innerText();
    for (const c of canaries) {
      expect(detailText.includes(c.value)).toBe(false);
    }

    const previewBodyText = await previewPage.evaluate(
      () => document.body.innerText
    );
    for (const c of canaries) {
      expect(previewBodyText.includes(c.value)).toBe(false);
    }

    await expect(previewPage.locator("body")).not.toContainText("未知错误");
    await expect(previewPage.locator("body")).not.toContainText("加载失败");

    logE2e("PRIV-001 Safe mode E2E test assertions completely passed!");
  });
});
