import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach, mock } from "node:test";
import {
  getFrameGeometry,
  initFrameGeometryBridge,
  resetFrameGeometryCache,
  QUERY_FRAME_OFFSET_TYPE,
  RESPONSE_FRAME_OFFSET_TYPE,
} from "../src/entrypoints/content/collector/frame-geometry.ts";
import { DomObserver } from "../src/entrypoints/content/collector/dom-observer.ts";
import { InactivityMonitor } from "../src/entrypoints/content/collector/inactivity-monitor.ts";
import { IframeActivityReporter } from "../src/entrypoints/content/collector/iframe-activity-reporter.ts";

describe("Empirical Challenger M1: Adversarial Stress Tests for R1 & R2", () => {
  let originalWindow: unknown;
  let originalElement: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalElement = (globalThis as any).Element;
    resetFrameGeometryCache();
  });

  afterEach(() => {
    resetFrameGeometryCache();
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
    if (originalElement === undefined) {
      delete (globalThis as any).Element;
    } else {
      (globalThis as any).Element = originalElement;
    }
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLInputElement;
    delete (globalThis as any).HTMLTextAreaElement;
    delete (globalThis as any).HTMLSelectElement;
    delete (globalThis as any).MouseEvent;
    delete (globalThis as any).PointerEvent;
    delete (globalThis as any).KeyboardEvent;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 1: Coordinates pageX/pageY normalization bug in child iframes
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 1: 子 iframe 内部交互的 pageX / pageY 是否随 clientX 一同进行视口绝对归一化", () => {
    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      scrollX: 0,
      scrollY: 0,
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      location: { href: "https://child.example.com/" },
      document: { title: "Child Frame" },
      setTimeout: (fn: any, ms: any) => setTimeout(fn, ms),
      clearTimeout: (id: any) => clearTimeout(id),
      frameElement: {
        getBoundingClientRect: () => ({ left: 200, top: 300 }),
      },
    };
    (globalThis as any).window = childWin;

    let sentRecord: any;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (msg: any) => {
          if (msg?.payload?.interaction) {
            sentRecord = msg.payload.interaction;
          }
          return { ok: true };
        },
      },
    };

    class MockElement {}
    class MockHTMLElement extends MockElement {}
    class MockHTMLInputElement extends MockHTMLElement {}
    class MockHTMLTextAreaElement extends MockHTMLElement {}
    class MockHTMLSelectElement extends MockHTMLElement {}
    class MockMouseEvent {}
    class MockPointerEvent extends MockMouseEvent {}
    class MockKeyboardEvent {}
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLInputElement = MockHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;
    (globalThis as any).MouseEvent = MockMouseEvent;
    (globalThis as any).PointerEvent = MockPointerEvent;
    (globalThis as any).KeyboardEvent = MockKeyboardEvent;

    const observer = new DomObserver({
      getSession: () => ({
        nonce: "test-nonce",
        sessionId: "test-session",
        privacyMode: "safe",
        frameId: 1,
      }),
      isIssueActive: () => false,
      beginIssueSelection: () => {},
      removeIssueUi: () => {},
    });

    const fakeElement: any = Object.setPrototypeOf(
      {
        tagName: "BUTTON",
        getAttribute: () => null,
        closest: () => null,
        classList: { contains: () => false },
        attributes: [],
        getRootNode: () => ({ querySelectorAll: () => [] }),
        getBoundingClientRect: () => ({
          left: 10,
          top: 10,
          width: 80,
          height: 30,
        }),
      },
      MockElement.prototype
    );

    // 在真实浏览器中，PointerEvent 必然带有 pageX 与 pageY
    const realBrowserPointerEvent: any = Object.setPrototypeOf(
      {
        type: "pointerdown",
        pointerType: "mouse",
        button: 0,
        isTrusted: true,
        clientX: 50,
        clientY: 40,
        pageX: 50, // 局部页面坐标
        pageY: 40,
        composedPath: () => [fakeElement],
        target: fakeElement,
      },
      MockPointerEvent.prototype
    );

    (observer as any).onPointerdown(realBrowserPointerEvent);
    observer.flushMessageQueue();

    assert.ok(sentRecord, "应生成交互记录");
    assert.equal(sentRecord.coordinates.clientX, 250);
    assert.equal(sentRecord.coordinates.clientY, 340);

    console.log("CHALLENGE 1 观测结果:", {
      clientX: sentRecord.coordinates.clientX,
      clientY: sentRecord.coordinates.clientY,
      localX: sentRecord.coordinates.localX,
      localY: sentRecord.coordinates.localY,
      pageX: sentRecord.coordinates.pageX,
      pageY: sentRecord.coordinates.pageY,
    });

    // 关键验证：在任何有效的视口/页面坐标系中，pageX 不可能在 clientX 为 250 时依然是 50！
    assert.ok(
      sentRecord.coordinates.pageX >= sentRecord.coordinates.clientX,
      `BUG CONFIRMED: 子 frame 中 pointer.pageX (${sentRecord.coordinates.pageX}) 未做 frameOffset 累加，远小于绝对 clientX (${sentRecord.coordinates.clientX})`
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 2: InactivityMonitor.getPausedDurationMs() ignores manual pause
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2: InactivityMonitor 手动暂停期间 getPausedDurationMs() 统计为 0 还是真实耗时", () => {
    (globalThis as any).window = {
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    mock.timers.enable({ apis: ["Date"] });
    try {
      const monitor = new InactivityMonitor({
        onPause: () => {},
        onResume: () => {},
        isBlocked: () => false,
      });

      monitor.start();
      assert.equal(monitor.getPausedDurationMs(), 0);

      // 用户主动点击暂停录制
      monitor.toggleManualPause();
      assert.equal(
        monitor.isIdlePaused,
        true,
        "isIdlePaused 应报告已处于暂停态"
      );

      // 过去 5000 毫秒
      mock.timers.tick(5000);

      const pausedMs = monitor.getPausedDurationMs();
      console.log(
        "CHALLENGE 2 观测结果: 手动暂停 5000ms 后 getPausedDurationMs() 返回 =",
        pausedMs
      );

      assert.ok(
        pausedMs >= 5000,
        `BUG CONFIRMED: 手动暂停期间 getPausedDurationMs() 未累加当前暂停时间，返回了 ${pausedMs}`
      );
    } finally {
      mock.timers.reset();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 3: Multi-level / Nested cross-origin OOPIF handshake failure
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 3: 嵌套跨域 iframe (Top -> Iframe1 -> Iframe2) postMessage 是否能被 Top 匹配", () => {
    let topMessageListener: ((e: any) => void) | undefined;
    const messagesPostedToChild2: any[] = [];

    const child2ContentWindow: any = {
      postMessage: (data: any) => {
        messagesPostedToChild2.push(data);
      },
    };

    const child1ContentWindow: any = {};

    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      addEventListener: (type: string, fn: any) => {
        if (type === "message") topMessageListener = fn;
      },
      removeEventListener: () => {
        topMessageListener = undefined;
      },
      document: {
        querySelectorAll: (sel: string) => {
          if (sel === "iframe") {
            // top 的 document 里只有直接子 frame 1
            return [
              {
                contentWindow: child1ContentWindow,
                getBoundingClientRect: () => ({ left: 100, top: 100 }),
              },
            ];
          }
          return [];
        },
      },
    };
    topWin.top = topWin;

    initFrameGeometryBridge(topWin);
    assert.ok(topMessageListener, "Top 窗口应注册 message 监听器");

    // 嵌套的 child 2 跨域向 top 发送查询
    topMessageListener!({
      data: {
        type: QUERY_FRAME_OFFSET_TYPE,
        reqId: "req-child-2",
      },
      source: child2ContentWindow,
    });

    console.log(
      "CHALLENGE 3 观测结果: Top 向嵌套 child 2 发送的消息数量 =",
      messagesPostedToChild2.length
    );

    assert.ok(
      messagesPostedToChild2.length > 0,
      "BUG CONFIRMED: 顶层 document.querySelectorAll('iframe') 无法匹配嵌套跨域 iframe 的 contentWindow，导致嵌套 OOPIF 无法解析几何偏移"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 4: Cross-origin OOPIF postMessage spoofing / cache poisoning
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 4: 子 iframe 的 postMessage 响应处理未校验 event.source，易受任意伪造消息污染", () => {
    let childMessageListener: ((e: any) => void) | undefined;

    const topWin: any = {};
    const childWin: any = {
      top: topWin,
      parent: topWin,
      addEventListener: (type: string, fn: any) => {
        if (type === "message") childMessageListener = fn;
      },
      removeEventListener: () => {
        childMessageListener = undefined;
      },
      get frameElement() {
        throw new Error("SecurityError");
      },
    };
    (globalThis as any).window = childWin;

    initFrameGeometryBridge(childWin);
    assert.ok(childMessageListener, "子 iframe 应注册 message 监听");

    // 攻击场景：某个恶意 window 或任意同页面 script 伪造 RESPONSE_FRAME_OFFSET_TYPE，
    // event.source 并非 topWin
    const attackerSource: any = {};
    childMessageListener!({
      data: {
        type: RESPONSE_FRAME_OFFSET_TYPE,
        offset: { x: 88888, y: 99999 },
        viewport: { width: 10, height: 10 },
      },
      source: attackerSource,
    });

    const geom = getFrameGeometry(childWin);
    console.log(
      "CHALLENGE 4 观测结果: 注入恶意 postMessage 后的几何缓存 =",
      geom
    );

    // 理想安全实现：若 source !== topWin，应拒绝处理
    assert.notEqual(
      geom.offset.x,
      88888,
      "VULNERABILITY CONFIRMED: 子 iframe 未校验 event.source === win.top，恶意消息可直接篡改全局几何偏移缓存"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 5: IframeActivityReporter lacks mouse wheel event
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 5: IframeActivityReporter 是否监听 wheel 滚轮事件（防止纯滚轮交互误判闲置）", () => {
    const listeners: Record<string, Function> = {};
    const childWin: any = {
      top: {},
      addEventListener: (type: string, fn: any) => {
        listeners[type] = fn;
      },
      removeEventListener: (type: string, fn: any) => {
        delete listeners[type];
      },
    };
    (globalThis as any).window = childWin;

    const reporter = new IframeActivityReporter(async () => ({ ok: true }));
    reporter.start();

    console.log(
      "CHALLENGE 5 观测结果: IframeActivityReporter 监听的事件类型 =",
      Object.keys(listeners)
    );

    assert.ok(
      listeners["wheel"],
      "FLAW CONFIRMED: IframeActivityReporter 未监听 wheel 事件，用户在 iframe 内部通过鼠标滚轮滚动地图/画布时无法发送心跳"
    );
  });
});
