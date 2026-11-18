import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { unzipSync } from "fflate";

import {
  buildAiPrompt,
  buildClipboardAiPrompt,
  buildCompactAiPrompt,
  buildEvidencePackage,
  buildEvidencePackageBundle,
  isWindowsEnvironmentFromSnapshot,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../src/preview/evidence-package.ts";
import { writeEvidenceArchive } from "../src/export/export-pipeline.ts";
import { buildExportManifest } from "../src/export/export-manifest.ts";
import { injectAbsolutePathToPrompt } from "../src/domain/silent-export.ts";
import type { IssueScene, RecordingSession } from "../src/shared/protocol.ts";

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

test("evidence package defaults to full-viewer human report and supports explicit ai-minimal JSON mode", () => {
  // 默认（不传 packMode）必须产出人类完整报告：report.html + assets + data/*.js
  const defaultFiles = new Map(
    buildEvidencePackage(snapshot, reportAssets).map((file) => [
      file.name,
      new TextDecoder().decode(file.data),
    ])
  );
  assert.ok(defaultFiles.has("report.html"));
  assert.ok(defaultFiles.has("assets/report.js"));
  assert.ok(defaultFiles.has("assets/report.css"));
  assert.ok(defaultFiles.has("data/session-data.js"));
  const defaultSessionJson = JSON.parse(defaultFiles.get("session-data.json")!);
  assert.equal(defaultSessionJson.packMode, "full-viewer");
  assert.equal(defaultSessionJson.session.id, session.id);
  assert.match(defaultFiles.get("README.md")!, /双击 `report\.html`/);

  const aiFiles = new Map(
    buildEvidencePackage(snapshot, reportAssets, {
      packMode: "ai-minimal",
    }).map((file) => [file.name, new TextDecoder().decode(file.data)])
  );
  assert.deepEqual(
    [...aiFiles.keys()],
    [
      "README.md",
      "AI_PROMPT.md",
      "TICKET.md",
      "reproduce.spec.ts",
      "session-data.json",
      "network-details.json",
    ]
  );
  const aiSessionJson = JSON.parse(aiFiles.get("session-data.json")!);
  assert.equal(aiSessionJson.schemaVersion, 5);
  assert.equal(aiSessionJson.packMode, "ai-minimal");
  assert.equal(aiSessionJson.session.id, session.id);
  assert.doesNotMatch(aiFiles.get("README.md")!, /双击 `report\.html`/);

  const files = new Map(
    buildEvidencePackage(snapshot, reportAssets, {
      packMode: "full-viewer",
    }).map((file) => [file.name, new TextDecoder().decode(file.data)])
  );
  assert.deepEqual(
    [...files.keys()],
    [
      "README.md",
      "AI_PROMPT.md",
      "TICKET.md",
      "reproduce.spec.ts",
      "session-data.json",
      "network-details.json",
      "report.html",
      "assets/report.js",
      "assets/report.css",
      "assets/icon_idle.png",
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
  const sessionJsonFile = files.find((f) => f.name === "session-data.json")!;
  const sessionData = JSON.parse(
    new TextDecoder().decode(sessionJsonFile.data)
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
  const sessionJsonFile = files.find((f) => f.name === "session-data.json")!;
  const sessionData = JSON.parse(
    new TextDecoder().decode(sessionJsonFile.data)
  );
  assert.equal(
    sessionData.interactions[0].screenshot.dataUrl,
    "screenshots/step-1.jpg",
    "session-data.json 中的截图路径必须与 ZIP 文件名拓展名严格一致 (.jpg)"
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
  const sessionJsonFile = files.find((f) => f.name === "session-data.json")!;
  const sessionData = JSON.parse(
    new TextDecoder().decode(sessionJsonFile.data)
  );
  assert.equal(sessionData.frameworkStates.length, 1);
  assert.equal(
    sessionData.frameworkStates[0].snapshot.rootComponent.componentName,
    "App"
  );
  assert.equal(sessionData.summary.metrics.frameworkStateCount, 1);
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

  const sessionJsonFile = files.find((f) => f.name === "session-data.json")!;
  const sessionData = JSON.parse(
    new TextDecoder().decode(sessionJsonFile.data)
  );
  assert.equal(sessionData.summary.environment.os, "macOS 10.15.7");
  assert.equal(sessionData.summary.environment.browser, "Chrome 126");
  assert.equal(sessionData.summary.environment.screen, "2880x1800@2x");
  assert.deepEqual(sessionData.summary.environment.viewport, {
    width: 1440,
    height: 900,
    dpr: 2,
  });
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
  const sessionJsonFile = files.find((f) => f.name === "session-data.json")!;
  const sessionData = JSON.parse(
    new TextDecoder().decode(sessionJsonFile.data)
  );
  assert.equal(
    sessionData.interactions[0].screenshot.status,
    "unavailable",
    "session-data.json 中的截图状态应维持 unavailable"
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
    /首选方式（已安装 `bug-lens-triage` Skill 时）：直接使用该技能内置的 `node "<skillDir>\/scripts\/bug-lens-cli\.mjs" open_pack/
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

test("buildEvidencePackage stores response bodies in CAS blobs without ':' while preserving entry.id and emits settled/final frames", () => {
  const colonNetId = `${session.id}:20535.366`;
  const largeBody = "x".repeat(5000);
  const snapshotWithColonNetId: EvidencePackageSnapshot = {
    ...snapshot,
    interactions: [
      {
        id: "int-with-settled",
        sessionId: session.id,
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
          assetId: "asset-instant",
        },
      },
    ],
    interactionAssets: [
      {
        interactionId: "int-with-settled",
        kind: "interaction-screenshot",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]),
        mimeType: "image/jpeg",
      },
      {
        interactionId: "int-with-settled",
        kind: "interaction-settled",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 2]),
        mimeType: "image/jpeg",
      },
    ],
    finalFrameAsset: {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3]),
      mimeType: "image/jpeg",
    },
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
  assert.ok(
    files.some((f) => /^network\/blobs\/[a-f0-9]{16}\.bin$/.test(f.name)),
    "Network response body must be stored under CAS network/blobs/<sha256:16>.bin"
  );
  assert.ok(
    files.every((f) => !f.name.includes(":")),
    "No file in the evidence package ZIP may contain ':' in its path"
  );
  assert.ok(files.some((f) => f.name === "screenshots/step-1.jpg"));
  assert.ok(files.some((f) => f.name === "screenshots/step-1-settled.jpg"));
  assert.ok(files.some((f) => f.name === "screenshots/final-frame.jpg"));

  const sessionData = JSON.parse(
    new TextDecoder().decode(
      files.find((f) => f.name === "session-data.json")!.data
    )
  );
  assert.equal(sessionData.networkEntries[0].id, colonNetId);
  assert.match(
    sessionData.networkEntries[0].response.bodyHash,
    /^[a-f0-9]{16}$/
  );
  assert.equal(
    sessionData.summary.finalFramePath,
    "screenshots/final-frame.jpg"
  );
  assert.equal(
    sessionData.interactions[0].screenshots.settledPath,
    "screenshots/step-1-settled.jpg"
  );

  const detailsData = JSON.parse(
    new TextDecoder().decode(
      files.find((f) => f.name === "network-details.json")!.data
    )
  );
  assert.ok(colonNetId in detailsData);
  assert.equal(
    detailsData[colonNetId].bodyBlob.path,
    `network/blobs/${sessionData.networkEntries[0].response.bodyHash}.bin`
  );
});

test("buildClipboardAiPrompt keeps standard output identical unless compact is selected", () => {
  const zip = "/Users/tester/Downloads/report.zip";
  const standard = buildAiPrompt(snapshot, zip);
  assert.equal(buildClipboardAiPrompt(snapshot, zip), standard);
  assert.equal(
    buildClipboardAiPrompt(snapshot, zip, {
      promptTemplate: "standard",
      targetAssistant: "claude-code",
      customInstructions: "团队规范",
    }),
    standard
  );
  assert.equal(
    buildClipboardAiPrompt(snapshot, zip, { promptTemplate: "compact" }),
    buildCompactAiPrompt(snapshot, zip)
  );
});

test("buildCompactAiPrompt routes Skill -> auto install -> unzip fallback and stays short", async () => {
  const zip = "/Users/tester/Downloads/report.zip";
  const prompt = buildCompactAiPrompt(snapshot, zip, {
    customInstructions: "优先排查鉴权",
  });

  // ZIP 路径只出现一次，静默导出时绝对路径注入可整体生效
  assert.equal(prompt.split(zip).length - 1, 1);
  assert.match(prompt, /文件路径：\n\/Users\/tester\/Downloads\/report\.zip/);
  assert.equal(
    injectAbsolutePathToPrompt(
      buildCompactAiPrompt(snapshot, "report.zip"),
      "report.zip",
      "/abs/report.zip"
    ).includes("文件路径：\n/abs/report.zip"),
    true
  );

  assert.match(prompt, /当前已加载 bug-lens-triage Skill/);
  assert.match(prompt, /npx -y skills add Aoyia\/bug-lens-skill -g -y/);
  assert.match(prompt, /~\/\.agents\/skills\/bug-lens-triage\/SKILL\.md/);
  assert.match(
    prompt,
    /mkdir -p \/tmp\/bug-lens-workspace && unzip -o -q "<ZIP>" -d \/tmp\/bug-lens-workspace/
  );
  assert.match(prompt, /\/tmp\/bug-lens-workspace\/AI_PROMPT\.md/);
  assert.match(prompt, /\[团队定制诊断规范 \/ 补充指引\]\n优先排查鉴权/);
  assert.doesNotMatch(prompt, /issueScenes\[\]/);
  assert.ok(prompt.length < 1000, `compact prompt too long: ${prompt.length}`);

  // 无标记现场时提示改用时间轴线索
  const noScene = buildCompactAiPrompt({ ...snapshot, issueScenes: [] }, zip);
  assert.match(noScene, /本包无标记现场/);

  // Claude Code 降级 ASCII 图
  assert.match(
    buildCompactAiPrompt(snapshot, zip, { targetAssistant: "claude-code" }),
    /使用 ASCII，不用 mermaid/
  );

  // Windows 路径
  const winPrompt = buildCompactAiPrompt(
    {
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
    },
    "C:\\Users\\tester\\Downloads\\report.zip"
  );
  assert.match(
    winPrompt,
    /%USERPROFILE%\\\.agents\\skills\\bug-lens-triage\\SKILL\.md/
  );
  assert.match(winPrompt, /Expand-Archive -Force -Path '<ZIP>'/);

  // 英文
  const { setUserLanguagePreference } = await import("../src/shared/i18n.ts");
  await setUserLanguagePreference("en-US");
  const enPrompt = buildCompactAiPrompt(snapshot, zip);
  assert.match(enPrompt, /File Path:\n\/Users\/tester\/Downloads\/report\.zip/);
  assert.match(enPrompt, /If the bug-lens-triage Skill is loaded/);
  await setUserLanguagePreference("auto");

  // promptLanguage 显式覆盖界面语言
  const forcedEn = buildCompactAiPrompt(snapshot, zip, {
    promptLanguage: "en-US",
  });
  assert.match(forcedEn, /File Path:\n\/Users\/tester\/Downloads\/report\.zip/);
  const forcedZh = buildCompactAiPrompt(snapshot, zip, {
    promptLanguage: "zh-CN",
  });
  assert.match(forcedZh, /文件路径：\n\/Users\/tester\/Downloads\/report\.zip/);
});

// ---------------------------------------------------------------------------
// TICKET.md：包内工单（研发版 + 客户版）
// ---------------------------------------------------------------------------

type ZhDict = Record<
  string,
  { message: string; placeholders?: Record<string, { content: string }> }
>;

function readLocaleDict(locale: "zh_CN" | "en"): ZhDict {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as ZhDict;
}

/**
 * 用真实 zh_CN messages.json 装扮 chrome.i18n，
 * 让 t() 走正常词条解析（而不是 Node 下的裸 key 兜底），
 * 从而验证 TICKET.md 的脚手架文案确实来自 i18n。
 */
function installZhI18n(): () => void {
  const dict = readLocaleDict("zh_CN");
  const previousChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    i18n: {
      getUILanguage: () => "zh-CN",
      getMessage: (key: string) => dict[key]?.message ?? "",
    },
  };
  return () => {
    if (previousChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = previousChrome;
    }
  };
}

function makeIssueScene(overrides?: Partial<IssueScene>): IssueScene {
  return {
    id: "scene-1",
    sessionId: session.id,
    status: "committed",
    observedAtEpochMs: 3,
    page: {
      url: "https://example.com/orders",
      title: "Orders",
      frameId: 0,
      viewport: { width: 1280, height: 800 },
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
    },
    target: {
      capturedAtEpochMs: 3,
      element: {
        tagName: "button",
        id: "save-btn",
        classNames: ["btn-primary"],
        attributes: {},
        text: "Save",
        boundingBox: { x: 0, y: 0, width: 80, height: 32 },
        locators: [
          {
            kind: "css",
            expression: "#save-btn",
            matchCount: 1,
            stabilityScore: 0.9,
            reasons: [],
          },
        ],
        framework: {
          rootComponent: {
            framework: "react",
            version: 18,
            componentName: "OrderForm",
            componentFile: "src/components/Foo.tsx",
          },
          targetComponent: {
            framework: "react",
            version: 18,
            componentName: "Foo",
            componentFile: "src/components/Foo.tsx",
          },
          parentChain: [],
        },
      },
      ancestors: [],
      state: {},
      computedStyle: {},
    },
    narrative: {
      actual: "点击保存后页面崩溃，报错来自 src/components/Foo.tsx 的渲染异常",
      expected: {
        text: "点击保存后应弹出成功提示",
        confidence: "explicit",
      },
    },
    annotation: {
      type: "arrow-box",
      color: "#ef233c",
      point: { xRatio: 0.5, yRatio: 0.5 },
    },
    screenshot: { status: "captured", annotatedAssetId: "asset-1" },
    issues: [],
    ...overrides,
  };
}

test("TICKET.md is generated in both packModes with internal and customer sections", () => {
  const restoreI18n = installZhI18n();
  try {
    const zh = readLocaleDict("zh_CN");
    const scene = makeIssueScene();
    const sceneSnapshot: EvidencePackageSnapshot = {
      ...snapshot,
      issueScenes: [scene],
    };
    const sceneAssets: StaticReportAssets = reportAssets;

    for (const packMode of ["full-viewer", "ai-minimal"] as const) {
      const files = new Map(
        buildEvidencePackage(sceneSnapshot, sceneAssets, { packMode }).map(
          (file) => [file.name, new TextDecoder().decode(file.data)]
        )
      );
      assert.ok(files.has("TICKET.md"), `${packMode} 必须包含 TICKET.md`);

      const ticket = files.get("TICKET.md")!;
      assert.match(ticket, new RegExp(`^# ${zh.ticketMdTitle.message}`));
      assert.ok(
        ticket.includes(zh.ticketMdInternalHeading.message),
        "TICKET.md 必须含研发版段"
      );
      assert.ok(
        ticket.includes(zh.ticketMdCustomerHeading.message),
        "TICKET.md 必须含客户版段"
      );
      assert.ok(
        ticket.includes(zh.ticketMdCustomerWarning.message),
        "客户版段必须带人工确认提示"
      );

      const customerHeading = `## ${zh.ticketMdCustomerHeading.message}`;
      const parts = ticket.split(customerHeading);
      assert.equal(parts.length, 2, "客户版标题只应出现一次");
      const [internalPart, customerPart] = parts;

      // 研发版保留技术细节（含源码路径），客户版必须脱敏
      assert.ok(
        internalPart.includes("src/components/Foo.tsx"),
        "研发版应保留组件源码路径"
      );
      assert.ok(
        !customerPart.includes("src/components/Foo.tsx"),
        "客户版不得带出组件源码路径"
      );
      assert.ok(
        !customerPart.includes("https://example.com"),
        "客户版不得带出页面 URL"
      );
    }
  } finally {
    restoreI18n();
  }
});

test("TICKET.md falls back to the auto draft when the scene has no ticketDraft or no scene at all", () => {
  const restoreI18n = installZhI18n();
  try {
    const zh = readLocaleDict("zh_CN");

    // 老包：scenario 没有 ticketDraft
    const legacyScene = makeIssueScene();
    assert.equal(legacyScene.ticketDraft, undefined);
    const files = new Map(
      buildEvidencePackage({ ...snapshot, issueScenes: [legacyScene] }).map(
        (file) => [file.name, new TextDecoder().decode(file.data)]
      )
    );
    const legacyTicket = files.get("TICKET.md")!;
    assert.ok(legacyTicket.includes(zh.ticketMdCustomerHeading.message));
    assert.ok(legacyTicket.includes("点击保存后页面崩溃"));

    // 连问题现场都没有时也不能抛错
    assert.doesNotThrow(() =>
      buildEvidencePackage({ ...snapshot, issueScenes: [] })
    );
    const emptyFiles = new Map(
      buildEvidencePackage({ ...snapshot, issueScenes: undefined }).map(
        (file) => [file.name, new TextDecoder().decode(file.data)]
      )
    );
    assert.ok(emptyFiles.has("TICKET.md"));
    assert.ok(
      emptyFiles.get("TICKET.md")!.includes(zh.ticketMdInternalHeading.message)
    );
  } finally {
    restoreI18n();
  }
});

test("manifest.files covers TICKET.md with a 64-char sha256 and matching byteLength", async () => {
  const chunks: Uint8Array[] = [];
  const packageFiles = buildEvidencePackage(
    { ...snapshot, issueScenes: [makeIssueScene()] },
    reportAssets,
    { packMode: "ai-minimal" }
  );
  await writeEvidenceArchive({
    files: packageFiles,
    sessionId: snapshot.session.id,
    mediaSource: {
      async iterateMediaChunks() {
        return 0;
      },
    },
    includeMedia: false,
    sink: {
      async write(chunk) {
        chunks.push(chunk);
      },
      async close() {},
      async abort() {
        assert.fail("archive should not abort");
      },
    },
    createManifest: (integrity) => ({
      name: "manifest.json",
      data: new TextEncoder().encode(
        JSON.stringify(
          buildExportManifest(snapshot.session, integrity, {
            format: "bug-lens-evidence-pack",
            packMode: "ai-minimal",
            extensionVersion: snapshot.session.extensionVersion,
          }),
          null,
          2
        )
      ),
    }),
  });

  const total = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const unzipped = unzipSync(archive);
  const manifest = JSON.parse(
    new TextDecoder().decode(unzipped["manifest.json"])
  );
  const entry = manifest.files["TICKET.md"];
  assert.ok(entry, "manifest.files 必须包含 TICKET.md");
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.equal(entry.byteLength, unzipped["TICKET.md"]!.byteLength);
});

test("customer preview confirm hint is wired through i18n in both locales", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = readLocaleDict(locale);
    assert.ok(
      dict.ticketCustomerConfirmHint?.message,
      `${locale}/messages.json 缺少 ticketCustomerConfirmHint`
    );
    for (const key of [
      "ticketMdTitle",
      "ticketMdIntro",
      "ticketMdInternalHeading",
      "ticketMdCustomerHeading",
      "ticketMdCustomerWarning",
    ]) {
      assert.ok(dict[key]?.message, `${locale}/messages.json 缺少 ${key}`);
    }
  }

  const html = fs.readFileSync(
    path.resolve(process.cwd(), "src/entrypoints/preview/index.html"),
    "utf8"
  );
  assert.match(
    html,
    /id="ticket-customer-confirm"[^>]*data-i18n="ticketCustomerConfirmHint"/s,
    "客户版提示节点必须走 data-i18n 词条"
  );
});
