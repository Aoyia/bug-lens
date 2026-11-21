import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { t, type I18nDict } from "../src/shared/i18n.ts";
import {
  MOBILE_EMULATION_ATTR,
  MOBILE_LANDSCAPE_SHORT_SIDE_MAX,
  MOBILE_VIEWPORT_MAX_WIDTH,
  clampPositionToViewport,
  getViewportMetrics,
  isCoarseOrNoHoverPointer,
  isMobileEmulationViewport,
  observeMobileEmulationMode,
  syncMobileEmulationAttribute,
} from "../src/shared/ui/mobile-emulation-mode.ts";

interface MockListenerMap {
  [event: string]: Set<() => void>;
}

function createMockWindow(options: {
  innerWidth?: number;
  innerHeight?: number;
  clientWidth?: number;
  clientHeight?: number;
  coarsePointer?: boolean;
  matchMediaThrows?: boolean;
  legacyMediaListener?: boolean;
  withVisualViewport?: boolean;
}) {
  const winListeners: MockListenerMap = {};
  const vvListeners: MockListenerMap = {};
  const mqlListeners = new Set<() => void>();
  let coarse = options.coarsePointer ?? false;
  let width = options.innerWidth;
  let height = options.innerHeight;

  const mockMql = {
    get matches() {
      return coarse;
    },
    media: "(hover: none), (pointer: coarse)",
    ...(options.legacyMediaListener
      ? {
          addListener(cb: () => void) {
            mqlListeners.add(cb);
          },
          removeListener(cb: () => void) {
            mqlListeners.delete(cb);
          },
        }
      : {
          addEventListener(event: string, cb: () => void) {
            if (event === "change") mqlListeners.add(cb);
          },
          removeEventListener(event: string, cb: () => void) {
            if (event === "change") mqlListeners.delete(cb);
          },
        }),
  };

  const mockVisualViewport = options.withVisualViewport
    ? {
        addEventListener(event: string, cb: () => void) {
          vvListeners[event] ??= new Set();
          vvListeners[event].add(cb);
        },
        removeEventListener(event: string, cb: () => void) {
          vvListeners[event]?.delete(cb);
        },
      }
    : undefined;

  const mockWin = {
    get innerWidth() {
      return width;
    },
    get innerHeight() {
      return height;
    },
    document: {
      documentElement: {
        clientWidth: options.clientWidth,
        clientHeight: options.clientHeight,
      },
    },
    visualViewport: mockVisualViewport,
    matchMedia() {
      if (options.matchMediaThrows) {
        throw new Error("matchMedia unsupported");
      }
      return mockMql;
    },
    addEventListener(event: string, cb: () => void) {
      winListeners[event] ??= new Set();
      winListeners[event].add(cb);
    },
    removeEventListener(event: string, cb: () => void) {
      winListeners[event]?.delete(cb);
    },
  } as unknown as Window;

  return {
    win: mockWin,
    setSize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
    },
    setCoarse(nextCoarse: boolean) {
      coarse = nextCoarse;
    },
    dispatchWindowResize() {
      for (const cb of winListeners.resize ?? []) cb();
    },
    dispatchVisualViewportResize() {
      for (const cb of vvListeners.resize ?? []) cb();
    },
    dispatchMediaChange() {
      for (const cb of mqlListeners) cb();
    },
    getCounts() {
      return {
        windowResize: winListeners.resize?.size ?? 0,
        vvResize: vvListeners.resize?.size ?? 0,
        mediaChange: mqlListeners.size,
      };
    },
  };
}

test("常量导出与无 window 环境安全兜底", () => {
  assert.equal(MOBILE_EMULATION_ATTR, "data-wbr-mobile-mode");
  assert.equal(MOBILE_VIEWPORT_MAX_WIDTH, 600);
  assert.equal(MOBILE_LANDSCAPE_SHORT_SIDE_MAX, 500);

  assert.deepEqual(getViewportMetrics(), { width: 1024, height: 768 });
  assert.equal(isCoarseOrNoHoverPointer(), false);
  assert.equal(isMobileEmulationViewport(), false);

  const cleanup = observeMobileEmulationMode(() => {
    throw new Error("should not fire without window");
  });
  cleanup();
  cleanup();
});

test("getViewportMetrics 优先读取 innerWidth/innerHeight，其次回退 documentElement.clientWidth/clientHeight", () => {
  const { win: fromInner } = createMockWindow({
    innerWidth: 412,
    innerHeight: 915,
    clientWidth: 390,
    clientHeight: 844,
  });
  assert.deepEqual(getViewportMetrics(fromInner), { width: 412, height: 915 });

  const { win: fromDocEl } = createMockWindow({
    innerWidth: 0,
    innerHeight: Number.NaN,
    clientWidth: 375,
    clientHeight: 667,
  });
  assert.deepEqual(getViewportMetrics(fromDocEl), { width: 375, height: 667 });
});

test("PC 桌面端与普通半屏（> 600px 且 fine pointer）始终返回 false", () => {
  for (const [w, h] of [
    [1280, 800],
    [1920, 1080],
    [720, 900],
    [601, 800],
  ]) {
    const { win } = createMockWindow({
      innerWidth: w,
      innerHeight: h,
      coarsePointer: false,
    });
    assert.equal(
      isMobileEmulationViewport(win),
      false,
      `预期 ${w}x${h} (fine pointer) 为非移动模式`
    );
  }
});

test("DevTools 竖屏仿真（<= 600px）返回 true", () => {
  for (const [w, h] of [
    [375, 667],
    [320, 568],
    [600, 800],
  ]) {
    const { win } = createMockWindow({
      innerWidth: w,
      innerHeight: h,
      coarsePointer: false,
    });
    assert.equal(
      isMobileEmulationViewport(win),
      true,
      `预期 ${w}x${h} 竖屏宽度 <= 600 返回 true`
    );
  }
});

test("DevTools 手机仿真横屏与同等宽高非触控桌面矮窗判定精确区分", () => {
  const mobileLandscape = createMockWindow({
    innerWidth: 667,
    innerHeight: 375,
    coarsePointer: true,
  });
  assert.equal(isCoarseOrNoHoverPointer(mobileLandscape.win), true);
  assert.equal(isMobileEmulationViewport(mobileLandscape.win), true);

  const mobileLandscapeBoundary = createMockWindow({
    innerWidth: 812,
    innerHeight: 500,
    coarsePointer: true,
  });
  assert.equal(isMobileEmulationViewport(mobileLandscapeBoundary.win), true);

  const tabletOrDesktopCoarse = createMockWindow({
    innerWidth: 812,
    innerHeight: 501,
    coarsePointer: true,
  });
  assert.equal(isMobileEmulationViewport(tabletOrDesktopCoarse.win), false);

  const desktopShortWindow = createMockWindow({
    innerWidth: 667,
    innerHeight: 375,
    coarsePointer: false,
  });
  assert.equal(isCoarseOrNoHoverPointer(desktopShortWindow.win), false);
  assert.equal(isMobileEmulationViewport(desktopShortWindow.win), false);

  const throwingMatchMedia = createMockWindow({
    innerWidth: 667,
    innerHeight: 375,
    matchMediaThrows: true,
  });
  assert.equal(isCoarseOrNoHoverPointer(throwingMatchMedia.win), false);
  assert.equal(isMobileEmulationViewport(throwingMatchMedia.win), false);
});

test("syncMobileEmulationAttribute 正确挂载与卸载 data-wbr-mobile-mode", () => {
  syncMobileEmulationAttribute(null, true);
  syncMobileEmulationAttribute(undefined, false);

  const attrs = new Map<string, string>();
  const mockEl = {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  } as unknown as HTMLElement;

  syncMobileEmulationAttribute(mockEl, true);
  assert.equal(attrs.get(MOBILE_EMULATION_ATTR), "true");

  syncMobileEmulationAttribute(mockEl, false);
  assert.equal(attrs.has(MOBILE_EMULATION_ATTR), false);

  const datasetOnlyEl = {
    dataset: {} as Record<string, string | undefined>,
  } as unknown as HTMLElement;

  syncMobileEmulationAttribute(datasetOnlyEl, true);
  assert.equal(datasetOnlyEl.dataset.wbrMobileMode, "true");

  syncMobileEmulationAttribute(datasetOnlyEl, false);
  assert.equal(datasetOnlyEl.dataset.wbrMobileMode, undefined);
});

test("observeMobileEmulationMode 响应 resize、visualViewport 与 matchMedia 变更并在 cleanup 后解绑", () => {
  const mock = createMockWindow({
    innerWidth: 1280,
    innerHeight: 800,
    coarsePointer: false,
    withVisualViewport: true,
  });

  const events: Array<{ isMobile: boolean; width: number; height: number }> =
    [];
  const cleanup = observeMobileEmulationMode((isMobile, metrics) => {
    events.push({ isMobile, width: metrics.width, height: metrics.height });
  }, mock.win);

  assert.deepEqual(mock.getCounts(), {
    windowResize: 1,
    vvResize: 1,
    mediaChange: 1,
  });

  mock.setSize(375, 667);
  mock.dispatchWindowResize();

  mock.setSize(667, 375);
  mock.setCoarse(true);
  mock.dispatchMediaChange();

  mock.setSize(1024, 768);
  mock.setCoarse(false);
  mock.dispatchVisualViewportResize();

  assert.deepEqual(events, [
    { isMobile: true, width: 375, height: 667 },
    { isMobile: true, width: 667, height: 375 },
    { isMobile: false, width: 1024, height: 768 },
  ]);

  cleanup();
  cleanup();

  assert.deepEqual(mock.getCounts(), {
    windowResize: 0,
    vvResize: 0,
    mediaChange: 0,
  });

  mock.setSize(320, 568);
  mock.dispatchWindowResize();
  mock.dispatchVisualViewportResize();
  mock.dispatchMediaChange();
  assert.equal(events.length, 3);
});

test("observeMobileEmulationMode 兼容老式 MediaQueryList addListener/removeListener", () => {
  const mock = createMockWindow({
    innerWidth: 667,
    innerHeight: 375,
    coarsePointer: false,
    legacyMediaListener: true,
  });

  let latest = false;
  const cleanup = observeMobileEmulationMode((isMobile) => {
    latest = isMobile;
  }, mock.win);

  assert.equal(mock.getCounts().mediaChange, 1);
  mock.setCoarse(true);
  mock.dispatchMediaChange();
  assert.equal(latest, true);

  cleanup();
  assert.equal(mock.getCounts().mediaChange, 0);
});

test("clampPositionToViewport 覆盖四边越界与元素大于视口的极端边界", () => {
  const { win } = createMockWindow({
    innerWidth: 375,
    innerHeight: 667,
  });

  // 默认 padding = 8
  assert.deepEqual(clampPositionToViewport(50, 100, 120, 40, undefined, win), {
    x: 50,
    y: 100,
  });
  // 右侧与底部越界
  assert.deepEqual(clampPositionToViewport(350, 650, 120, 40, undefined, win), {
    x: 247,
    y: 619,
  });
  // 左侧与顶部越界
  assert.deepEqual(clampPositionToViewport(-20, 2, 120, 40, undefined, win), {
    x: 8,
    y: 8,
  });
  // 自定义 padding
  assert.deepEqual(clampPositionToViewport(0, 999, 100, 50, 12, win), {
    x: 12,
    y: 605,
  });
  // 元素宽/高大于视口
  assert.deepEqual(clampPositionToViewport(100, 100, 500, 900, 8, win), {
    x: 8,
    y: 8,
  });
});

test("双语 messages.json 新增 9 个词条键名完整、JSON 合法且占位符规范一致", () => {
  const expectedKeys = [
    "widgetDockLeft",
    "widgetDockRight",
    "widgetCloseMenu",
    "widgetMobileGuideTip",
    "widgetExportAiShort",
    "selectionModePick",
    "selectionModeScroll",
    "selectionMoveTop",
    "selectionMoveBottom",
  ];

  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  ) as Record<
    string,
    { message: string; placeholders?: Record<string, { content: string }> }
  >;
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  ) as Record<
    string,
    { message: string; placeholders?: Record<string, { content: string }> }
  >;

  for (const key of expectedKeys) {
    assert.ok(zhDict[key]?.message.trim(), `zh_CN 缺少 ${key}`);
    assert.ok(enDict[key]?.message.trim(), `en 缺少 ${key}`);
  }

  for (const dict of [zhDict, enDict]) {
    assert.match(dict.widgetMobileGuideTip.message, /\$SHORTCUT\$/);
    assert.equal(
      dict.widgetMobileGuideTip.placeholders?.shortcut?.content,
      "$1"
    );
  }

  assert.equal(
    t("widgetMobileGuideTip", ["Alt+M"], zhDict as unknown as I18nDict),
    "点击胶囊操作录制，或按 Alt+M 标点，可上下拖动贴边"
  );
  assert.equal(
    t("widgetMobileGuideTip", ["Alt+M"], enDict as unknown as I18nDict),
    "Click the pill to control recording or press Alt+M to mark. Drag to dock left or right."
  );
});
