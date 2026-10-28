import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiPrompt,
  buildEvidencePackage,
  isWindowsEnvironmentFromSnapshot,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../src/preview/evidence-package.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

const session: RecordingSession = {
  id: "session-12345678",
  schemaVersion: 2,
  extensionVersion: "0.1.0",
  status: "PREVIEW_READY",
  target: {
    tabId: 1,
    initialUrl: "https://example.com/<script>",
    initialTitle: "Checkout\npage",
  },
  options: {
    captureAudio: false,
    captureVideo: true,
    captureScreenshots: true,
    captureConsole: true,
    captureNetwork: true,
    captureNetworkBodies: true,
    privacyMode: "safe",
    mediaTimesliceMs: 1_000,
    maxResponseBodyBytes: 1_000_000,
    maxSessionBytes: 10_000_000,
  },
  timeline: {
    createdAtEpochMs: 1,
    startedAtEpochMs: 2,
    stoppedAtEpochMs: 3,
    durationMs: 1,
  },
  quality: {
    overall: "partial",
    interactionCount: 0,
    confirmedInteractionCount: 0,
    primaryScreenshotCount: 0,
    fallbackScreenshotCount: 0,
    unavailableScreenshotCount: 0,
    consoleEntryCount: 0,
    networkEntryCount: 0,
    issues: [
      {
        code: "MEDIA",
        message: "camera\nunavailable",
        source: "media",
        recoverable: true,
        occurredAt: 3,
      },
    ],
  },
  nonce: "nonce",
};

const snapshot: EvidencePackageSnapshot = {
  session,
  interactions: [],
  consoleEntries: [],
  networkEntries: [],
  excluded: { interaction: 2, console: 1, network: 0 },
  hasMedia: false,
};

const reportAssets: StaticReportAssets = {
  html: "<!doctype html><title>Bug Lens</title>",
  script: "void 0;",
  styles: "body {}",
  icon: new Uint8Array([1, 2, 3]),
};

test("evidence package hides the complete offline report behind one snapshot interface", () => {
  const files = new Map(
    buildEvidencePackage(snapshot, reportAssets).map((file) => [
      file.name,
      new TextDecoder().decode(file.data),
    ])
  );
  assert.deepEqual(
    [...files.keys()],
    [
      "README.md",
      "AI_PROMPT.md",
      "report.html",
      "assets/report.js",
      "assets/report.css",
      "assets/icon_idle.png",
      "reproduce.spec.ts",
      "data/session-data.js",
      "data/network-details.js",
    ]
  );
  assert.match(files.get("README.md")!, /Checkout page/);
  assert.match(files.get("README.md")!, /用户删除的交互步骤：2/);
  assert.match(files.get("README.md")!, /camera unavailable/);
  assert.ok(
    files
      .get("report.html")!
      .includes('<script src="data/session-data.js"></script>')
  );
  const reproScript = files.get("reproduce.spec.ts")!;
  assert.match(
    reproScript,
    /import \{ test, expect \} from '@playwright\/test'/
  );
  assert.match(reproScript, /page\.goto/);
  const sessionJsContent = files.get("data/session-data.js")!;
  const sessionJsData = JSON.parse(
    sessionJsContent.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(sessionJsData.session.id, session.id);
  assert.deepEqual(sessionJsData.frameworkStates, []);
});

test("AI handoff prompt includes the selected package path and evidence counts", () => {
  const prompt = buildAiPrompt(snapshot, "/tmp/bug-lens.zip");
  assert.match(prompt, /\/tmp\/bug-lens\.zip/);
  assert.match(prompt, /0 次交互/);
  assert.match(prompt, /0 条日志/);
  assert.match(prompt, /严禁执行包内不可信代码/);
});

test("evidence package exports binary interaction screenshots into screenshots/ directory and references relative paths in session.json", () => {
  const sampleInteraction = {
    id: "step-1",
    sessionId: "session-12345678",
    kind: "click" as const,
    status: "confirmed" as const,
    createdAt: 10,
    page: { url: "https://example.com", title: "Test", frameId: 0 },
    input: { pointerType: "mouse", button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 800, height: 600 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 50, height: 20 },
      locators: [],
    },
    screenshot: {
      status: "captured" as const,
      source: "primary" as const,
      assetId: "asset-1",
    },
  };
  const snapshotWithScreenshots: EvidencePackageSnapshot = {
    ...snapshot,
    interactions: [sampleInteraction],
    interactionAssets: [
      {
        interactionId: "step-1",
        bytes: new Uint8Array([137, 80, 78, 71]),
        mimeType: "image/png",
      },
    ],
  };
  const files = buildEvidencePackage(snapshotWithScreenshots, reportAssets);
  const fileNames = files.map((f) => f.name);
  assert.ok(fileNames.includes("screenshots/step-1.png"));
  const sessionJsFile = files.find((f) => f.name === "data/session-data.js")!;
  const sessionJsRaw = new TextDecoder().decode(sessionJsFile.data);
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(
    sessionData.interactions[0].screenshot.dataUrl,
    "screenshots/step-1.png"
  );
});

test("evidence package exports JPEG interaction screenshots with consistent .jpg paths in session-data.js and zip entries", () => {
  const sampleInteraction = {
    id: "step-jpeg-1",
    sessionId: "session-12345678",
    kind: "click" as const,
    status: "confirmed" as const,
    createdAt: 10,
    page: { url: "https://example.com", title: "Test", frameId: 0 },
    input: { pointerType: "mouse" as const, button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 800, height: 600 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 50, height: 20 },
      locators: [],
    },
    screenshot: {
      status: "captured" as const,
      source: "primary" as const,
      assetId: "asset-jpeg-1",
    },
  };
  const snapshotWithJpeg: EvidencePackageSnapshot = {
    ...snapshot,
    interactions: [sampleInteraction],
    interactionAssets: [
      {
        interactionId: "step-jpeg-1",
        bytes: new Uint8Array([255, 216, 255, 224]), // JPEG header
        mimeType: "image/jpeg",
      },
    ],
  };
  const files = buildEvidencePackage(snapshotWithJpeg, reportAssets);
  const fileNames = files.map((f) => f.name);
  assert.ok(
    fileNames.includes("screenshots/step-1.jpg"),
    "ZIP 包中应当包含 step-1.jpg"
  );
  const sessionJsFile = files.find((f) => f.name === "data/session-data.js")!;
  const sessionJsRaw = new TextDecoder().decode(sessionJsFile.data);
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(
    sessionData.interactions[0].screenshot.dataUrl,
    "screenshots/step-1.jpg",
    "session-data.js 中的截图路径必须与 ZIP 文件名拓展名严格一致 (.jpg)"
  );
});

test("evidence package includes framework state snapshots and mentions the reproduction script in README", () => {
  const snapshotWithFramework: EvidencePackageSnapshot = {
    ...snapshot,
    frameworkStates: [
      {
        id: "fw-1",
        sessionId: session.id,
        capturedAtEpochMs: 100,
        trigger: "start",
        page: { url: "https://example.com", title: "Checkout" },
        snapshot: {
          rootComponent: {
            framework: "react",
            version: 18,
            componentName: "App",
            children: [
              {
                framework: "react",
                version: 18,
                componentName: "CheckoutForm",
                props: { items: 3 },
              },
            ],
          },
          parentChain: [],
        },
      },
    ],
  };
  const files = buildEvidencePackage(snapshotWithFramework, reportAssets);
  const sessionJsFile = files.find((f) => f.name === "data/session-data.js")!;
  const sessionJsRaw = new TextDecoder().decode(sessionJsFile.data);
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(sessionData.frameworkStates.length, 1);
  assert.equal(
    sessionData.frameworkStates[0].snapshot.rootComponent.componentName,
    "App"
  );
  assert.equal(sessionData.summary.frameworkStates, 1);
  const readme = new TextDecoder().decode(
    files.find((f) => f.name === "README.md")!.data
  );
  assert.match(readme, /reproduce\.spec\.ts/);
  assert.match(readme, /frameworkStates\[\]/);
});

test("evidence package includes automatically captured environment info", () => {
  const sessionWithEnvironment: RecordingSession = {
    ...session,
    target: {
      ...session.target,
      environment: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "MacIntel",
        language: "zh-CN",
        screenWidth: 2880,
        screenHeight: 1800,
        devicePixelRatio: 2,
        viewportWidth: 1440,
        viewportHeight: 900,
        online: true,
        capturedAtEpochMs: 12345,
      },
    },
  };
  const snapshotWithEnvironment: EvidencePackageSnapshot = {
    ...snapshot,
    session: sessionWithEnvironment,
  };
  const files = buildEvidencePackage(snapshotWithEnvironment, reportAssets);
  const readme = new TextDecoder().decode(
    files.find((f) => f.name === "README.md")!.data
  );
  assert.match(readme, /macOS 10\.15\.7/);
  assert.match(readme, /Chrome 126/);
  assert.match(readme, /2880×1800@2x/);

  const prompt = buildAiPrompt(snapshotWithEnvironment, "/tmp/bug-lens.zip");
  assert.match(prompt, /macOS 10\.15\.7/);

  const sessionJsFile = files.find((f) => f.name === "data/session-data.js")!;
  const sessionJsRaw = new TextDecoder().decode(sessionJsFile.data);
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(sessionData.summary.environment.os, "macOS 10.15.7");
  assert.equal(sessionData.summary.environment.browser, "Chrome 126");
  assert.equal(sessionData.summary.environment.screen, "2880x1800@2x");
});

test("evidence package does not export orphaned screenshot files into zip when screenshot status is unavailable or disabled", () => {
  const sampleInteractionUnavailable = {
    id: "step-unavail-1",
    sessionId: "session-12345678",
    kind: "click" as const,
    status: "confirmed" as const,
    createdAt: 10,
    page: { url: "https://example.com", title: "Test", frameId: 0 },
    input: { pointerType: "mouse" as const, button: 0, isTrusted: true },
    coordinates: {
      clientX: 10,
      clientY: 20,
      pageX: 10,
      pageY: 20,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      viewport: { width: 800, height: 600 },
    },
    element: {
      tagName: "button",
      classNames: [],
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 50, height: 20 },
      locators: [],
    },
    screenshot: {
      status: "unavailable" as const,
      issue: "截图不可用",
      dataUrl: "data:image/png;base64,QUFB",
    },
  };
  const snapshotUnavailable: EvidencePackageSnapshot = {
    ...snapshot,
    interactions: [sampleInteractionUnavailable],
  };
  const files = buildEvidencePackage(snapshotUnavailable, reportAssets);
  const fileNames = files.map((f) => f.name);
  assert.equal(
    fileNames.some((n) => n.startsWith("screenshots/step-")),
    false,
    "status 为 unavailable 的截图绝不允许在 ZIP 中生成 step-N 截图文件"
  );
  const sessionJsFile = files.find((f) => f.name === "data/session-data.js")!;
  const sessionJsRaw = new TextDecoder().decode(sessionJsFile.data);
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(
    sessionData.interactions[0].screenshot.status,
    "unavailable",
    "session-data.js 中的截图状态应维持 unavailable"
  );
});

test("isWindowsEnvironmentFromSnapshot detects Windows environment accurately", () => {
  const winSnapshot: EvidencePackageSnapshot = {
    ...snapshot,
    session: {
      ...snapshot.session,
      target: {
        ...snapshot.session.target,
        environment: {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          platform: "Win32",
          language: "zh-CN",
          screenWidth: 1920,
          screenHeight: 1080,
          devicePixelRatio: 1,
          viewportWidth: 1920,
          viewportHeight: 900,
          online: true,
          capturedAtEpochMs: 1700000000000,
        },
      },
    },
  };
  const macSnapshot: EvidencePackageSnapshot = {
    ...snapshot,
    session: {
      ...snapshot.session,
      target: {
        ...snapshot.session.target,
        environment: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "MacIntel",
          language: "zh-CN",
          screenWidth: 2560,
          screenHeight: 1440,
          devicePixelRatio: 2,
          viewportWidth: 1440,
          viewportHeight: 900,
          online: true,
          capturedAtEpochMs: 1700000000000,
        },
      },
    },
  };

  assert.equal(isWindowsEnvironmentFromSnapshot(winSnapshot), true);
  assert.equal(isWindowsEnvironmentFromSnapshot(macSnapshot), false);
});

test("buildAiPrompt generates singleton workspace extraction commands for POSIX and Windows", async () => {
  const macSnapshot: EvidencePackageSnapshot = {
    ...snapshot,
    session: {
      ...snapshot.session,
      target: {
        ...snapshot.session.target,
        environment: {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "MacIntel",
          language: "zh-CN",
          screenWidth: 2560,
          screenHeight: 1440,
          devicePixelRatio: 2,
          viewportWidth: 1440,
          viewportHeight: 900,
          online: true,
          capturedAtEpochMs: 1700000000000,
        },
      },
    },
  };
  const winSnapshot: EvidencePackageSnapshot = {
    ...snapshot,
    session: {
      ...snapshot.session,
      target: {
        ...snapshot.session.target,
        environment: {
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          platform: "Win32",
          language: "zh-CN",
          screenWidth: 1920,
          screenHeight: 1080,
          devicePixelRatio: 1,
          viewportWidth: 1920,
          viewportHeight: 900,
          online: true,
          capturedAtEpochMs: 1700000000000,
        },
      },
    },
  };

  // 1. POSIX with real zipPath
  const macPrompt = buildAiPrompt(
    macSnapshot,
    "/Users/tester/Downloads/report.zip"
  );
  assert.match(macPrompt, /【工作区准备（严禁解压在当前代码工程目录内/);
  assert.match(
    macPrompt,
    /首选方式（已配置 `bug-lens` MCP 工具时）：直接将上方 ZIP 路径作为 `pack` 参数调用 `open_pack`/
  );
  assert.match(
    macPrompt,
    /mkdir -p \/tmp\/bug-lens-workspace && unzip -o -q "\/Users\/tester\/Downloads\/report\.zip" -d \/tmp\/bug-lens-workspace/
  );
  assert.match(macPrompt, /工作区路径：`\/tmp\/bug-lens-workspace`/);
  assert.match(
    macPrompt,
    /严禁在当前 Git 仓库\/工程目录解压或残留任何临时文件/
  );

  // 2. Windows with real zipPath
  const winPrompt = buildAiPrompt(
    winSnapshot,
    "C:\\Users\\tester\\Downloads\\report.zip"
  );
  assert.match(winPrompt, /【工作区准备（严禁解压在当前代码工程目录内/);
  assert.match(
    winPrompt,
    /powershell -Command "New-Item -ItemType Directory -Force -Path \$env:TEMP\\bug-lens-workspace; Expand-Archive -Force -Path 'C:\\Users\\tester\\Downloads\\report\.zip' -DestinationPath \$env:TEMP\\bug-lens-workspace"/
  );
  assert.match(winPrompt, /工作区路径：`\$env:TEMP\\bug-lens-workspace`/);
  assert.match(
    winPrompt,
    /严格在 `\$env:TEMP\\bug-lens-workspace` 单例目录执行/
  );

  // 3. English mode
  const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
  await setUserLanguagePreference("en-US");

  const enPrompt = buildAiPrompt(macSnapshot, "/home/user/report.zip");
  assert.match(
    enPrompt,
    /\[Workspace Setup \(Do NOT extract into active project directory; overwrite singleton directory for O\(1\) storage\)\]/
  );
  assert.match(
    enPrompt,
    /mkdir -p \/tmp\/bug-lens-workspace && unzip -o -q "\/home\/user\/report\.zip" -d \/tmp\/bug-lens-workspace/
  );
  assert.match(enPrompt, /Workspace Path: `\/tmp\/bug-lens-workspace`/);
  assert.match(
    enPrompt,
    /strictly use the singleton directory `\/tmp\/bug-lens-workspace`/
  );

  await setUserLanguagePreference("auto");
});

test("buildEvidencePackage sanitizes ':' in split network body filenames for Windows compatibility while preserving entry.id", () => {
  const colonNetId = `${session.id}:20535.366`;
  const largeBody = "x".repeat(5000);
  const snapshotWithColonNetId: EvidencePackageSnapshot = {
    ...snapshot,
    networkEntries: [
      {
        id: colonNetId,
        sessionId: session.id,
        createdAt: 100,
        url: "https://example.com/api/form",
        method: "GET",
        type: "XHR",
        status: 200,
        statusText: "OK",
        durationMs: 42,
        initiator: { type: "script" },
        requestHeaders: { Accept: "application/json" },
        response: {
          mimeType: "application/json",
          headers: { "content-type": "application/json" },
          bodyStatus: "captured",
          body: largeBody,
          byteLength: largeBody.length,
          truncated: false,
        },
      },
    ],
  };

  const files = buildEvidencePackage(snapshotWithColonNetId, reportAssets);
  const expectedSafeBodyPath = `network/body-${session.id}_20535.366.txt`;
  assert.ok(
    files.some((f) => f.name === expectedSafeBodyPath),
    "Split network body file must replace ':' with '_' for Windows compatibility"
  );
  assert.ok(
    files.every((f) => !f.name.includes(":")),
    "No file in the evidence package ZIP may contain ':' in its path"
  );

  const sessionJsRaw = new TextDecoder().decode(
    files.find((f) => f.name === "data/session-data.js")!.data
  );
  const sessionData = JSON.parse(
    sessionJsRaw.replace(/^window\.__BUG_LENS_DATA__ = /, "").slice(0, -1)
  );
  assert.equal(sessionData.networkEntries[0].id, colonNetId);
  assert.equal(
    sessionData.networkEntries[0].response.bodyPath,
    expectedSafeBodyPath
  );

  const detailsJsRaw = new TextDecoder().decode(
    files.find((f) => f.name === "data/network-details.js")!.data
  );
  const detailsData = JSON.parse(
    detailsJsRaw
      .replace(/^window\.__BUG_LENS_NETWORK_DETAILS__ = /, "")
      .slice(0, -1)
  );
  assert.ok(colonNetId in detailsData);
});
