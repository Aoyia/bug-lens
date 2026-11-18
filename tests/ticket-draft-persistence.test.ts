import test from "node:test";
import assert from "node:assert/strict";

import { PreviewSessionRuntime } from "../src/preview/preview-session-runtime.ts";
import type { IssueScene } from "../src/shared/protocol.ts";

function createSession() {
  return {
    id: "sess-ticket-draft",
    schemaVersion: 5,
    extensionVersion: "0.7.41",
    status: "PREVIEW_READY",
    target: {
      tabId: 1,
      initialUrl: "https://example.test",
      initialTitle: "App",
    },
    options: {
      captureAudio: false,
      captureVideo: false,
      captureScreenshots: true,
      captureConsole: true,
      captureNetwork: true,
      captureNetworkBodies: false,
      privacyMode: "safe",
      mediaTimesliceMs: 1000,
      maxResponseBodyBytes: 1000,
      maxSessionBytes: 1_000_000,
    },
    timeline: {
      createdAtEpochMs: 1000,
      startedAtEpochMs: 1000,
      stoppedAtEpochMs: 2500,
    },
    quality: {
      overall: "complete",
      interactionCount: 0,
      confirmedInteractionCount: 0,
      primaryScreenshotCount: 0,
      fallbackScreenshotCount: 0,
      unavailableScreenshotCount: 0,
      consoleEntryCount: 0,
      networkEntryCount: 0,
      issues: [],
    },
    nonce: "n1",
  } as any;
}

function createScene(): IssueScene {
  return {
    id: "scene-draft-1",
    sessionId: "sess-ticket-draft",
    status: "committed",
    observedAtEpochMs: 1200,
    page: {
      url: "https://example.test",
      title: "App",
      frameId: 0,
      viewport: { width: 1280, height: 720 },
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
    },
    target: {} as any,
    narrative: { actual: "点击提交无反应" },
    annotation: {} as any,
    screenshot: { status: "captured" },
    issues: [],
  };
}

function createRuntime(saved: IssueScene[]) {
  const session = createSession();
  const scene = createScene();
  return {
    scene,
    runtime: new PreviewSessionRuntime({
      getSession: async () => session,
      saveSession: async () => {},
      getInteractions: async () => [],
      getExportSelection: async () => undefined,
      saveExportSelection: async () => {},
      getConsole: async () => [],
      getNetwork: async () => [],
      getIssueScenes: async () => [scene],
      getEvidenceAssets: async () => [],
      getEvidenceAssetsForSession: async () => [],
      getMediaSummary: async () => ({
        count: 0,
        bytes: 0,
        mimeType: "video/webm",
      }),
      getMediaChunks: async () => [],
      getFrameworkStates: async () => [],
      saveNetwork: async () => {},
      saveIssueScene: async (next) => {
        saved.push(next);
      },
    }),
  };
}

test("saveTicketDraft: 落盘到 IssueScene 并同步内存快照", async () => {
  const saved: IssueScene[] = [];
  const { runtime, scene } = createRuntime(saved);
  await runtime.load("sess-ticket-draft", { forExport: true });

  await runtime.saveTicketDraft(scene.id, {
    symptom: "登录后一直转圈",
    impact: "影响全部线上收银台",
    isBug: "是缺陷",
    workaround: "引导用户重新下单",
    eta: "本周五",
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, scene.id);
  assert.deepEqual(
    {
      symptom: saved[0].ticketDraft?.symptom,
      impact: saved[0].ticketDraft?.impact,
      isBug: saved[0].ticketDraft?.isBug,
      workaround: saved[0].ticketDraft?.workaround,
      eta: saved[0].ticketDraft?.eta,
    },
    {
      symptom: "登录后一直转圈",
      impact: "影响全部线上收银台",
      isBug: "是缺陷",
      workaround: "引导用户重新下单",
      eta: "本周五",
    }
  );
  assert.equal(typeof saved[0].ticketDraft?.updatedAtEpochMs, "number");

  const snapshot = runtime.getPackageSnapshot();
  assert.equal(
    snapshot?.issueScenes?.[0].ticketDraft?.impact,
    "影响全部线上收银台"
  );
  assert.equal(snapshot?.issueScenes?.[0].ticketDraft?.eta, "本周五");
});

test("saveTicketDraft: 未知 sceneId / 存储不支持写时静默跳过不抛错", async () => {
  const saved: IssueScene[] = [];
  const { runtime, scene } = createRuntime(saved);
  await runtime.load("sess-ticket-draft", { forExport: true });

  await runtime.saveTicketDraft("scene-not-exist", { impact: "x" });
  assert.equal(saved.length, 0);

  // 老测试替身 / 老环境没有 saveIssueScene 时也不应抛错
  const runtimeWithoutWrite = new PreviewSessionRuntime({
    getSession: async () => createSession(),
    saveSession: async () => {},
    getInteractions: async () => [],
    getExportSelection: async () => undefined,
    saveExportSelection: async () => {},
    getConsole: async () => [],
    getNetwork: async () => [],
    getIssueScenes: async () => [scene],
    getEvidenceAssets: async () => [],
    getEvidenceAssetsForSession: async () => [],
    getMediaSummary: async () => ({
      count: 0,
      bytes: 0,
      mimeType: "video/webm",
    }),
    getMediaChunks: async () => [],
    getFrameworkStates: async () => [],
    saveNetwork: async () => {},
  });
  await runtimeWithoutWrite.load("sess-ticket-draft", { forExport: true });
  await runtimeWithoutWrite.saveTicketDraft(scene.id, { impact: "仍可写内存" });
  assert.equal(
    runtimeWithoutWrite.getPackageSnapshot()?.issueScenes?.[0].ticketDraft
      ?.impact,
    "仍可写内存"
  );
});
