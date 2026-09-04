import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import {
  calculateSameOriginFrameOffset,
  getFrameGeometry,
  normalizeCoordinates,
  initFrameGeometryBridge,
  setCachedCrossOriginGeometry,
  resetFrameGeometryCache,
  QUERY_FRAME_OFFSET_TYPE,
  RESPONSE_FRAME_OFFSET_TYPE,
} from "../src/entrypoints/content/collector/frame-geometry.ts";
import { DomObserver } from "../src/entrypoints/content/collector/dom-observer.ts";

describe("视口坐标绝对归一化与 Frame 几何换算 (R2)", () => {
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

  test("顶层窗口计算 frameOffset 为 (0, 0)，视口为顶层视口", () => {
    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
    };
    topWin.top = topWin;
    (globalThis as any).window = topWin;

    const res = calculateSameOriginFrameOffset(topWin);
    assert.deepEqual(res.offset, { x: 0, y: 0 });
    assert.deepEqual(res.viewport, { width: 1920, height: 1080 });
    assert.equal(res.reachedTop, true);

    const norm = normalizeCoordinates(50, 80, topWin);
    assert.equal(norm.clientX, 50, "顶层 clientX 等于 localX");
    assert.equal(norm.clientY, 80, "顶层 clientY 等于 localY");
    assert.equal(norm.localX, 50);
    assert.equal(norm.localY, 80);
    assert.deepEqual(norm.viewport, { width: 1920, height: 1080 });
  });

  test("单层同源 iframe 正确累加 frameElement 的 left/top 偏移", () => {
    const topWin: any = {
      innerWidth: 1440,
      innerHeight: 900,
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      frameElement: {
        getBoundingClientRect: () => ({
          left: 120,
          top: 240,
          width: 400,
          height: 300,
        }),
      },
    };
    (globalThis as any).window = childWin;

    const res = calculateSameOriginFrameOffset(childWin);
    assert.deepEqual(res.offset, { x: 120, y: 240 });
    assert.deepEqual(res.viewport, { width: 1440, height: 900 });
    assert.equal(res.reachedTop, true);

    const norm = normalizeCoordinates(30, 40, childWin);
    assert.equal(
      norm.clientX,
      150,
      "clientX 应为 localX + frameOffset.x (30 + 120)"
    );
    assert.equal(
      norm.clientY,
      280,
      "clientY 应为 localY + frameOffset.y (40 + 240)"
    );
    assert.equal(norm.localX, 30, "localX 应保留子 frame 局部坐标");
    assert.equal(norm.localY, 40, "localY 应保留子 frame 局部坐标");
    assert.deepEqual(
      norm.viewport,
      { width: 1440, height: 900 },
      "viewport 应为顶层视口尺寸"
    );
  });

  test("多层嵌套同源 iframe（Grandchild -> Child -> Top）链式累加物理偏移", () => {
    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 800,
      innerHeight: 600,
      frameElement: {
        getBoundingClientRect: () => ({
          left: 100,
          top: 150,
        }),
      },
    };

    const grandchildWin: any = {
      top: topWin,
      parent: childWin,
      innerWidth: 300,
      innerHeight: 200,
      frameElement: {
        getBoundingClientRect: () => ({
          left: 50,
          top: 75,
        }),
      },
    };
    (globalThis as any).window = grandchildWin;

    const res = calculateSameOriginFrameOffset(grandchildWin);
    assert.deepEqual(
      res.offset,
      { x: 150, y: 225 },
      "50 + 100 = 150, 75 + 150 = 225"
    );
    assert.deepEqual(res.viewport, { width: 1920, height: 1080 });
    assert.equal(res.reachedTop, true);

    const norm = normalizeCoordinates(20, 30, grandchildWin);
    assert.equal(norm.clientX, 170);
    assert.equal(norm.clientY, 255);
    assert.equal(norm.localX, 20);
    assert.equal(norm.localY, 30);
  });

  test("跨域 iframe 降级走 postMessage 通信桥与缓存注入", () => {
    // 模拟跨域：访问 frameElement 抛错
    const topWin: any = {
      innerWidth: 1600,
      innerHeight: 900,
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 300,
      innerHeight: 200,
      get frameElement() {
        throw new Error(
          "SecurityError: Blocked a frame with origin from accessing a cross-origin frame."
        );
      },
    };
    (globalThis as any).window = childWin;

    // 未收到缓存时，同源遍历失败，fallback 到 0
    const initialGeom = getFrameGeometry(childWin);
    assert.deepEqual(initialGeom.offset, { x: 0, y: 0 });

    // 跨域 postMessage 回传并注入几何缓存
    setCachedCrossOriginGeometry(
      { x: 250, y: 350 },
      { width: 1600, height: 900 }
    );

    const updatedGeom = getFrameGeometry(childWin);
    assert.deepEqual(updatedGeom.offset, { x: 250, y: 350 });
    assert.deepEqual(updatedGeom.viewport, { width: 1600, height: 900 });

    const norm = normalizeCoordinates(10, 20, childWin);
    assert.equal(norm.clientX, 260);
    assert.equal(norm.clientY, 370);
    assert.equal(norm.localX, 10);
    assert.equal(norm.localY, 20);
    assert.deepEqual(norm.viewport, { width: 1600, height: 900 });
  });

  test("initFrameGeometryBridge 支持顶层查询与子窗口响应流程", () => {
    let topMessageListener: ((e: any) => void) | undefined;
    let childMessageListener: ((e: any) => void) | undefined;
    const messagesPostedToChild: any[] = [];
    const messagesPostedToTop: any[] = [];

    const childContentWindow: any = {
      postMessage: (data: any) => {
        messagesPostedToChild.push(data);
        childMessageListener?.({ data, source: topWin });
      },
    };

    const topWin: any = {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (type: string, fn: any) => {
        if (type === "message") topMessageListener = fn;
      },
      removeEventListener: () => {
        topMessageListener = undefined;
      },
      document: {
        querySelectorAll: (sel: string) => {
          if (sel === "iframe") {
            return [
              {
                contentWindow: childContentWindow,
                getBoundingClientRect: () => ({ left: 80, top: 160 }),
              },
            ];
          }
          return [];
        },
      },
    };
    topWin.top = topWin;

    const childWin: any = {
      innerWidth: 400,
      innerHeight: 300,
      parent: topWin,
      top: {
        postMessage: (data: any) => {
          messagesPostedToTop.push(data);
          topMessageListener?.({ data, source: childContentWindow });
        },
      },
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

    // 1. 顶层窗口初始化桥
    const cleanupTop = initFrameGeometryBridge(topWin);
    assert.ok(topMessageListener, "顶层应注册 message 监听");

    // 2. 子窗口初始化桥（自动向 top 发送查询）
    const cleanupChild = initFrameGeometryBridge(childWin);
    assert.ok(childMessageListener, "子窗口应注册 message 监听");
    assert.equal(messagesPostedToTop.length, 1, "子窗口应主动向 top 发送查询");
    assert.equal(messagesPostedToTop[0].type, QUERY_FRAME_OFFSET_TYPE);

    // 3. 验证 top 收到查询后匹配 iframe 并回传了响应
    assert.equal(
      messagesPostedToChild.length,
      1,
      "top 应向匹配的 contentWindow 回传几何信息"
    );
    assert.equal(messagesPostedToChild[0].type, RESPONSE_FRAME_OFFSET_TYPE);
    assert.deepEqual(messagesPostedToChild[0].offset, { x: 80, y: 160 });
    assert.deepEqual(messagesPostedToChild[0].viewport, {
      width: 1280,
      height: 720,
    });

    // 4. 验证子窗口在收到响应后，getFrameGeometry 返回了正确的偏移与顶层视口
    const geom = getFrameGeometry(childWin);
    assert.deepEqual(geom.offset, { x: 80, y: 160 });
    assert.deepEqual(geom.viewport, { width: 1280, height: 720 });

    cleanupTop();
    cleanupChild();
  });

  test("DomObserver 在子 iframe 中生成 InteractionRecord 时写入归一化 clientX/clientY 与 localX/localY", () => {
    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
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

    const observer = new DomObserver({
      getSession: () => ({
        nonce: "test-nonce",
        sessionId: "test-session",
        privacyMode: "safe",
        frameId: 5,
      }),
      isIssueActive: () => false,
      beginIssueSelection: () => {},
      removeIssueUi: () => {},
    });

    class MockElement {}
    class MockHTMLElement extends MockElement {}
    class MockHTMLInputElement extends MockHTMLElement {}
    class MockHTMLTextAreaElement extends MockHTMLElement {}
    class MockHTMLSelectElement extends MockHTMLElement {}
    (globalThis as any).Element = MockElement;
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLInputElement = MockHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;
    class MockMouseEvent {}
    class MockPointerEvent extends MockMouseEvent {}
    class MockKeyboardEvent {}
    (globalThis as any).MouseEvent = MockMouseEvent;
    (globalThis as any).PointerEvent = MockPointerEvent;
    (globalThis as any).KeyboardEvent = MockKeyboardEvent;

    const fakeElement: any = Object.setPrototypeOf(
      {
        tagName: "BUTTON",
        getAttribute: () => null,
        closest: () => null,
        classList: { contains: () => false },
        attributes: [],
        getRootNode: () => ({ querySelectorAll: () => [] }),
        getBoundingClientRect: () => ({
          left: 20,
          top: 30,
          width: 100,
          height: 40,
        }),
      },
      MockElement.prototype
    );

    const fakePointerEvent: any = Object.setPrototypeOf(
      {
        type: "pointerdown",
        pointerType: "mouse",
        button: 0,
        isTrusted: true,
        clientX: 70, // 局部 localX
        clientY: 50, // 局部 localY
        composedPath: () => [fakeElement],
        target: fakeElement,
      },
      MockPointerEvent.prototype
    );

    // 触发 pointerdown (candidate)
    (observer as any).onPointerdown(fakePointerEvent);
    observer.flushMessageQueue();
    assert.ok(sentRecord, "应生成 candidate 交互记录");
    assert.equal(
      sentRecord.coordinates.localX,
      70,
      "localX 应保留子 frame 局部坐标 70"
    );
    assert.equal(
      sentRecord.coordinates.localY,
      50,
      "localY 应保留子 frame 局部坐标 50"
    );
    assert.equal(
      sentRecord.coordinates.clientX,
      270,
      "clientX 应为 localX + frameOffset.x (70 + 200 = 270)"
    );
    assert.equal(
      sentRecord.coordinates.clientY,
      350,
      "clientY 应为 localY + frameOffset.y (50 + 300 = 350)"
    );
    assert.deepEqual(
      sentRecord.coordinates.viewport,
      { width: 1920, height: 1080 },
      "viewport 应归一化为顶层视口"
    );
    assert.equal(
      sentRecord.page.frameId,
      5,
      "应记录 session 附带的真实 frameId"
    );
  });

  test("顶层窗口发生滚动与缩放时，initFrameGeometryBridge 主动广播更新的几何偏移给子 iframe", () => {
    let topMessageListener: ((e: any) => void) | undefined;
    let topScrollListener: (() => void) | undefined;
    let childMessageListener: ((e: any) => void) | undefined;
    const messagesPostedToChild: any[] = [];

    const childContentWindow: any = {
      postMessage: (data: any) => {
        messagesPostedToChild.push(data);
        childMessageListener?.({ data, source: topWin });
      },
    };

    let currentIframeTop = 600;
    const topWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      requestAnimationFrame: (cb: () => void) => {
        cb();
        return 1;
      },
      cancelAnimationFrame: () => {},
      addEventListener: (type: string, fn: any) => {
        if (type === "message") topMessageListener = fn;
        if (type === "scroll") topScrollListener = fn;
      },
      removeEventListener: () => {
        topScrollListener = undefined;
        topMessageListener = undefined;
      },
      postMessage: (data: any) => {
        topMessageListener?.({ data, source: childContentWindow });
      },
      document: {
        querySelectorAll: (sel: string) => {
          if (sel === "iframe") {
            return [
              {
                contentWindow: childContentWindow,
                clientLeft: 10,
                clientTop: 10,
                getBoundingClientRect: () => ({
                  left: 150,
                  top: currentIframeTop,
                }),
              },
            ];
          }
          return [];
        },
      },
    };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      addEventListener: (type: string, fn: any) => {
        if (type === "message") childMessageListener = fn;
      },
      removeEventListener: () => {
        childMessageListener = undefined;
      },
      get frameElement() {
        throw new Error("SecurityError: cross-origin");
      },
    };

    const cleanupTop = initFrameGeometryBridge(topWin);
    const cleanupChild = initFrameGeometryBridge(childWin);

    // 初始几何校验（含 clientLeft/Top 10px 边框补偿）
    assert.deepEqual(getFrameGeometry(childWin).offset, { x: 160, y: 610 });

    // 模拟顶层页面向下滚动 500px，iframe 相对当前视口 top 变为 100px
    currentIframeTop = 100;
    assert.ok(topScrollListener, "顶层应注册 scroll 监听");
    topScrollListener!();

    // 验证子 iframe 几何缓存被动态刷新（100 + 10 = 110）
    const updated = getFrameGeometry(childWin);
    assert.deepEqual(updated.offset, { x: 160, y: 110 });
    assert.deepEqual(updated.viewport, { width: 1920, height: 1080 });

    cleanupTop();
    cleanupChild();
  });

  test("initFrameGeometryBridge 在同一 window 上重复调用具备幂等性，不重复注册监听器", () => {
    let addEventListenerCount = 0;
    let removeEventListenerCount = 0;
    const testWin: any = {
      innerWidth: 1024,
      innerHeight: 768,
      document: { querySelectorAll: () => [] },
      addEventListener: () => {
        addEventListenerCount++;
      },
      removeEventListener: () => {
        removeEventListenerCount++;
      },
    };
    testWin.top = testWin;

    // 首次初始化：注册监听器
    const cleanup1 = initFrameGeometryBridge(testWin);
    assert.equal(testWin.__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__, true);
    const initialListenerCount = addEventListenerCount;
    assert.ok(initialListenerCount > 0);

    // 重复初始化（模拟 executeScript 多次重复注入 content.js）
    const cleanup2 = initFrameGeometryBridge(testWin);
    assert.equal(
      addEventListenerCount,
      initialListenerCount,
      "重复调用不得累积监听器"
    );
    assert.equal(cleanup1, cleanup2, "应返回同一清理函数");

    // 调用清理函数
    cleanup1();
    assert.equal(testWin.__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__, false);
    assert.ok(removeEventListenerCount > 0, "清理时应当注销监听器");

    // 清理后再次调用：允许重新初始化
    initFrameGeometryBridge(testWin);
    assert.equal(testWin.__BUG_LENS_FRAME_GEOMETRY_BRIDGE_INSTALLED__, true);
  });

  test("initFrameGeometryBridge 在严格上下文正确绑定 win 调用 requestAnimationFrame 与 cancelAnimationFrame", () => {
    let rAFCalls = 0;
    let cancelCalls = 0;
    const listeners = new Map<string, Function>();

    const strictWin: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      document: { querySelectorAll: () => [] },
      addEventListener(type: string, fn: Function) {
        listeners.set(type, fn);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
      requestAnimationFrame(cb: Function) {
        if (this !== strictWin) {
          throw new TypeError(
            "Illegal invocation: requestAnimationFrame requires strictWin"
          );
        }
        rAFCalls++;
        return 42;
      },
      cancelAnimationFrame(id: number) {
        if (this !== strictWin) {
          throw new TypeError(
            "Illegal invocation: cancelAnimationFrame requires strictWin"
          );
        }
        assert.equal(id, 42);
        cancelCalls++;
      },
    };
    strictWin.top = strictWin;

    const cleanup = initFrameGeometryBridge(strictWin);

    // 模拟触发 scroll 事件：必须成功调度 requestAnimationFrame 且 this 严格为 strictWin
    const scrollHandler = listeners.get("scroll");
    assert.ok(scrollHandler, "应当挂载 scroll 监听器");
    scrollHandler();
    assert.equal(
      rAFCalls,
      1,
      "scroll 事件应当通过 requestAnimationFrame 调度刷新"
    );

    // 清理时取消待执行的动画帧：cancelAnimationFrame 必须成功调用且 this 严格为 strictWin
    cleanup();
    assert.equal(cancelCalls, 1, "cleanup 应当成功调用 cancelAnimationFrame");
  });
});
