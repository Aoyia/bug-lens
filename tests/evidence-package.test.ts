import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiPrompt,
  buildEvidencePackage,
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
