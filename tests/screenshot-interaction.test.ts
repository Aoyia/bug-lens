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
    h.mouseDown(150, 160); // 命中左边缘带 → 选中
    h.mouseUp(150, 160);
    assert.ok(ann(anyOv).selectedAnnotation);

    const box = anyOv.container.querySelector(".selection-box");
    assert.ok(box, "selection-box should exist");

    // 对角手柄 → nwse-resize（nw / se）
    h.mouseMove(150, 150);
    assert.equal(box.style.cursor, "nwse-resize");
    h.mouseMove(200, 170);
    assert.equal(box.style.cursor, "nwse-resize");
    // 对角手柄 → nesw-resize（ne 角内侧）
    h.mouseMove(198, 152);
    assert.equal(box.style.cursor, "nesw-resize");
    // 批注边缘 → move
    h.mouseMove(150, 160);
    assert.equal(box.style.cursor, "move");
  });

  test("重叠方框：点击下层露出的边缘可选中下层（边缘命中）", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(400, 300);
    h.mouseUp(400, 300);

    // 下层 rect：bounds 150,150,120,80
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(270, 230);
    h.mouseUp(270, 230);
    // 上层 rect：bounds 190,170,120,80（覆盖下层右下，下层左边缘露出）
    h.mouseDown(190, 170);
    h.mouseMove(310, 250);
    h.mouseUp(310, 250);
    assert.equal(ann(anyOv).annotations.length, 2);

    anyOv.currentTool = "select";

    // 点上层边缘 → 选中上层（后添加者优先，行为与之前一致）
    h.mouseDown(190, 170);
    assert.equal(
      ann(anyOv).selectedAnnotation?.id,
      ann(anyOv).annotations[1].id
    );
    h.mouseUp(190, 170);

    // 点下层露出的左边缘（152,210：下层边缘带内、上层范围外）→ 选中下层
    h.mouseDown(152, 210);
    assert.equal(
      ann(anyOv).selectedAnnotation?.id,
      ann(anyOv).annotations[0].id
    );
    h.mouseUp(152, 210);
  });

  test("方框内部点击不选中批注，穿透为选区内部拖拽", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(400, 300);
    h.mouseUp(400, 300);

    // 绘制 rect：bounds 150,150,120,80
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(270, 230);
    h.mouseUp(270, 230);
    assert.equal(ann(anyOv).annotations.length, 1);

    // 切回 select：点方框内部（200,190）→ 不选中批注，且穿透为选区内部拖拽
    anyOv.currentTool = "select";
    h.mouseDown(200, 190);
    assert.equal(ann(anyOv).selectedAnnotation, null, "内部点击不应选中批注");
    assert.equal(sel(anyOv).isDraggingSelectionBox, true);

    // 拖拽平移选区，批注同步跟随
    h.mouseMove(220, 210);
    assert.deepEqual(sel(anyOv).selection, {
      x: 120,
      y: 120,
      width: 300,
      height: 200,
    });
    assert.deepEqual(ann(anyOv).annotations[0].bounds, {
      x: 170,
      y: 170,
      width: 120,
      height: 80,
    });
    h.mouseUp(220, 210);
  });

  test("同位置重叠方框：边框完全重合时下层不可达（方案 A 已知局限）", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    // 直接注入两个同位置框：交互层面 rect 工具下第二次点击同一边缘会拖拽已有框
    // （而非画新框），因此同位置重合只能通过代码注入构造
    const annController = ann(anyOv);
    annController.addAnnotation({
      id: "box1",
      type: "rect",
      bounds: { x: 150, y: 150, width: 120, height: 80 },
      color: "#FA5252",
    });
    annController.addAnnotation({
      id: "box2",
      type: "rect",
      bounds: { x: 150, y: 150, width: 120, height: 80 },
      color: "#FA5252",
    });
    assert.equal(annController.annotations.length, 2);

    anyOv.currentTool = "select";
    // 点边框带（152,210）→ 两框边缘带完全重合 → 后添加者优先，选中上层
    h.mouseDown(152, 210);
    assert.equal(
      ann(anyOv).selectedAnnotation?.id,
      "box2",
      "边框完全重合时只能选中上层（下层零露出，属方案 A 已知局限）"
    );
    h.mouseUp(152, 210);
  });

  test("hover 方框内部不显示批注 move，绘制工具回落 crosshair", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    h.mouseDown(100, 100);
    h.mouseMove(400, 300);
    h.mouseUp(400, 300);

    // 绘制 rect：bounds 150,150,120,80
    anyOv.currentTool = "rect";
    h.mouseDown(150, 150);
    h.mouseMove(270, 230);
    h.mouseUp(270, 230);

    const box = anyOv.container.querySelector(".selection-box");
    assert.ok(box);

    // arrow 工具下：hover 方框内部 → 非批注命中，回落 crosshair
    anyOv.currentTool = "arrow";
    h.mouseMove(200, 190);
    assert.equal(box.style.cursor, "crosshair");
    // hover 方框边缘 → 命中批注 → move
    h.mouseMove(152, 210);
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

  test("回归：文字空输入关闭后，切换其他批注工具绘制恢复正常", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    const sm = () => anyOv.stateMachine;
    const annCtl = anyOv.annotationController;

    // 模拟 shadowRoot.querySelector：真实环境中 .overlay-wrapper 指向 wrapper，
    // 使 spawnInlineTextInput 能把 textarea 挂载到 wrapper（stub 默认不识别该选择器）
    anyOv.shadowRoot.querySelector = (sel: string) => {
      if (sel === ".overlay-wrapper") return h.wrapper;
      if (sel === ".selection-box") return { style: {} };
      return null;
    };

    // 1. 文字工具：点击产生输入框 → 进入编辑态
    anyOv.currentTool = "text";
    h.mouseDown(300, 300);
    h.mouseUp(300, 300);
    assert.equal(sm().phase, "editing-text", "text 点击后应进入编辑态");

    // 2. 空文本失焦关闭 → 状态机必须恢复 locked（修复点：此前残留 editing-text 阻塞后续绘制）
    const textarea = h.wrapper.children.find(
      (c: any) => c.tagName === "TEXTAREA"
    );
    assert.ok(textarea, "textarea 应已创建");
    textarea.value = "";
    const blurFns = textarea.listeners["blur"];
    assert.ok(blurFns, "blur listener should be registered");
    blurFns[0]({ type: "blur" });
    assert.equal(sm().phase, "locked", "空文本关闭后状态机应回到 locked");

    // 3. 切回方框工具绘制 → 应正常提交
    anyOv.currentTool = "rect";
    h.mouseDown(300, 300);
    h.mouseMove(400, 400);
    h.mouseUp(400, 400);
    assert.equal(sm().phase, "locked");
    assert.equal(annCtl.annotations.length, 1, "rect 批注应成功提交");
    assert.equal(annCtl.annotations[0].type, "rect");
  });

  test("编辑态按 Esc：取消文本输入而非取消整个截图", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    let cancelled = 0;
    (anyOv.onCancelCallback as any) = () => {
      cancelled++;
    };

    // 模拟 shadowRoot.querySelector，使 spawnInlineTextInput 能把 textarea 挂载到 wrapper
    anyOv.shadowRoot.querySelector = (sel: string) => {
      if (sel === ".overlay-wrapper") return h.wrapper;
      if (sel === ".selection-box") return { style: {} };
      return null;
    };

    // 进入文本编辑态
    anyOv.currentTool = "text";
    h.mouseDown(300, 300);
    h.mouseUp(300, 300);
    assert.equal(anyOv.stateMachine.phase, "editing-text");

    // 模拟文本输入框持有焦点（isEditingText 判定依据）
    anyOv.shadowRoot.activeElement = {
      tagName: "TEXTAREA",
      classList: { contains: () => true },
    };

    // 编辑态下按 Esc
    anyOv.handleKeyDown({
      key: "Escape",
      type: "keydown",
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    assert.equal(cancelled, 0, "编辑态 Esc 不应取消整个截图");
    assert.equal(
      anyOv.stateMachine.phase,
      "locked",
      "编辑态 Esc 应关闭输入框并恢复 locked"
    );
  });

  test("点击工具栏不触发批注绘制（切换工具不误触发绘制）", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    // 模拟点击工具栏按钮：closest(".toolbar, .size-badge") 命中
    const toolbarTarget = {
      closest: (sel: string) =>
        sel.includes(".toolbar") ? { className: "toolbar" } : null,
    };

    // 非 select 工具下点击工具栏按钮
    anyOv.currentTool = "rect";
    h.mouseDown(400, 400, toolbarTarget);

    // 不应进入 drawing 状态，也不应设置绘制起点（修复点：此前会返回 draw 意图）
    assert.equal(
      anyOv.stateMachine.phase,
      "idle",
      "工具栏点击不应进入 drawing"
    );
    assert.equal(anyOv.annotationController.startPoint, null);
  });

  test("文本批注二次编辑：单击仅选中，双击才进入编辑", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    const sm = () => anyOv.stateMachine;

    // 模拟 shadowRoot.querySelector，使 spawnInlineTextInput 能把 textarea 挂载到 wrapper
    anyOv.shadowRoot.querySelector = (sel: string) => {
      if (sel === ".overlay-wrapper") return h.wrapper;
      if (sel === ".selection-box") return { style: {} };
      return null;
    };

    // 1) text 工具点击创建输入框并提交一个文本批注
    anyOv.currentTool = "text";
    h.mouseDown(420, 380);
    h.mouseUp(420, 380);
    const textarea = h.wrapper.children.find(
      (c: any) => c.tagName === "TEXTAREA"
    );
    assert.ok(textarea, "textarea 应已创建");
    textarea.value = "hello";
    textarea.listeners["blur"][0]({ type: "blur" });
    assert.equal(sm().phase, "locked");
    assert.equal(anyOv.annotationController.annotations.length, 1);

    // 2) 单击文本批注 → 仅选中，不进入编辑（修复点：此前单击已选中文本会直接编辑）
    anyOv.currentTool = "select";
    h.mouseDown(420, 380);
    h.mouseUp(420, 380);
    assert.equal(sm().phase, "locked", "单击不应进入编辑态");
    assert.equal(
      anyOv.annotationController.selectedAnnotation?.type,
      "text",
      "单击应选中文本批注"
    );
    assert.ok(
      !h.wrapper.children.some((c: any) => c.tagName === "TEXTAREA"),
      "单击不应 spawn 输入框"
    );

    // 3) 双击文本批注 → 进入编辑（spawn 输入框 + editing-text）
    const fireDbl = (x: number, y: number) => {
      const fns = h.wrapper.listeners["dblclick"] || [];
      for (const fn of fns) {
        fn({
          type: "dblclick",
          clientX: x,
          clientY: y,
          preventDefault: () => {},
          stopPropagation: () => {},
          target: plainTarget,
        });
      }
    };
    fireDbl(420, 380);
    assert.equal(sm().phase, "editing-text", "双击应进入编辑态");
    assert.ok(
      h.wrapper.children.some((c: any) => c.tagName === "TEXTAREA"),
      "双击应 spawn 输入框"
    );
    // 原批注已移除，等待二次编辑提交
    assert.equal(anyOv.annotationController.annotations.length, 0);
  });

  test("非编辑态 Esc 取消截图：注册一次性 capture keyup 监听吞掉取消按键自身的 keyup", () => {
    // 增强 windowStub：只记录 once 语义的 keyup capture 监听（即 handleKeyDown 注册的那枚）
    const keyupOnce: Array<{ listener: Function; options: any }> = [];
    (globalThis as any).window = {
      ...windowStub,
      addEventListener: (type: string, listener: Function, options?: any) => {
        if (
          type === "keyup" &&
          options &&
          typeof options === "object" &&
          options.once
        ) {
          keyupOnce.push({ listener, options });
        }
      },
    };

    const overlay = new ScreenshotOverlay();
    overlay.show({
      viewportDataUrl: "data:image/png;base64,",
      onComplete: () => {},
    });
    const anyOv = overlay as any;

    anyOv.handleKeyDown({
      key: "Escape",
      type: "keydown",
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    assert.equal(keyupOnce.length, 1, "应注册一次性 capture keyup 监听");
    assert.equal(keyupOnce[0].options.capture, true);
    assert.equal(keyupOnce[0].options.once, true);

    // 模拟取消按键自身的 keyup 到达：应 preventDefault + stopPropagation（吞掉，不泄漏到页面）
    const calls: string[] = [];
    keyupOnce[0].listener({
      key: "Escape",
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });
    assert.deepEqual(calls, ["preventDefault", "stopPropagation"]);

    // 非 Escape 按键的 keyup 不应被误吞
    const calls2: string[] = [];
    keyupOnce[0].listener({
      key: "a",
      preventDefault: () => calls2.push("preventDefault"),
      stopPropagation: () => calls2.push("stopPropagation"),
    });
    assert.deepEqual(calls2, [], "非 Escape keyup 不应被吞");
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

// ---------- Enter 确认快捷键（shotConfirm 文案承诺兑现） ----------
describe("Enter 确认快捷键", () => {
  test("非编辑场景按 Enter 触发确认导出且事件被拦截", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    let confirmCalls = 0;
    anyOv.confirm = (url: string) => {
      confirmCalls++;
      assert.equal(url, "data:image/png;base64,", "应传入缓存的视口 dataURL");
    };

    const calls: string[] = [];
    anyOv.handleKeyDown({
      key: "Enter",
      code: "Enter",
      type: "keydown",
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });

    assert.equal(confirmCalls, 1, "Enter 应触发一次确认导出");
    assert.ok(calls.includes("preventDefault"), "should preventDefault");
    assert.ok(calls.includes("stopPropagation"), "should stopPropagation");
    // Enter 确认不应取消截图（overlay 保持激活，与 Esc 语义区分）
    assert.ok(
      anyOv.container,
      "overlay should stay active until confirm settles"
    );
  });

  test("文本编辑场景按 Enter 放行（textarea 换行），不触发确认", () => {
    const h = createHarness();
    const anyOv = h.overlay as any;
    anyOv.shadowRoot = {
      activeElement: {
        tagName: "TEXTAREA",
        classList: { contains: () => true },
      },
    };
    let confirmCalls = 0;
    anyOv.confirm = () => {
      confirmCalls++;
    };

    const calls: string[] = [];
    anyOv.handleKeyDown({
      key: "Enter",
      code: "Enter",
      type: "keydown",
      metaKey: false,
      ctrlKey: false,
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    });

    assert.deepEqual(calls, [], "editing text should pass Enter through");
    assert.equal(confirmCalls, 0, "编辑态 Enter 不应触发确认导出");
  });

  test("confirm 防重入：确认进行中再次触发直接忽略", async () => {
    const h = createHarness();
    const anyOv = h.overlay as any;

    // 模拟第一次确认尚未完成（processScreenshot 挂起中）
    anyOv.isConfirming = true;

    // 第二次调用应被守卫同步忽略（Promise 立即 settle），
    // 不会再次进入 processScreenshot（否则会因 Image 永不 onload 而挂起超时）
    const p = anyOv.confirm("data:image/png;base64,");
    let settled = false;
    await p.then(() => {
      settled = true;
    });
    assert.equal(settled, true, "guarded confirm should settle immediately");
  });
});

// ---------- InlineTextEditor 组件级测试 ----------
describe("InlineTextEditor", () => {
  /** wrapper.children 中按 tagName 查找 textarea（首位是幂等注入的 <style>） */
  const findTextarea = (wrapper: any): any =>
    wrapper.children.find((c: any) => c.tagName === "TEXTAREA");

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
      onClose: () => {},
      rerender: () => {},
    });

    // 提交场景
    editor.spawn(100, 100, "hello");
    const textarea = findTextarea(wrapper);
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
    const textarea2 = findTextarea(wrapper);
    textarea2.value = "changed";
    const keyFns = textarea2.listeners["keydown"];
    assert.ok(keyFns, "keydown listener should be registered");
    keyFns[0]({ type: "keydown", key: "Escape" });
    assert.ok(cancelled, "cancel should fire");
    assert.equal(cancelled.text, "original");
  });

  test("输入态视觉 = 最终气泡：样式参数与渲染层一致（所见即所得）", () => {
    const wrapper = createElementStub("div");
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {},
      rerender: () => {},
    });

    editor.spawn(100, 100, "hello");
    const textarea = findTextarea(wrapper);
    const css = textarea.style.cssText as string;

    // 渲染态 token：白底深字、实线蓝边框、轻阴影、6px 圆角、13px/400、行高 18px、padding 6/10
    assert.ok(css.includes("background: rgba(255, 255, 255, 0.94)"), css);
    assert.ok(css.includes("color: #1f2937"), css);
    assert.ok(css.includes("border: 1px solid #0284c7"), css);
    assert.ok(css.includes("box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25)"), css);
    assert.ok(css.includes("border-radius: 6px"), css);
    assert.ok(css.includes("font-size: 13px"), css);
    assert.ok(css.includes("font-weight: 400"), css);
    assert.ok(css.includes("line-height: 18px"), css);
    assert.ok(css.includes("padding: 6px 10px"), css);
    assert.ok(css.includes("min-width: 80px"), css);

    // 旧输入态样式全部退役（含上一版深底白字）
    assert.ok(!css.includes("#ff3b30"), "红色输入文字应移除");
    assert.ok(!css.includes("dashed"), "虚线边框应移除");
    assert.ok(!css.includes("text-shadow"), "投影应移除");
    assert.ok(!css.includes("rgba(15, 23, 42"), "深底应移除");
    assert.ok(!css.includes("#f8fafc"), "亮白文字应移除");

    // 占位符样式幂等注入：仅一个 <style>，白底上浅灰占位符
    const styles = wrapper.children.filter((c: any) => c.tagName === "STYLE");
    assert.equal(styles.length, 1, "style 只注入一次");
    assert.ok(
      styles[0].textContent.includes("::placeholder"),
      "占位符配色已注入"
    );
    assert.ok(
      styles[0].textContent.includes("rgba(31, 41, 55, 0.45)"),
      "占位符为白底浅灰"
    );
  });

  test("编辑已有批注时输入态沿用其文字色（所见即所得）", () => {
    const wrapper = createElementStub("div");
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {},
      rerender: () => {},
    });

    // 不带 color → 默认近黑
    editor.spawn(100, 100, "hello");
    let textarea = findTextarea(wrapper);
    assert.ok(
      textarea.style.cssText.includes("color: #1f2937"),
      "默认色为近黑"
    );
    textarea.remove();

    // 带 color → 输入态文字用批注色
    editor.spawn(200, 200, "colored", "#dc2626");
    textarea = findTextarea(wrapper);
    assert.ok(
      textarea.style.cssText.includes("color: #dc2626"),
      "编辑时沿用批注文字色"
    );
  });

  test("输入时气泡尺寸实时跟随布局（所见即所得）", () => {
    const wrapper = createElementStub("div");
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {},
      rerender: () => {},
    });

    editor.spawn(100, 100);
    const textarea = findTextarea(wrapper);
    textarea.value = "hello world";

    // 触发 input → syncSize：width = bgWidth（估算 "hello world" = 10*6.7+3.6+20 ≈ 90.6px）
    const inputFns = textarea.listeners["input"];
    assert.ok(inputFns, "input listener should be registered");
    inputFns[0]({ type: "input" });
    assert.ok(textarea.style.width.endsWith("px"), textarea.style.width);
    assert.ok(textarea.style.height.endsWith("px"), textarea.style.height);

    // 空文本回落最小宽 80px
    textarea.value = "";
    inputFns[0]({ type: "input" });
    assert.equal(textarea.style.width, "80px");
  });

  test("空文本 blur 关闭：触发 onClose 且输入框移除", () => {
    const wrapper = createElementStub("div");
    let closed = 0;
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {
        closed++;
      },
      rerender: () => {},
    });

    editor.spawn(100, 100);
    const textarea = findTextarea(wrapper);
    textarea.value = ""; // 未输入任何内容
    const blurFns = textarea.listeners["blur"];
    assert.ok(blurFns, "blur listener should be registered");
    blurFns[0]({ type: "blur" });
    assert.equal(closed, 1, "空文本关闭应触发 onClose（状态机恢复 locked）");
    assert.ok(
      !wrapper.children.some((c: any) => c.tagName === "TEXTAREA"),
      "textarea 应被移除"
    );
  });

  test("二次编辑清空文字确认：rerender 与 onClose 均触发", () => {
    const wrapper = createElementStub("div");
    let closed = 0;
    let rerendered = 0;
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {
        closed++;
      },
      rerender: () => {
        rerendered++;
      },
    });

    editor.spawn(100, 100, "original");
    const textarea = findTextarea(wrapper);
    textarea.value = ""; // 清空原有文字
    const blurFns = textarea.listeners["blur"];
    blurFns[0]({ type: "blur" });
    assert.equal(rerendered, 1, "应重绘清除原文字");
    assert.equal(closed, 1, "清空确认应触发 onClose（状态机恢复 locked）");
  });

  test("cancelEdit：空输入触发 onClose，二次编辑 Esc 还原原文", () => {
    const wrapper = createElementStub("div");
    let closed = 0;
    let cancelled: any = null;
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: (ann) => {
        cancelled = ann;
      },
      onClose: () => {
        closed++;
      },
      rerender: () => {},
    });

    // 新建空输入：cancelEdit → onClose
    editor.spawn(100, 100);
    editor.cancelEdit();
    assert.equal(closed, 1, "空输入取消应触发 onClose");
    assert.equal(cancelled, null, "空输入取消不应走 cancelAnnotation");

    // 二次编辑：cancelEdit → 还原原文
    editor.spawn(200, 200, "original");
    editor.cancelEdit();
    assert.ok(cancelled, "应还原原文");
    assert.equal(cancelled.text, "original");
    assert.equal(cancelled.position.x, 200);
    assert.equal(closed, 1, "还原原文路径不应额外触发 onClose");
  });

  test("cancelEdit 幂等：重复调用只处理一次", () => {
    const wrapper = createElementStub("div");
    let closed = 0;
    const editor = new InlineTextEditor({
      wrapper,
      getSelection: () => ({ x: 0, y: 0, width: 500, height: 400 }),
      commitAnnotation: () => {},
      cancelAnnotation: () => {},
      onClose: () => {
        closed++;
      },
      rerender: () => {},
    });

    editor.spawn(100, 100);
    editor.cancelEdit();
    editor.cancelEdit(); // 第二次调用应为 no-op
    assert.equal(closed, 1, "重复取消只触发一次 onClose");
  });
});
