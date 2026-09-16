import assert from "node:assert/strict";
import test from "node:test";
import { h } from "preact";
import render from "preact-render-to-string";
import { RecordPanel } from "../src/components/popup/RecordPanel.tsx";
import type { RecordingSession } from "../src/shared/protocol.ts";

test("RecordPanel: 跨标签页录制时渲染目标标签页信息、提示横幅与切换按钮", () => {
  const activeSession: RecordingSession = {
    id: "session-other",
    schemaVersion: 2,
    extensionVersion: "0.7.34",
    status: "RECORDING",
    target: {
      tabId: 101,
      windowId: 1,
      initialTitle: "智建云1 | 数据管理",
      initialUrl: "https://devtest3.buildingqm.com/target",
    },
    options: {} as any,
    timeline: { createdAtEpochMs: 1000 },
    quality: { issues: [] } as any,
    nonce: "n1",
  };

  const currentTab = {
    id: 102,
    title: "智建云1 | 数据管理",
    url: "https://devtest3.buildingqm.com/current",
  } as chrome.tabs.Tab;

  const html = render(
    h(RecordPanel, {
      activeSession,
      activeTab: currentTab,
      active: true,
      ready: false,
      starting: false,
      timerText: "05:03",
      getStatusText: () => "正在录制",
      activeEvidence: () => [],
      evidenceLabel: () => "",
      evidenceStateLabel: () => "",
      onStart: () => {},
      onStop: () => {},
      onOpenPreview: () => {},
      onStartNew: () => {},
      onError: () => {},
    })
  );

  // 1. 必须渲染冲突提示横幅及当前页未录制提示
  assert.ok(
    html.includes('data-testid="recording-conflict-banner"'),
    "必须渲染冲突提示横幅"
  );
  assert.ok(
    html.includes("currentTabNotRecording") ||
      html.includes("当前标签页未在录制"),
    "必须提示当前标签页未在录制"
  );

  // 2. 主卡片必须标明后台录制目标，并显示目标 URL
  assert.ok(
    html.includes("remoteRecordingTarget") || html.includes("后台录制目标"),
    "主卡片标题必须携带后台录制目标徽标"
  );
  assert.ok(
    html.includes("https://devtest3.buildingqm.com/target"),
    "主卡片必须显示目标被录制页的 URL"
  );

  // 3. 必须提供一键切换至录制标签页的按钮，且保留 stop 按钮
  assert.ok(
    html.includes('data-testid="switch-to-recording-tab-btn"'),
    "必须渲染切换至录制标签页按钮"
  );
  assert.ok(
    html.includes('data-testid="stop-recording-btn"'),
    "必须渲染结束录制按钮"
  );
  assert.ok(
    html.includes("stopRemoteRecording") || html.includes("结束后台录制并导出"),
    "在跨标签页模式下停止按钮文案应明确为结束后台录制"
  );
});

test("RecordPanel: 同一标签页录制时不应展示冲突横幅与切换按钮", () => {
  const activeSession: RecordingSession = {
    id: "session-same",
    schemaVersion: 2,
    extensionVersion: "0.7.34",
    status: "RECORDING",
    target: {
      tabId: 101,
      windowId: 1,
      initialTitle: "智建云1 | 数据管理",
      initialUrl: "https://devtest3.buildingqm.com/target",
    },
    options: {} as any,
    timeline: { createdAtEpochMs: 1000 },
    quality: { issues: [] } as any,
    nonce: "n1",
  };

  const currentTab = {
    id: 101,
    title: "智建云1 | 数据管理",
    url: "https://devtest3.buildingqm.com/target",
  } as chrome.tabs.Tab;

  const html = render(
    h(RecordPanel, {
      activeSession,
      activeTab: currentTab,
      active: true,
      ready: false,
      starting: false,
      timerText: "05:03",
      getStatusText: () => "正在录制",
      activeEvidence: () => [],
      evidenceLabel: () => "",
      evidenceStateLabel: () => "",
      onStart: () => {},
      onStop: () => {},
      onOpenPreview: () => {},
      onStartNew: () => {},
      onError: () => {},
    })
  );

  assert.equal(
    html.includes('data-testid="recording-conflict-banner"'),
    false,
    "同标签页录制不得渲染冲突横幅"
  );
  assert.equal(
    html.includes('data-testid="switch-to-recording-tab-btn"'),
    false,
    "同标签页录制不应渲染切换标签页按钮"
  );
  assert.ok(
    html.includes('data-testid="stop-recording-btn"'),
    "同标签页录制应渲染常规结束录制按钮"
  );
  assert.equal(
    html.includes("remoteRecordingTarget") || html.includes("后台录制目标"),
    false,
    "同标签页录制不应展示后台目标徽标"
  );
});
