import assert from "node:assert/strict";
import test from "node:test";
import { h, render } from "preact";
import {
  useSessionState,
  type UseSessionStateOptions,
} from "../src/hooks/useSessionState.ts";
import type { RecordingSession } from "../src/shared/protocol.ts";

function setupMockDocument() {
  const mockNode = () => ({
    nodeType: 1,
    nodeName: "DIV",
    childNodes: [],
    style: {},
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild(child: any) {
      child.parentNode = this;
      return child;
    },
    removeChild(child: any) {
      child.parentNode = null;
      return child;
    },
    insertBefore(child: any) {
      child.parentNode = this;
      return child;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  if (!(globalThis as any).document) {
    (globalThis as any).document = {
      createElement: () => mockNode(),
      createTextNode: () => ({ ...mockNode(), nodeType: 3, nodeValue: "" }),
    };
  }
}

const flushEvents = async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  await new Promise((resolve) => setTimeout(resolve, 30));
};

test("useSessionState - 计时器生命周期与卸载清理", async () => {
  setupMockDocument();

  const activeIntervals = new Set<number>();
  let nextIntervalId = 1;
  let latestTickHandler: (() => void) | undefined;

  let mockNowTime = 1000000;
  const mockOptions: UseSessionStateOptions = {
    setInterval: (fn) => {
      const id = nextIntervalId++;
      activeIntervals.add(id);
      latestTickHandler = fn;
      return id;
    },
    clearInterval: (id) => {
      if (id !== undefined) activeIntervals.delete(id);
    },
    now: () => mockNowTime,
  };

  let hookRef!: ReturnType<typeof useSessionState>;
  function Host() {
    hookRef = useSessionState(mockOptions);
    return null;
  }

  const container = (globalThis as any).document.createElement("div");

  // 1. 初次渲染组件
  render(h(Host, null), container);
  await flushEvents();

  assert.equal(hookRef.active, false);
  assert.equal(hookRef.timerText, "");
  assert.equal(activeIntervals.size, 0);

  // 2. 传入活动 session
  const activeSession: RecordingSession = {
    id: "s1",
    status: "RECORDING",
    timeline: { createdAtEpochMs: 1000000, startedAtEpochMs: 1000000 },
  } as any;

  hookRef.updateSessionState(activeSession);
  await flushEvents();

  assert.equal(hookRef.active, true);
  assert.equal(hookRef.timerText, "00:00");
  assert.equal(activeIntervals.size, 1);
  const firstIntervalId = Array.from(activeIntervals)[0];

  // 模拟假时间推移 5 秒 (5000ms)
  mockNowTime = 1005000;
  latestTickHandler?.();
  await flushEvents();
  assert.equal(hookRef.timerText, "00:05");

  // 3. 多次调用 updateSessionState 时，必须先清除旧 interval，再创建新 interval
  const updatedActiveSession: RecordingSession = {
    ...activeSession,
    timeline: { ...activeSession.timeline, startedAtEpochMs: 1000000 },
  };
  hookRef.updateSessionState(updatedActiveSession);
  assert.equal(
    activeIntervals.has(firstIntervalId),
    false,
    "调用 updateSessionState 时旧 interval 必须立即被清除"
  );

  await flushEvents();
  assert.equal(activeIntervals.size, 1, "新 interval 被创建");

  // 4. session 不再是活动状态时，必须清除 interval 并清空 timerText
  const inactiveSession: RecordingSession = {
    ...activeSession,
    status: "IDLE",
  };
  hookRef.updateSessionState(inactiveSession);
  await flushEvents();

  assert.equal(hookRef.active, false);
  assert.equal(hookRef.timerText, "");
  assert.equal(
    activeIntervals.size,
    0,
    "非活动状态下，所有 interval 必须被清除"
  );

  // 5. 重新激活并测试组件卸载 (unmount) 清理
  hookRef.updateSessionState(activeSession);
  await flushEvents();
  assert.equal(activeIntervals.size, 1);

  const activeTick = latestTickHandler;

  // 卸载组件
  render(null, container);
  await flushEvents();

  assert.equal(activeIntervals.size, 0, "组件卸载后，当前 interval 必须被清除");

  // 6. 避免组件卸载后继续调用 setTimerText
  const timerTextBeforeTick = hookRef.timerText;
  mockNowTime = 1020000;
  activeTick?.();
  await flushEvents();
  assert.equal(
    hookRef.timerText,
    timerTextBeforeTick,
    "卸载后 tick 不应改变或造成异常"
  );
});
