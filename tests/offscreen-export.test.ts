import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildEvidencePackage,
  type EvidencePackageSnapshot,
  type StaticReportAssets,
} from "../src/preview/evidence-package.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

const OFFSCREEN_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/offscreen/index.ts"
);

test("offscreen 导出不能使用空的静态模板占位 stub，必须调用 loadStaticReportAssets", () => {
  const source = readFileSync(OFFSCREEN_SOURCE, "utf8");

  // 禁止将静态模板硬编码为空对象
  assert.ok(
    !source.includes('html: ""') && !source.includes('script: ""'),
    "offscreen/index.ts 中不得包含空的 reportAssets stub"
  );

  // 必须引入并调用 loadStaticReportAssets
  assert.ok(
    source.includes("loadStaticReportAssets"),
    "offscreen/index.ts 必须引入并使用 loadStaticReportAssets"
  );
  assert.ok(
    source.includes("await loadStaticReportAssets()"),
    "exportPack 必须异步等待 loadStaticReportAssets() 完成"
  );
});

test("buildEvidencePackage 在传入静态模板时输出完整非空的 report.html/css/js", () => {
  const session: RecordingSession = {
    id: "session-test",
    schemaVersion: 2,
    extensionVersion: "0.7.2",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.com",
      initialTitle: "Test Page",
    },
    options: {
      captureAudio: false,
      captureVideo: true,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: true,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 100000,
      maxSessionBytes: 1000000,
    },
    timeline: {
      createdAtEpochMs: 1,
      startedAtEpochMs: 2,
      stoppedAtEpochMs: 3,
      durationMs: 1,
    },
    quality: {
      overall: "good",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "test-nonce",
  };

  const snapshot: EvidencePackageSnapshot = {
    session,
    interactions: [],
    consoleEntries: [],
    networkEntries: [],
    excluded: { interaction: 0, console: 0, network: 0 },
    hasMedia: false,
  };

  const reportAssets: StaticReportAssets = {
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Bug Lens</title></head><body><div id="app"></div><script id="__BUG_LENS_DATA__" type="application/json"></script></body></html>`,
    script: "console.log('report init');",
    styles: "body { background: #000; }",
    icon: new Uint8Array([1, 2, 3]),
    localeMessages: { appTitle: { message: "测试报告" } },
  };

  const files = buildEvidencePackage(snapshot, reportAssets);
  const fileMap = new Map(files.map((f) => [f.name, f.data]));

  const html = new TextDecoder().decode(fileMap.get("report.html")!);
  const script = new TextDecoder().decode(fileMap.get("assets/report.js")!);
  const styles = new TextDecoder().decode(fileMap.get("assets/report.css")!);
  const icon = fileMap.get("assets/icon_idle.png")!;

  assert.ok(html.includes("<!doctype html>"));
  assert.ok(html.includes('<div id="app"></div>'));
  assert.ok(html.includes("data/session-data.js"));
  assert.ok(html.includes("data/network-details.js"));
  assert.ok(html.includes("__WEB_BUG_REPORT_I18N__"));
  assert.equal(script, "console.log('report init');");
  assert.equal(styles, "body { background: #000; }");
  assert.deepEqual(icon, new Uint8Array([1, 2, 3]));
});
