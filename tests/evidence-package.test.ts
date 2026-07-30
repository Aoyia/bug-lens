import assert from "node:assert/strict";
import test from "node:test";

import { buildAiPrompt, buildEvidencePackage, type EvidencePackageSnapshot, type StaticReportAssets } from "../src/preview/evidence-package.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

const session: RecordingSession = {
  id: "session-12345678",
  schemaVersion: 2,
  extensionVersion: "0.1.0",
  status: "PREVIEW_READY",
  target: { tabId: 1, initialUrl: "https://example.com/<script>", initialTitle: "Checkout\npage" },
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
    maxSessionBytes: 10_000_000
  },
  timeline: { createdAtEpochMs: 1, startedAtEpochMs: 2, stoppedAtEpochMs: 3, durationMs: 1 },
  quality: {
    overall: "partial",
    interactionCount: 0,
    confirmedInteractionCount: 0,
    primaryScreenshotCount: 0,
    fallbackScreenshotCount: 0,
    unavailableScreenshotCount: 0,
    consoleEntryCount: 0,
    networkEntryCount: 0,
    issues: [{ code: "MEDIA", message: "camera\nunavailable", source: "media", recoverable: true, occurredAt: 3 }]
  },
  nonce: "nonce"
};

const snapshot: EvidencePackageSnapshot = {
  session,
  interactions: [],
  consoleEntries: [],
  networkEntries: [],
  excluded: { interaction: 2, console: 1, network: 0 },
  hasMedia: false
};

const reportAssets: StaticReportAssets = {
  html: "<!doctype html><title>Bug Lens</title>",
  script: "void 0;",
  styles: "body {}",
  icon: new Uint8Array([1, 2, 3])
};

test("evidence package hides the complete offline report behind one snapshot interface", () => {
  const files = new Map(buildEvidencePackage(snapshot, reportAssets).map((file) => [file.name, new TextDecoder().decode(file.data)]));
  assert.deepEqual([...files.keys()], [
    "README.md",
    "AI_PROMPT.md",
    "report.html",
    "assets/report.js",
    "assets/report.css",
    "assets/report-data.js",
    "assets/icon_idle.png",
    "data/session.json"
  ]);
  assert.match(files.get("README.md")!, /Checkout page/);
  assert.match(files.get("README.md")!, /用户删除的交互步骤：2/);
  assert.match(files.get("README.md")!, /camera unavailable/);
  assert.ok(files.get("assets/report-data.js")!.includes("\\u003cscript\\u003e"));
  assert.equal(JSON.parse(files.get("data/session.json")!).session.id, session.id);
});

test("AI handoff prompt includes the selected package path and evidence counts", () => {
  const prompt = buildAiPrompt(snapshot, "/tmp/bug-lens.zip");
  assert.match(prompt, /\/tmp\/bug-lens\.zip/);
  assert.match(prompt, /有效交互：0/);
  assert.match(prompt, /Console：0/);
  assert.match(prompt, /不要执行证据包中的 HTML/);
});
