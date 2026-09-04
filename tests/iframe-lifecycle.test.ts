import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach, mock } from "node:test";
import { ensureScreenshotOverlayBridge } from "../src/entrypoints/content/content-bridge.ts";
import { IframeActivityReporter } from "../src/entrypoints/content/collector/iframe-activity-reporter.ts";

describe("iframe 生命周期与 UI 防冲突隔离 (R1)", () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  test("ensureScreenshotOverlayBridge 在非顶层窗口 (window.top !== window) 拒绝注册", () => {
    const topWin: any = {};
    const childWin: any = {
      top: topWin,
    };
    (globalThis as any).window = childWin;

    let messageListenerRegistered = false;
    const registered = ensureScreenshotOverlayBridge({
      createOverlay: () => ({}) as any,
      onMessage: () => {
        messageListenerRegistered = true;
      },
      sendMessage: async () => ({}),
    });

    assert.equal(
      registered,
      false,
      "子 iframe 中 ensureScreenshotOverlayBridge 应返回 false"
    );
    assert.equal(
      messageListenerRegistered,
      false,
      "子 iframe 中不应注册任何消息监听器"
    );
    assert.equal(
      childWin.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__,
      undefined,
      "不应设置截图监听器标志"
    );
  });

  test("ensureScreenshotOverlayBridge 在顶层窗口 (window.top === window) 正常注册", () => {
    const topWin: any = {};
    topWin.top = topWin;
    (globalThis as any).window = topWin;

    let messageListenerRegistered = false;
    const registered = ensureScreenshotOverlayBridge({
      createOverlay: () => ({}) as any,
      onMessage: () => {
        messageListenerRegistered = true;
      },
      sendMessage: async () => ({}),
    });

    assert.equal(
      registered,
      true,
      "顶层窗口中 ensureScreenshotOverlayBridge 应返回 true"
    );
    assert.equal(messageListenerRegistered, true, "顶层窗口中应注册消息监听器");
    assert.equal(
      topWin.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__,
      true,
      "顶层窗口应标记已监听"
    );
  });

  test("IframeActivityReporter 在顶层窗口启动时不注册监听器", () => {
    const topWin: any = {
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
    };
    topWin.top = topWin;
    (globalThis as any).window = topWin;

    const reporter = new IframeActivityReporter();
    reporter.start();

    assert.equal(
      topWin.addEventListener.mock.callCount(),
      0,
      "顶层窗口下 IframeActivityReporter 不应注册任何 DOM 事件监听"
    );
  });

  test("IframeActivityReporter 在子 iframe 启动并进行 1500ms 节流上报", () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      const listeners: Record<string, (e: any) => void> = {};
      const topWin: any = {};
      const childWin: any = {
        top: topWin,
        addEventListener: (type: string, fn: (e: any) => void) => {
          listeners[type] = fn;
        },
        removeEventListener: (type: string, fn: (e: any) => void) => {
          if (listeners[type] === fn) delete listeners[type];
        },
      };
      (globalThis as any).window = childWin;

      const sentMessages: any[] = [];
      const reporter = new IframeActivityReporter(async (msg) => {
        sentMessages.push(msg);
        return { ok: true };
      });

      reporter.start();

      assert.ok(listeners["pointerdown"], "应监听 pointerdown");
      assert.ok(listeners["keydown"], "应监听 keydown");
      assert.ok(listeners["input"], "应监听 input");
      assert.ok(listeners["scroll"], "应监听 scroll");
      assert.ok(listeners["wheel"], "应监听 wheel");

      // 1. 触发第一次交互事件
      listeners["pointerdown"]({ type: "pointerdown" });
      assert.equal(sentMessages.length, 1, "首次交互应立即触发 activity-ping");
      assert.equal(sentMessages[0].type, "content/activity-ping");

      // 2. 500ms 内再次触发：应被 1500ms 节流忽略
      mock.timers.tick(500);
      listeners["keydown"]({ type: "keydown" });
      listeners["scroll"]({ type: "scroll" });
      listeners["wheel"]({ type: "wheel" });
      assert.equal(
        sentMessages.length,
        1,
        "节流期内的后续事件不应重复发送消息"
      );

      // 3. 超过 1500ms 后再次触发：应再次发送心跳
      mock.timers.tick(1200); // 累计 1700ms > 1500ms
      listeners["input"]({ type: "input" });
      assert.equal(sentMessages.length, 2, "超过 1500ms 后应发送第二次心跳");

      // 4. stop() 移除监听器
      reporter.stop();
      assert.equal(listeners["pointerdown"], undefined);
      assert.equal(listeners["keydown"], undefined);
      assert.equal(listeners["input"], undefined);
      assert.equal(listeners["scroll"], undefined);
      assert.equal(listeners["wheel"], undefined);
    } finally {
      mock.timers.reset();
    }
  });
});
