import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { InactivityMonitor } from "../src/entrypoints/content/collector/inactivity-monitor.ts";

// InactivityMonitor 直接引用全局 window（setInterval / addEventListener），
// 在 node 测试环境注入 fake window：收集事件监听器并暴露手动派发能力。
type FakeWindow = {
  dispatch: (type: string) => void;
  tickAllIntervals: () => void;
};

function installFakeWindow(): FakeWindow {
  const listeners: Record<
    string,
    Array<{ fn: (...args: unknown[]) => void }>
  > = {};
  let intervalSeq = 0;
  const intervals = new Map<number, () => void>();

  (globalThis as Record<string, unknown>).window = {
    setInterval: (fn: () => void) => {
      intervalSeq += 1;
      intervals.set(intervalSeq, fn);
      return intervalSeq;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    addEventListener: (
      type: string,
      fn: (...args: unknown[]) => void,
      _options?: unknown
    ) => {
      (listeners[type] ??= []).push({ fn });
    },
    removeEventListener: (type: string, fn: (...args: unknown[]) => void) => {
      listeners[type] = (listeners[type] ?? []).filter(
        (entry) => entry.fn !== fn
      );
    },
  };

  return {
    dispatch(type: string) {
      (listeners[type] ?? []).forEach((entry) => entry.fn({ type }));
    },
    tickAllIntervals() {
      [...intervals.values()].forEach((fn) => fn());
    },
  };
}

describe("InactivityMonitor - 暂停/继续竞态修复 (A3)", () => {
  let fw: FakeWindow;
  let onPauseCalls: number;
  let onResumeCalls: number;
  let monitor: InactivityMonitor;

  beforeEach(() => {
    fw = installFakeWindow();
    onPauseCalls = 0;
    onResumeCalls = 0;
    mock.timers.enable({ apis: ["setInterval", "Date"] });
    monitor = new InactivityMonitor({
      onPause: () => {
        onPauseCalls += 1;
      },
      onResume: () => {
        onResumeCalls += 1;
      },
      isBlocked: () => false,
    });
  });

  afterEach(() => {
    mock.timers.reset();
    delete (globalThis as Record<string, unknown>).window;
  });

  test("30 秒无操作后自动进入闲置暂停", () => {
    monitor.start();
    mock.timers.tick(15_000);
    fw.tickAllIntervals();
    assert.equal(monitor.isIdlePaused, false);

    mock.timers.tick(16_000);
    fw.tickAllIntervals();
    assert.equal(monitor.isIdlePaused, true);
    assert.equal(onPauseCalls, 1);
    monitor.stop();
  });

  test("闲置暂停后鼠标移动自动恢复录制", () => {
    monitor.start();
    mock.timers.tick(31_000);
    fw.tickAllIntervals();
    assert.equal(monitor.isIdlePaused, true);

    // 用户移动鼠标（handleActivity），触发自动恢复
    fw.dispatch("pointermove");
    assert.equal(monitor.isIdlePaused, false, "闲置暂停后移动鼠标应自动恢复");
    assert.equal(onResumeCalls, 1, "应调用 onResume");
    monitor.stop();
  });

  test("闲置暂停后调用 resume() 恢复录制，且不会被再次暂停", () => {
    monitor.start();
    mock.timers.tick(31_000);
    fw.tickAllIntervals();
    assert.equal(monitor.isIdlePaused, true);

    // 移动鼠标或调用 resume 均恢复录制
    if (monitor.isIdlePaused) monitor.resume();
    else monitor.toggleManualPause();

    assert.equal(onResumeCalls, 1, "调用 resume 应恢复录制");
    assert.equal(monitor.isIdlePaused, false, "恢复后不应处于暂停态");
    // 继续录制后（又过了 2s 间隔检查），不应再次触发暂停
    mock.timers.tick(2_000);
    fw.tickAllIntervals();
    assert.equal(monitor.isIdlePaused, false, "恢复后不应再次暂停");
    monitor.stop();
  });

  test("手动暂停后点击继续（resume）正确恢复", () => {
    monitor.start();
    monitor.toggleManualPause();
    assert.equal(monitor.isIdlePaused, true);
    assert.equal(onPauseCalls, 1);

    monitor.resume();
    assert.equal(monitor.isIdlePaused, false);
    assert.equal(onResumeCalls, 1);
    monitor.stop();
  });

  test("录制进行中 toggleManualPause 进入手动暂停，再次调用恢复", () => {
    monitor.start();
    monitor.toggleManualPause();
    assert.equal(monitor.isIdlePaused, true);
    assert.equal(onPauseCalls, 1);

    monitor.toggleManualPause();
    assert.equal(monitor.isIdlePaused, false);
    assert.equal(onResumeCalls, 1);
    monitor.stop();
  });
});
