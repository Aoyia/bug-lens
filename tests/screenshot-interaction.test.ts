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
    querySelector() {
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
    for (const fn of fns) fn(evt);
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
