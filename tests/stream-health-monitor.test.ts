import assert from "node:assert/strict";
import test from "node:test";

import { StreamHealthMonitor } from "../src/recording/stream-health-monitor.ts";

function mockChrome() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve(),
      setIcon: () => Promise.resolve()
    },
    tabs: {
      sendMessage: () => Promise.resolve()
    }
  };
}

test("初始化状态应推导为 RECORDING", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.getHealth();
  assert.equal(health.code, "RECORDING");
  assert.equal(health.badgeText, "REC");
  assert.equal(health.badgeColor, "#d92d20");
  assert.deepEqual(health.streams, {
    media: "ok",
    cdp: "ok",
    content: "ok",
    storage: "ok"
  });
});

test("当 content reconnecting 时应推导为 RECONNECTING", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.updateStream("content", "reconnecting");
  assert.equal(health.code, "RECONNECTING");
  assert.equal(health.badgeText, "LINK");
  assert.equal(health.badgeColor, "#eaaa08");
});

test("当 cdp disrupted 时应推导为 PARTIAL_DISRUPTION", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.updateStream("cdp", "disrupted");
  assert.equal(health.code, "PARTIAL_DISRUPTION");
  assert.equal(health.badgeText, "PART");
  assert.equal(health.badgeColor, "#f79009");
});

test("当 media disrupted 时应推导为 VIDEO_DISRUPTED", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.updateStream("media", "disrupted");
  assert.equal(health.code, "VIDEO_DISRUPTED");
  assert.equal(health.badgeText, "NO_V");
  assert.equal(health.badgeColor, "#f04438");
});

test("当 storage disrupted (配额>=90%) 时应推导为 STORAGE_NEAR_LIMIT", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.updateStream("storage", "disrupted");
  assert.equal(health.code, "STORAGE_NEAR_LIMIT");
  assert.equal(health.badgeText, "FULL");
  assert.equal(health.badgeColor, "#f79009");
});

test("当 content 或 storage failed 时应推导为 UNRECOVERABLE", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  monitor.initialize(123, "session-1", { captureVideo: true, captureConsoleOrNetwork: true });
  const health = monitor.updateStream("storage", "failed");
  assert.equal(health.code, "UNRECOVERABLE");
  assert.equal(health.badgeText, "ERR");
  assert.equal(health.badgeColor, "#101828");
});

test("StreamHealthMonitor getSessionId 和 reset 方法正确管理当前 Session 生命周期", () => {
  mockChrome();
  const monitor = new StreamHealthMonitor();
  assert.equal(monitor.getSessionId(), undefined);

  monitor.initialize(123, "session-test", { captureVideo: true, captureConsoleOrNetwork: true });
  assert.equal(monitor.getSessionId(), "session-test");

  monitor.reset(123);
  assert.equal(monitor.getSessionId(), undefined);
});
