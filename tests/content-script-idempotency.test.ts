import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import {
  ensureScreenshotOverlayBridge,
  ensureErrorsTrackerStarted,
} from "../src/entrypoints/content/content-bridge.ts";

/**
 * content script 幂等桥回归测试（P0/P2）：
 * executeScript 重复注入会重新求值 content.js，本测试模拟"两次注入"
 * （连续调用两次幂等入口），断言：
 *  - 监听器只注册一次（跨注入共享 window 标志去重）
 *  - overlay 实例在 window 上共享、关闭后复位可再次触发
 *  - recentErrorsTracker.startListening 只执行一次（console.error 不重复包装）
 *
 * content-bridge 为无副作用纯编排模块，依赖通过参数注入 fake，无需 DOM。
 */

let windowStub: any;
let startedCount = 0;

function makeWindowStub(): any {
  const flags: Record<string, unknown> = {};
  return {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    get __WEB_BUG_RECORDER_SCREENSHOT_LISTENER__() {
      return flags.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__;
    },
    set __WEB_BUG_RECORDER_SCREENSHOT_LISTENER__(v) {
      flags.__WEB_BUG_RECORDER_SCREENSHOT_LISTENER__ = v;
    },
    get __WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__() {
      return flags.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__;
    },
    set __WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__(v) {
      flags.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__ = v;
    },
    get __WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__() {
      return flags.__WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__;
    },
    set __WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__(v) {
      flags.__WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__ = v;
    },
  };
}

/** 返回 { bridge, 注入的监听器列表, 注入的 createOverlay/sendMessage fake 统计 } */
function installBridge() {
  const listeners: Array<(msg: any) => void> = [];
  const sentMessages: any[] = [];
  const createdOverlays: Array<{ show: (opts: any) => void; _opts?: any }> = [];
  const bridge = ensureScreenshotOverlayBridge({
    createOverlay: () => {
      const fake: any = {
        show(opts: any) {
          fake._opts = opts;
        },
      };
      createdOverlays.push(fake);
      return fake;
    },
    onMessage: (fn) => listeners.push(fn),
    sendMessage: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve(undefined);
    },
  });
  return { bridge, listeners, sentMessages, createdOverlays };
}

beforeEach(() => {
  startedCount = 0;
  windowStub = makeWindowStub();
  (globalThis as any).window = windowStub;
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe("content script 幂等化（P0/P2）", () => {
  test("连续两次注入只注册一个消息监听器", () => {
    const first = installBridge();
    assert.equal(first.bridge, true, "首次应注册");
    assert.equal(first.listeners.length, 1, "首次注册 1 个监听器");

    // 模拟第二次注入（重复 executeScript 重新求值脚本）
    const second = installBridge();
    assert.equal(second.bridge, false, "再次注入应幂等跳过");
    assert.equal(second.listeners.length, 0, "不应再注册监听器");
    // 全局只累积了一个监听器
    assert.equal(first.listeners.length, 1);
  });

  test("触发消息时 window 共享单例复用，关闭后复位可再次触发", () => {
    const { listeners, sentMessages, createdOverlays } = installBridge();
    const handler = listeners[0];

    handler({ type: "TRIGGER_SCREENSHOT_OVERLAY", viewportDataUrl: "data:," });
    assert.equal(createdOverlays.length, 1, "首次触发应创建 1 个 overlay");
    assert.equal(
      windowStub.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__,
      createdOverlays[0]
    );
    // 互斥状态上报：打开
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "content/screenshot-overlay-state");
    assert.equal(sentMessages[0].payload.open, true);

    // 同一时刻再次触发：复用已有实例，不新建
    handler({ type: "TRIGGER_SCREENSHOT_OVERLAY", viewportDataUrl: "data:," });
    assert.equal(createdOverlays.length, 1, "未关闭前应复用单例，不新建");

    // 模拟确认完成：onComplete 复位实例
    createdOverlays[0]._opts.onComplete();
    assert.equal(
      windowStub.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__,
      null,
      "onComplete 后实例应复位，可再次触发"
    );
    assert.equal(sentMessages.length, 3);
    assert.equal(sentMessages[2].payload.open, false);

    // 复位后再次触发：新建实例
    handler({ type: "TRIGGER_SCREENSHOT_OVERLAY", viewportDataUrl: "data:," });
    assert.equal(createdOverlays.length, 2, "复位后再次触发应新建实例");

    // 取消路径同理复位
    createdOverlays[1]._opts.onCancel();
    assert.equal(windowStub.__WEB_BUG_RECORDER_SCREENSHOT_OVERLAY__, null);
  });

  test("ensureErrorsTrackerStarted 只启动一次（跨注入幂等）", () => {
    assert.equal(
      ensureErrorsTrackerStarted(() => startedCount++),
      true,
      "首次应启动"
    );
    assert.equal(startedCount, 1, "start 回调应执行一次");
    assert.equal(
      ensureErrorsTrackerStarted(() => startedCount++),
      false,
      "再次注入应幂等跳过"
    );
    assert.equal(startedCount, 1, "start 回调不应重复执行");
    assert.equal(
      windowStub.__WEB_BUG_RECORDER_ERRORS_TRACKER_STARTED__,
      true,
      "window 标志应置位"
    );
  });

  test("非 TRIGGER_SCREENSHOT_OVERLAY 消息不触发 overlay 创建", () => {
    const { listeners, createdOverlays } = installBridge();
    const handler = listeners[0];
    handler({ type: "content/health-update" });
    assert.equal(createdOverlays.length, 0);
    handler({ type: "TRIGGER_SCREENSHOT_OVERLAY" }); // 缺 viewportDataUrl
    assert.equal(createdOverlays.length, 0);
  });
});
