import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ScreenshotOverlay } from "../src/screenshot/screenshot-overlay.ts";
import { InlineTextEditor } from "../src/screenshot/overlay-widgets.ts";

/**
 * 截图 Overlay 交互行为回归测试。
 * 使用手写最小 DOM mock（与 recording-widget.test.ts 同模式，不依赖 jsdom），
 * 锁定拆分前的交互行为基线，确保后续重构“功能不变”。
 */

// ---------- 最小 DOM mock ----------
const savedGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  Image: globalThis.Image,
};

interface Stub {
  tagName: string;
  id: string;
  className: string;
  innerHTML: string;
  style: Record<string, any>;
  dataset: Record<string, string>;
  children: any[];
  parentElement: any;
  parentNode: any;
  listeners: Record<string, Function[]>;
  addEventListener: (type: string, fn: Function) => void;
  removeEventListener: (type: string, fn: Function) => void;
  appendChild: (child: any) => void;
  removeChild: (child: any) => void;
  remove: () => void;
  closest: (sel: string) => any;
  querySelector: (sel: string) => any;
  querySelectorAll: (sel: string) => any[];
  getContext: () => any;
  attachShadow: () => any;
  focus: () => void;
  setSelectionRange: () => void;
  classList: { toggle: () => void; add: () => void; remove: () => void };
  getBoundingClientRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

function createCtxStub(): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "measureText") {
          return (s: string) => ({ width: s.length * 8 });
        }
        if (prop === "roundRect") return undefined; // 走 else 分支
        if (typeof prop === "string") {
          return (..._args: any[]) => undefined;
        }
        return undefined;
      },
      set(target, prop, value) {
        (target as any)[prop] = value;
        return true;
      },
    }
  );
}

function createElementStub(tag: string): Stub {
  // 供 hover 光标断言使用：组合根通过 shadowRoot.querySelector(".selection-box")
  // 设置内联 cursor，测试经由同一实例读取
  const selectionBoxStub = { style: {} as Record<string, any> };
  const stub: Stub = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    innerHTML: "",
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    parentNode: null,
    listeners: {},
    addEventListener(type, fn) {
      (stub.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      stub.listeners[type] = (stub.listeners[type] || []).filter(
        (f) => f !== fn
      );
    },
    appendChild(child) {
      child.parentElement = stub;
      child.parentNode = stub;
      stub.children.push(child);
    },
    removeChild(child) {
      stub.children = stub.children.filter((c) => c !== child);
      child.parentElement = null;
      child.parentNode = null;
    },
    remove() {
      if (stub.parentElement) stub.parentElement.removeChild(stub);
    },
    closest() {
      return null;
    },
    querySelector(sel: string) {
      if (sel === ".selection-box") return selectionBoxStub as any;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return createCtxStub();
    },
    attachShadow() {
      return stub;
    },
    focus() {},
    setSelectionRange() {},
    classList: { toggle() {}, add() {}, remove() {} },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 0, height: 0 };
    },
  };
  return stub;
}

const createdElements: any[] = [];
const documentStub: any = {
  createElement(tag: string) {
    const s = createElementStub(tag);
    createdElements.push(s);
    return s;
  },
  body: { appendChild() {}, removeChild() {} },
  getElementById() {
    return null;
  },
  elementFromPoint() {
    return null;
  },
  documentElement: { closest: () => null },
};

const windowStub: any = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
};

class ImageStub {
  src = "";
  onload: (() => void) | null = null;
}

// ---------- 测试辅助 ----------
interface Harness {
  overlay: ScreenshotOverlay;
  wrapper: Stub;
  mouseDown: (x: number, y: number, target?: any) => void;
  mouseMove: (x: number, y: number) => void;
  mouseUp: (x: number, y: number) => void;
  onComplete: () => void;
  onCancel: () => void;
}

const plainTarget = { closest: () => null };

function createHarness(): Harness {
  const overlay = new ScreenshotOverlay();
  const onComplete = () => {};
  const onCancel = () => {};
  overlay.show({
    viewportDataUrl: "data:image/png;base64,",
    onComplete,
    onCancel,
  });
  const wrapper = createdElements.find(
    (s: Stub) => s.className === "overlay-wrapper"
  );
  assert.ok(wrapper, "wrapper should be created");

  const fire = (type: string, evt: any) => {
    const fns = wrapper.listeners[type] || [];
    for (const fn of fns) {
      fn({
        preventDefault: () => {},
        stopPropagation: () => {},
        ...evt,
      });
    }
  };

  return {
    overlay,
    wrapper,
    mouseDown: (x, y, target = plainTarget) =>
      fire("mousedown", { type: "mousedown", clientX: x, clientY: y, target }),
    mouseMove: (x, y) =>
      fire("mousemove", {
        type: "mousemove",
        clientX: x,
        clientY: y,
        target: plainTarget,
      }),
    mouseUp: (x, y) =>
      fire("mouseup", {
        type: "mouseup",
        clientX: x,
        clientY: y,
        target: plainTarget,
      }),
    onComplete,
    onCancel,
  };
}

beforeEach(() => {
  createdElements.length = 0;
  (globalThis as any).window = windowStub;
  (globalThis as any).document = documentStub;
  (globalThis as any).Image = ImageStub;
});

afterEach(() => {
  (globalThis as any).window = savedGlobals.window;
  (globalThis as any).document = savedGlobals.document;
  (globalThis as any).Image = savedGlobals.Image;
});

// ---------- 测试用例 ----------
describe("ScreenshotOverlay 交互行为基线", () => {
  // 拆分后选区/批注状态分别归属两个控制器，测试经由控制器断言行为
  const sel = (ov: any) => ov.selectionController;
  const ann = (ov: any) => ov.annotationController;

  test("show() 默认全屏预选且未锁定", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    assert.deepEqual(sel(anyOv).selection, {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    });
    assert.equal(anyOv.isSelectionLocked, false);
  });

  test("拉框建立选区并锁定", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    assert.equal(sel(anyOv).isSelecting, true);
    assert.deepEqual(sel(anyOv).startPoint, { x: 100, y: 100 });

    h.mouseMove(300, 200);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    h.mouseUp(300, 200);
    assert.equal(sel(anyOv).isSelecting, false);
    assert.equal(anyOv.isSelectionLocked, true);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
  });

  test("8 点 Resize 手柄微调拉伸", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    const handleEl = { dataset: { handle: "se" }, closest: () => null };
    const handleTarget = {
      closest: (s: string) => (s === ".handle" ? handleEl : null),
    };

    h.mouseDown(300, 200, handleTarget);
    assert.equal(sel(anyOv).isResizing, true);
    assert.equal(sel(anyOv).activeHandle, "se");

    h.mouseMove(320, 220);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 220,
      height: 120,
    });

    h.mouseUp(320, 220);
    assert.equal(sel(anyOv).isResizing, false);
    assert.equal(sel(anyOv).activeHandle, null);
  });

  test("初始预选态下直接 Resize 手柄（无需先拉框锁定）", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    const handleEl = { dataset: { handle: "se" }, closest: () => null };
    const handleTarget = {
      closest: (s: string) => (s === ".handle" ? handleEl : null),
    };

    h.mouseDown(1280, 800, handleTarget);
    assert.equal(sel(anyOv).isResizing, true);
    assert.equal(sel(anyOv).activeHandle, "se");

    h.mouseMove(1300, 820);
    assert.deepEqual(sel(anyOv).selection, {
      x: 0,
      y: 0,
      width: 1300,
      height: 820,
    });

    h.mouseUp(1300, 820);
    assert.equal(sel(anyOv).isResizing, false);
    assert.equal(anyOv.isSelectionLocked, false);
  });

  test("初始预选态下直接绘制 rect（无需先拉框锁定）", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    anyOv.currentTool = "rect";
    h.mouseDown(100, 100);
    h.mouseMove(200, 150);
    h.mouseUp(200, 150);

    assert.equal(ann(anyOv).annotations.length, 1);
    assert.deepEqual(ann(anyOv).annotations[0].bounds, {
      x: 100,
      y: 100,
      width: 100,
      height: 50,
    });
    assert.equal(anyOv.isSelectionLocked, false);
  });

  test("锁定后边缘拖拽整体平移，批注同步平移", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    // 拉框建立选区
    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    // 在选区内绘制一个 rect 批注
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(200, 170);
    h.mouseUp(200, 170);
    assert.equal(ann(anyOv).annotations.length, 1);
    assert.deepEqual(ann(anyOv).annotations[0].bounds, {
      x: 150,
      y: 150,
      width: 50,
      height: 20,
    });

    // 切回 select，拖拽选区左边缘平移
    anyOv.currentTool = "select";
    h.mouseDown(100, 110);
    assert.equal(sel(anyOv).isDraggingSelectionBox, true);

    h.mouseMove(120, 110);
    assert.deepEqual(sel(anyOv).selection, {
      x: 120,
      y: 100,
      width: 200,
      height: 100,
    });
    assert.deepEqual(ann(anyOv).annotations[0].bounds, {
      x: 170,
      y: 150,
      width: 50,
      height: 20,
    });

    h.mouseUp(120, 110);
    assert.equal(sel(anyOv).isDraggingSelectionBox, false);
  });

  test("锁定后选区内部按下拖拽可整体平移，批注同步平移", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    // 拉框建立选区
    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    // 在选区内绘制一个 rect 批注
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(200, 170);
    h.mouseUp(200, 170);
    assert.equal(ann(anyOv).annotations.length, 1);

    // 切回 select，从选区内部空白处按下拖拽（越过 5px 阈值）→ 整体平移
    anyOv.currentTool = "select";
    h.mouseDown(240, 150);
    assert.equal(sel(anyOv).isDraggingSelectionBox, true);

    h.mouseMove(260, 160);
    assert.deepEqual(sel(anyOv).selection, {
      x: 120,
      y: 110,
      width: 200,
      height: 100,
    });
    assert.deepEqual(ann(anyOv).annotations[0].bounds, {
      x: 170,
      y: 160,
      width: 50,
      height: 20,
    });

    h.mouseUp(220, 160);
    assert.equal(sel(anyOv).isDraggingSelectionBox, false);
  });

  test("锁定后选区内部按下位移小于 5px 视为单击，不移动选区框", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    // 内部按下并小幅移动（2,2）< 5px 阈值 → 选区纹丝不动
    anyOv.currentTool = "select";
    h.mouseDown(200, 150);
    assert.equal(sel(anyOv).isDraggingSelectionBox, true);
    h.mouseMove(202, 152);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    h.mouseUp(202, 152);
    assert.equal(sel(anyOv).isDraggingSelectionBox, false);
  });

  test("锁定后点击工具栏按钮不启动选区拖拽", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    // 模拟按下点命中工具栏（shadow DOM 内 target.closest 命中 .toolbar）
    anyOv.currentTool = "select";
    const toolbarTarget = {
      closest: (sel: string) => (sel.includes("toolbar") ? {} : null),
    };
    h.mouseDown(200, 150, toolbarTarget as any);
    assert.equal(sel(anyOv).isDraggingSelectionBox, false);

    h.mouseMove(250, 180);
    assert.deepEqual(sel(anyOv).selection, {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    h.mouseUp(250, 180);
    assert.equal(sel(anyOv).isDraggingSelectionBox, false);
  });

  test("hover 光标：选中批注手柄显示方向光标，批注体显示 move", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    // 绘制一个 rect 批注（bounds: 150,150,50,20）并选中
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(200, 170);
    h.mouseUp(200, 170);
    anyOv.currentTool = "select";
    h.mouseDown(175, 160); // 命中批注体 → 选中
    h.mouseUp(175, 160);
    assert.ok(ann(anyOv).selectedAnnotation);

    const box = anyOv.container.querySelector(".selection-box");
    assert.ok(box, "selection-box should exist");

    // 对角手柄 → nwse-resize（nw / se）
    h.mouseMove(150, 150);
    assert.equal(box.style.cursor, "nwse-resize");
    h.mouseMove(200, 170);
    assert.equal(box.style.cursor, "nwse-resize");
    // 对角手柄 → nesw-resize（ne 角内侧，避开删除按钮命中区）
    h.mouseMove(198, 152);
    assert.equal(box.style.cursor, "nesw-resize");
    // 批注体 → move
    h.mouseMove(175, 160);
    assert.equal(box.style.cursor, "move");
  });

  test("hover 光标：arrow 批注端点显示 move，绘制工具下空白处回落 crosshair", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    // 绘制 arrow 并选中（start: 120,120 end: 180,160）
    anyOv.currentTool = "arrow";
    h.mouseDown(120, 120);
    h.mouseMove(180, 160);
    h.mouseUp(180, 160);
    anyOv.currentTool = "select";
    h.mouseDown(150, 140); // 命中箭头线 → 选中
    h.mouseUp(150, 140);
    assert.ok(ann(anyOv).selectedAnnotation);

    const box = anyOv.container.querySelector(".selection-box");
    assert.ok(box);

    // 端点 → move
    h.mouseMove(120, 120);
    assert.equal(box.style.cursor, "move");
    h.mouseMove(180, 160);
    assert.equal(box.style.cursor, "move");

    // arrow 工具下 hover 空白（无批注命中）→ crosshair
    anyOv.currentTool = "arrow";
    h.mouseMove(250, 150);
    assert.equal(box.style.cursor, "crosshair");
  });

  test("绘制 arrow 批注并点击命中选中", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    anyOv.currentTool = "arrow";
    h.mouseDown(120, 120);
    h.mouseMove(180, 160);
    h.mouseUp(180, 160);
    assert.equal(ann(anyOv).annotations.length, 1);
    assert.equal(ann(anyOv).annotations[0].type, "arrow");
    assert.deepEqual(ann(anyOv).annotations[0].endPoint, {
      x: 180,
      y: 160,
    });

    // 点击箭头端点命中并选中
    anyOv.currentTool = "select";
    h.mouseDown(180, 160);
    assert.ok(ann(anyOv).selectedAnnotation, "should select arrow annotation");
    assert.equal(ann(anyOv).selectedAnnotation.type, "arrow");
    assert.equal(
      ann(anyOv).selectedAnnotation.id,
      ann(anyOv).annotations[0].id
    );
  });

  test("undo 移除最后一个批注", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    h.mouseDown(100, 100);
    h.mouseMove(300, 200);
    h.mouseUp(300, 200);

    anyOv.currentTool = "rect";
    h.mouseDown(120, 120);
    h.mouseMove(160, 150);
    h.mouseUp(160, 150);

    h.mouseDown(200, 120);
    h.mouseMove(240, 150);
    h.mouseUp(240, 150);
    assert.equal(ann(anyOv).annotations.length, 2);

    h.overlay.undo();
    assert.equal(ann(anyOv).annotations.length, 1);
    h.overlay.undo();
    assert.equal(ann(anyOv).annotations.length, 0);
  });

  test("cancel 触发回调并销毁状态", () => {
    let cancelled = 0;
    const overlay = new ScreenshotOverlay();
    overlay.show({
      viewportDataUrl: "data:image/png;base64,",
      onComplete: () => {},
      onCancel: () => {
        cancelled++;
      },
    });
    overlay.cancel();
    assert.equal(cancelled, 1);
    assert.equal((overlay as any).selectionController.selection, null);
  });
});

// ---------- 截图激活期间事件隔离测试 ----------
describe("截图激活期间事件隔离（避免网页响应）", () => {
  test("非编辑场景：普通按键被拦截，不泄漏到网页", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    const calls: string[] = [];
    anyOv.handleKeyDown({
      key: "a",
      code: "KeyA",
      type: "keydown",
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });
    assert.ok(calls.includes("preventDefault"), "should preventDefault");
    assert.ok(calls.includes("stopPropagation"), "should stopPropagation");
    // 普通按键不应取消截图（overlay 仍激活）
    assert.ok(anyOv.container, "overlay should stay active");
  });

  test("Esc 取消截图且事件被拦截", () => {
    let cancelled = 0;
    const overlay = new ScreenshotOverlay();
    overlay.show({
      viewportDataUrl: "data:image/png;base64,",
      onComplete: () => {},
      onCancel: () => {
        cancelled++;
      },
    });
    const anyOv = overlay as any;
    const calls: string[] = [];
    anyOv.handleKeyDown({
      key: "Escape",
      type: "keydown",
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });
    assert.equal(cancelled, 1);
    assert.ok(calls.includes("preventDefault"));
    assert.ok(calls.includes("stopPropagation"));
  });

  test("文本编辑场景：按键放行以正常输入", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    anyOv.shadowRoot = {
      activeElement: {
        tagName: "TEXTAREA",
        classList: { contains: () => true },
      },
    };
    const calls: string[] = [];
    anyOv.handleKeyDown({
      key: "a",
      code: "KeyA",
      type: "keydown",
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });
    assert.deepEqual(calls, [], "editing text should pass keys through");
  });

  test("keyup 在非编辑场景被拦截，编辑场景放行", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    const calls: string[] = [];
    anyOv.handleKeyUp({
      key: "a",
      type: "keyup",
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });
    assert.ok(calls.includes("preventDefault"));
    assert.ok(calls.includes("stopPropagation"));

    // 编辑场景放行
    anyOv.shadowRoot = {
      activeElement: {
        tagName: "INPUT",
        classList: { contains: () => false },
      },
    };
    const calls2: string[] = [];
    anyOv.handleKeyUp({
      key: "a",
      type: "keyup",
      preventDefault: () => calls2.push("preventDefault"),
      stopPropagation: () => calls2.push("stopPropagation"),
    });
    assert.deepEqual(calls2, [], "editing text should pass keyup through");
  });

  test("mousedown 处理完成后阻止事件传播到网页", () => {
    const h = createHarness();
    let sp = 0;
    const evt = {
      type: "mousedown",
      clientX: 100,
      clientY: 100,
      target: plainTarget,
      preventDefault: () => {},
      stopPropagation: () => {
        sp++;
      },
    };
    const fns = h.wrapper.listeners["mousedown"] || [];
    for (const fn of fns) fn(evt);
    assert.ok(sp >= 1, "mousedown should stop propagation");
  });

  test("contextmenu 在截图激活期间被全局拦截", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    let pd = 0;
    let sp = 0;
    anyOv.handleContextMenu({
      type: "contextmenu",
      preventDefault: () => {
        pd++;
      },
      stopPropagation: () => {
        sp++;
      },
    });
    assert.equal(pd, 1);
    assert.equal(sp, 1);
  });

  test("dblclick 传播被拦截，输入框内放行", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    let sp = 0;
    anyOv.handleOverlayDblClick({
      type: "dblclick",
      target: plainTarget,
      preventDefault: () => {},
      stopPropagation: () => {
        sp++;
      },
    });
    assert.equal(sp, 1, "dblclick outside input should be stopped");

    const inputTarget = {
      closest: (s: string) => (s === ".inline-text-input" ? {} : null),
    };
    sp = 0;
    anyOv.handleOverlayDblClick({
      type: "dblclick",
      target: inputTarget,
      preventDefault: () => {},
      stopPropagation: () => {
        sp++;
      },
    });
    assert.equal(sp, 0, "dblclick inside input should pass through");
  });

  test("click 传播被拦截，工具栏按钮与输入框除外", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    let sp = 0;
    anyOv.handleOverlayClick({
      type: "click",
      target: plainTarget,
      preventDefault: () => {},
      stopPropagation: () => {
        sp++;
      },
    });
    assert.equal(sp, 1, "click outside input should be stopped");

    const inputTarget = {
      closest: (s: string) => (s === ".inline-text-input" ? {} : null),
    };
    sp = 0;
    anyOv.handleOverlayClick({
      type: "click",
      target: inputTarget,
      preventDefault: () => {},
      stopPropagation: () => {
        sp++;
      },
    });
    assert.equal(sp, 0, "click inside input should pass through");
  });
});

// ---------- InlineTextEditor 组件级测试 ----------
describe("InlineTextEditor", () => {
  test("输入文本后 blur 提交批注；Esc 取消还原原文", () => {
    const wrapper = createElementStub("div");
    let committed: any = null;
    let cancelled: any = null;

    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: (ann) => {
        committed = ann;
      },
      cancelAnnotation: (ann) => {
        cancelled = ann;
      },
      rerender: () => {},
    });

    // 提交场景
    editor.spawn(100, 100, "hello");
    const textarea = wrapper.children[0] as any;
    assert.ok(textarea, "textarea should be appended to wrapper");
    textarea.value = "hello world";
    const blurFns = textarea.listeners["blur"];
    assert.ok(blurFns, "blur listener should be registered");
    blurFns[0]({ type: "blur" });
    assert.ok(committed, "commit should fire");
    assert.equal(committed.text, "hello world");
    assert.equal(committed.position.x, 100);
    assert.equal(committed.type, "text");

    // Esc 取消场景：输入框没有移除时，Esc 还原原文
    editor.spawn(200, 200, "original");
    const textarea2 = wrapper.children[0] as any;
    textarea2.value = "changed";
    const keyFns = textarea2.listeners["keydown"];
    assert.ok(keyFns, "keydown listener should be registered");
    keyFns[0]({ type: "keydown", key: "Escape" });
    assert.ok(cancelled, "cancel should fire");
    assert.equal(cancelled.text, "original");
  });
});
