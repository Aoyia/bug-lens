import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach, mock } from "node:test";
import {
  calculateSameOriginFrameOffset,
  getFrameGeometry,
  normalizeCoordinates,
  initFrameGeometryBridge,
  setCachedCrossOriginGeometry,
  resetFrameGeometryCache,
} from "../src/entrypoints/content/collector/frame-geometry.ts";
import { InteractionCapture } from "../src/recording/interaction-capture.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import type {
  InteractionRecord,
  RecordingSession,
} from "../src/shared/protocol.ts";

describe("Challenger 2 Empirical Adversarial Suite: 坐标归一化、交互解阻与离屏批注深度压测 (M1: R1 & R2)", () => {
  let originalWindow: unknown;
  let originalElement: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalElement = (globalThis as any).Element;
    resetFrameGeometryCache();

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
  // Challenge 2.1: 跨域 OOPIF 页面滚动后坐标漂移实证 (Post-Scroll Drift)
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2.1: 跨域 iframe 在页面发生滚动后，因缺乏滚动重同步导致绝对视口坐标产生 100% 滚动量漂移", () => {
    // 模拟初始加载完成：iframe 在顶层视口 y = 600
    setCachedCrossOriginGeometry(
      { x: 150, y: 600 },
      { width: 1920, height: 1080 }
    );

    const topWin: any = { innerWidth: 1920, innerHeight: 1080 };
    topWin.top = topWin;

    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      get frameElement() {
        throw new Error("SecurityError: cross-origin");
      },
    };
    (globalThis as any).window = childWin;

    // 1. 顶层页面向下滚动 500px (scrollY = 500)
    // 此时 iframe 在屏幕当前可见视口上的物理 y 位置为 600 - 500 = 100px
    const scrollDeltaY = 500;
    const realVisibleFrameTop = 600 - scrollDeltaY;

    // 2. 用户在子 iframe 内点击 local y = 30
    const localY = 30;
    const expectedVisualClientY = realVisibleFrameTop + localY; // 130px

    // 3. 计算 normalizeCoordinates
    const norm = normalizeCoordinates(50, localY, childWin);
    const calculatedClientY = norm.clientY; // 30 + 600 = 630px

    const drift = Math.abs(calculatedClientY - expectedVisualClientY);
    console.log("CHALLENGE 2.1 观测结果:", {
      expectedVisualClientY,
      calculatedClientY,
      drift,
    });

    assert.equal(
      drift,
      500,
      "实证验证：跨域 iframe 坐标计算偏离真实物理视口 500px，与滚动量完全一致"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 2.2: 离屏批注 (annotateImage) 视口降级导致的 6x 放大畸变
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2.2: 离屏画布批注在 viewport 降级为子 frame 局部尺寸时，产生致命坐标放大畸变", () => {
    // 模拟 offscreen/index.ts 中的 annotateImage 换算算法
    const computeAnnotationPosition = (
      clientX: number,
      clientY: number,
      viewportWidth: number,
      viewportHeight: number,
      targetWidth: number,
      targetHeight: number
    ) => {
      const x = clientX * (targetWidth / Math.max(1, viewportWidth));
      const y = clientY * (targetHeight / Math.max(1, viewportHeight));
      return { x, y };
    };

    const targetWidth = 1920;
    const targetHeight = 1080;

    // 正常情况：viewport 维持顶层 1920x1080
    const normal = computeAnnotationPosition(
      120,
      150,
      1920,
      1080,
      targetWidth,
      targetHeight
    );
    assert.equal(normal.x, 120);
    assert.equal(normal.y, 150);

    // 异常情况：跨域或嵌套未匹配，viewport 降级为小尺寸 iframe (320x240)
    const degraded = computeAnnotationPosition(
      120,
      150,
      320,
      240,
      targetWidth,
      targetHeight
    );
    console.log("CHALLENGE 2.2 观测结果: 正常点 vs 畸变点 =", {
      normal,
      degraded,
    });

    // 320 -> 1920 放大 6 倍：120 * 6 = 720
    // 240 -> 1080 放大 4.5 倍：150 * 4.5 = 675
    assert.equal(degraded.x, 720);
    assert.equal(degraded.y, 675);
    assert.equal(degraded.x - normal.x, 600, "X 轴偏离达 600px");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 2.3: Iframe 带有 CSS Border / Padding 时 BoundingClientRect 盒模型偏移
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2.3: 同源 iframe 具有外部边框与内边距时，calculateSameOriginFrameOffset 缺少 border/padding 修正", () => {
    const topWin: any = { innerWidth: 1920, innerHeight: 1080 };
    topWin.top = topWin;

    // 带有 border: 20px, padding: 10px 的 iframe
    const childWin: any = {
      top: topWin,
      parent: topWin,
      innerWidth: 400,
      innerHeight: 300,
      frameElement: {
        clientLeft: 20, // 边框宽度
        clientTop: 20,
        getBoundingClientRect: () => ({
          left: 100, // border-box left
          top: 150, // border-box top
          width: 440,
          height: 340,
        }),
      },
    };
    (globalThis as any).window = childWin;

    const res = calculateSameOriginFrameOffset(childWin);
    console.log("CHALLENGE 2.3 观测结果: 累加偏移 =", res.offset);

    // 盒模型修正：累加 getBoundingClientRect().left/top 与 clientLeft/clientTop
    assert.equal(res.offset.x, 120);
    assert.equal(res.offset.y, 170);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 2.4: 密集并发交互下的截屏队列防抖与保序测试 (Interaction Capture Debounce)
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2.4: 多帧并发 10ms 密集交互到达时，InteractionCapture 保证截图队列串行防抖且绝不丢弃", async () => {
    let capturedCalls = 0;
    const validBase64 = Buffer.from("VALID_TEST_IMAGE_DATA").toString("base64");
    installChromeMock({
      tabsQuery: async () => [{ id: 7, active: true }],
      captureVisibleTab: async () => {
        capturedCalls++;
        return `data:image/jpeg;base64,${validBase64}`;
      },
      sendMessage: async () => ({
        ok: true,
        dataUrl: `data:image/jpeg;base64,${validBase64}`,
      }),
    });

    const savedInteractions: InteractionRecord[] = [];
    const savedAssets: any[] = [];

    const baseSession: RecordingSession = {
      id: "session-concurrency",
      schemaVersion: 2,
      extensionVersion: "0.1.0",
      status: "RECORDING",
      target: {
        tabId: 7,
        initialUrl: "https://example.test",
        initialTitle: "Ex",
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
        maxSessionBytes: 10_000_000,
      },
      timeline: { createdAtEpochMs: 1, startedAtEpochMs: 2 },
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
      nonce: "nonce-conc",
    };

    const capture = new InteractionCapture(
      {
        getActiveSession: async () => baseSession,
        getInteraction: async (id) =>
          savedInteractions.find((i) => i.id === id),
        saveInteractionWithinBudget: async (next) => {
          savedInteractions.push(next);
          return { stored: true, usedBytes: 100, limitReached: false };
        },
        saveEvidenceAssetWithinBudget: async (asset) => {
          savedAssets.push(asset);
          return { stored: true, usedBytes: 500, limitReached: false };
        },
      },
      async () => baseSession,
      () => false
    );

    const makeInt = (
      id: string,
      frameId: number,
      x: number
    ): InteractionRecord => ({
      id,
      sessionId: "nonce-conc",
      kind: "click",
      status: "candidate",
      createdAt: Date.now(),
      page: { url: "https://example.test", title: "Ex", frameId },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {
        clientX: x,
        clientY: 100,
        localX: x,
        localY: 100,
        pageX: x,
        pageY: 100,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 1920, height: 1080 },
      },
      element: {
        tagName: "BUTTON",
        classNames: [],
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        locators: [],
      },
      screenshot: { status: "pending" },
    });

    // 模拟来自 3 个不同 frame（0=Top, 1=IframeA, 2=IframeB）在 10ms 间隔内并发触发
    const p1 = capture.handle(makeInt("int-0", 0, 100), {
      tab: { id: 7 },
      frameId: 0,
    } as any);
    const p2 = capture.handle(makeInt("int-1", 1, 200), {
      tab: { id: 7 },
      frameId: 1,
    } as any);
    const p3 = capture.handle(makeInt("int-2", 2, 300), {
      tab: { id: 7 },
      frameId: 2,
    } as any);

    await Promise.all([p1, p2, p3]);

    console.log(
      "CHALLENGE 2.4 观测结果: 3 个密集事件截屏次数 =",
      capturedCalls,
      "保存截图资产 =",
      savedAssets.length
    );
    assert.equal(
      capturedCalls,
      3,
      "所有 3 个并发交互均完成可见视口截图，无丢帧"
    );
    assert.equal(savedAssets.length, 3, "保存了全部 3 张截图资产");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Challenge 2.5: 离屏标注超时或崩溃时，降级链路的资产保存完整性
  // ──────────────────────────────────────────────────────────────────────────
  test("CHALLENGE 2.5: Offscreen 批注发生超时/异常时，InteractionCapture 保证 fallback 原图无损留存", async () => {
    const validBase64 = Buffer.from("VALID_TEST_IMAGE_DATA").toString("base64");
    installChromeMock({
      tabsQuery: async () => [{ id: 7, active: true }],
      captureVisibleTab: async () => `data:image/jpeg;base64,${validBase64}`,
      sendMessage: async () => {
        // 模拟 Offscreen 通信挂死 / 抛错
        throw new Error("OFFSCREEN_CANVAS_RENDER_ERROR");
      },
    });

    let savedAsset: any;
    let savedInteraction: InteractionRecord | undefined;
    const sessionEvents: any[] = [];

    const baseSession: RecordingSession = {
      id: "session-fallback",
      schemaVersion: 2,
      extensionVersion: "0.1.0",
      status: "RECORDING",
      target: {
        tabId: 7,
        initialUrl: "https://example.test",
        initialTitle: "Ex",
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
        maxSessionBytes: 10_000_000,
      },
      timeline: { createdAtEpochMs: 1, startedAtEpochMs: 2 },
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
      nonce: "nonce-fb",
    };

    const capture = new InteractionCapture(
      {
        getActiveSession: async () => baseSession,
        getInteraction: async () => savedInteraction,
        saveInteractionWithinBudget: async (next) => {
          savedInteraction = next;
          return { stored: true, usedBytes: 100, limitReached: false };
        },
        saveEvidenceAssetWithinBudget: async (asset) => {
          savedAsset = asset;
          return { stored: true, usedBytes: 500, limitReached: false };
        },
      },
      async (_id, event) => {
        sessionEvents.push(event);
        return baseSession;
      },
      () => false
    );

    const childInteraction: InteractionRecord = {
      id: "int-child",
      sessionId: "nonce-fb",
      kind: "click",
      status: "candidate",
      createdAt: Date.now(),
      page: {
        url: "https://example.test/child",
        title: "Ex Child",
        frameId: 5,
      },
      input: { pointerType: "mouse", button: 0, isTrusted: true },
      coordinates: {
        clientX: 250,
        clientY: 350,
        localX: 50,
        localY: 50,
        pageX: 250,
        pageY: 350,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
        viewport: { width: 1920, height: 1080 },
      },
      element: {
        tagName: "BUTTON",
        classNames: [],
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        locators: [],
      },
      screenshot: { status: "pending" },
    };

    await capture.handle(childInteraction, {
      tab: { id: 7 },
      frameId: 5,
    } as any);

    console.log(
      "CHALLENGE 2.5 观测结果: 截图状态 =",
      savedInteraction?.screenshot
    );
    assert.equal(savedInteraction?.screenshot.status, "captured");
    if (savedInteraction?.screenshot.status === "captured") {
      assert.equal(
        savedInteraction.screenshot.source,
        "fallback",
        "标记为 fallback"
      );
    }
    assert.ok(savedAsset, "保存了 fallback 原始截图资产");

    const fallbackDelta = sessionEvents.find(
      (e) => e.type === "quality-delta" && e.delta.fallbackScreenshotCount === 1
    );
    assert.ok(fallbackDelta, "质量上报包含 fallbackScreenshotCount: 1");
  });
});
