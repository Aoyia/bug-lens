import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getRenderer } from "../src/screenshot/renderers/renderer-registry.ts";

function createRecordingCtx(): { ctx: any; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "measureText")
          return (s: string) => ({ width: s.length * 8 });
        if (prop === "roundRect") return undefined; // 走 else 分支
        if (typeof prop === "string") {
          return (...args: any[]) => {
            calls.push(`${String(prop)}:${JSON.stringify(args)}`);
          };
        }
        return undefined;
      },
      set(t, prop, value) {
        (t as any)[prop] = value;
        return true;
      },
    }
  );
  return { ctx, calls };
}

const RC = { selection: null, viewportImage: null };

describe("RendererRegistry: rect", () => {
  const ann = {
    id: "1",
    type: "rect" as const,
    bounds: { x: 10, y: 10, width: 50, height: 40 },
  };

  test("getRenderer('rect') 返回 type=rect 的渲染器", () => {
    assert.equal(getRenderer("rect").type, "rect");
  });

  test("hitTest：边缘带命中、内部空心穿透、外不命中", () => {
    const r = getRenderer("rect");
    // 内部空心（距边 > 6px）→ 不命中
    assert.equal(r.hitTest(ann, 20, 20), false);
    assert.equal(r.hitTest(ann, 30, 30), false);
    // 边缘带 → 命中（左/上/右边缘，含 +6 外扩容差与收缩内边缘）
    assert.equal(r.hitTest(ann, 10, 30), true); // 左边缘中点
    assert.equal(r.hitTest(ann, 35, 10), true); // 上边缘中点
    assert.equal(r.hitTest(ann, 66, 30), true); // 右边缘 +6 外扩（maxX=60, 60+6=66）
    assert.equal(r.hitTest(ann, 16, 30), true); // 距左边 6px（收缩边界内缘）
    // 远处 → 不命中
    assert.equal(r.hitTest(ann, 100, 100), false);
  });

  test("hitTest：小矩形（宽/高 ≤ 2×阈值）退化整框命中", () => {
    const r = getRenderer("rect");
    const small = { ...ann, bounds: { x: 10, y: 10, width: 10, height: 10 } };
    assert.equal(r.hitTest(small, 15, 15), true); // 内部也命中（退化）
    assert.equal(r.hitTest(small, 12, 12), true); // 角部命中
    assert.equal(r.hitTest(small, 30, 30), false); // 远处不命中
    const thin = { ...ann, bounds: { x: 10, y: 10, width: 5, height: 40 } };
    assert.equal(r.hitTest(thin, 12, 30), true); // 极扁框整框命中
  });

  test("hitTestHandle：四角返回 nw/ne/se/sw，内部返回 null", () => {
    const r = getRenderer("rect");
    assert.equal(r.hitTestHandle(ann, 10, 10), "nw");
    assert.equal(r.hitTestHandle(ann, 60, 10), "ne");
    assert.equal(r.hitTestHandle(ann, 60, 50), "se");
    assert.equal(r.hitTestHandle(ann, 10, 50), "sw");
    assert.equal(r.hitTestHandle(ann, 30, 30), null);
  });

  test("drag：bounds.x/y 平移", () => {
    const r = getRenderer("rect");
    r.drag(ann, 5, -3);
    assert.deepEqual(ann.bounds, { x: 15, y: 7, width: 50, height: 40 });
  });

  test("resize：se 角放大、nw 角移动并缩窄、小于下限忽略", () => {
    const r = getRenderer("rect");
    const a = { ...ann, bounds: { x: 10, y: 10, width: 50, height: 40 } };
    r.resize(a, 5, 5, "se", RC);
    assert.deepEqual(a.bounds, { x: 10, y: 10, width: 55, height: 45 });
    r.resize(a, -3, 2, "nw", RC);
    assert.deepEqual(a.bounds, { x: 7, y: 12, width: 58, height: 43 });
    r.resize(a, 100, 0, "sw", RC); // width 会 < 10，忽略
    assert.deepEqual(a.bounds, { x: 7, y: 12, width: 58, height: 43 });
  });

  test("draw：发起 beginPath 并 fill（evenodd）", () => {
    const { ctx, calls } = createRecordingCtx();
    getRenderer("rect").draw(ctx, ann, RC);
    assert.ok(calls.some((c) => c.startsWith("beginPath:")));
    assert.ok(calls.some((c) => c.startsWith("fill:")));
  });
});

describe("RendererRegistry: arrow", () => {
  const ann = {
    id: "2",
    type: "arrow" as const,
    startPoint: { x: 10, y: 10 },
    endPoint: { x: 60, y: 60 },
  };

  test("getRenderer('arrow') 返回 type=arrow", () => {
    assert.equal(getRenderer("arrow").type, "arrow");
  });

  test("hitTest：线段距离 <= 10 命中，远处不命中", () => {
    const r = getRenderer("arrow");
    assert.equal(r.hitTest(ann, 35, 35), true);
    assert.equal(r.hitTest(ann, 10, 20), true); // 距线段约 7.1 <= 10
    assert.equal(r.hitTest(ann, 0, 100), false);
    assert.equal(r.hitTest(ann, 10, 40), false); // 距线段约 21.2 > 10
  });

  test("hitTestHandle：start/end 端点命中，中部 null", () => {
    const r = getRenderer("arrow");
    assert.equal(r.hitTestHandle(ann, 10, 10), "start");
    assert.equal(r.hitTestHandle(ann, 60, 60), "end");
    assert.equal(r.hitTestHandle(ann, 35, 35), null);
  });

  test("drag：两点同时平移", () => {
    const r = getRenderer("arrow");
    r.drag(ann, 5, -3);
    assert.deepEqual(ann.startPoint, { x: 15, y: 7 });
    assert.deepEqual(ann.endPoint, { x: 65, y: 57 });
  });

  test("resize：start 端点移动并被 clamp 到选区", () => {
    const r = getRenderer("arrow");
    const a = {
      id: "2",
      type: "arrow" as const,
      startPoint: { x: 10, y: 10 },
      endPoint: { x: 60, y: 60 },
    };
    r.resize(a, 5, 5, "start", {
      selection: { x: 0, y: 0, width: 100, height: 100 },
      viewportImage: null,
    });
    assert.deepEqual(a.startPoint, { x: 15, y: 15 });
    assert.deepEqual(a.endPoint, { x: 60, y: 60 });
  });

  test("draw：绘制线段与箭头三角", () => {
    const { ctx, calls } = createRecordingCtx();
    getRenderer("arrow").draw(ctx, ann, RC);
    assert.ok(calls.some((c) => c.startsWith("lineTo:")));
    assert.ok(calls.some((c) => c.startsWith("closePath:")));
  });
});

describe("RendererRegistry: privacy", () => {
  test("getRenderer('privacy') 返回 type=privacy", () => {
    assert.equal(getRenderer("privacy").type, "privacy");
  });

  test("hitTest：边缘带命中、内部空心穿透、外不命中", () => {
    const r = getRenderer("privacy");
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 10, y: 10, width: 50, height: 40 },
    };
    // 内部空心（距边 > 6px）→ 不命中
    assert.equal(r.hitTest(ann, 20, 20), false);
    assert.equal(r.hitTest(ann, 30, 30), false);
    // 边缘带 → 命中
    assert.equal(r.hitTest(ann, 10, 30), true); // 左边缘中点
    assert.equal(r.hitTest(ann, 35, 10), true); // 上边缘中点
    assert.equal(r.hitTest(ann, 66, 30), true); // 右边缘 +6 外扩（maxX=60, 60+6=66）
    // 远处 → 不命中
    assert.equal(r.hitTest(ann, 100, 100), false);
  });

  test("hitTest：小矩形（宽/高 ≤ 2×阈值）退化整框命中", () => {
    const r = getRenderer("privacy");
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 10, y: 10, width: 50, height: 40 },
    };
    const small = { ...ann, bounds: { x: 10, y: 10, width: 10, height: 10 } };
    assert.equal(r.hitTest(small, 15, 15), true); // 内部也命中（退化）
    assert.equal(r.hitTest(small, 30, 30), false); // 远处不命中
  });

  test("hitTestHandle：四角返回名称、内部 null", () => {
    const r = getRenderer("privacy");
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 10, y: 10, width: 50, height: 40 },
    };
    assert.equal(r.hitTestHandle(ann, 10, 10), "nw");
    assert.equal(r.hitTestHandle(ann, 60, 50), "se");
    assert.equal(r.hitTestHandle(ann, 30, 30), null);
  });

  test("drag：bounds.x/y 平移", () => {
    const r = getRenderer("privacy");
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 10, y: 10, width: 50, height: 40 },
    };
    r.drag(ann, 2, 3);
    assert.deepEqual(ann.bounds, { x: 12, y: 13, width: 50, height: 40 });
  });

  test("resize：se 角放大", () => {
    const r = getRenderer("privacy");
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 12, y: 13, width: 50, height: 40 },
    };
    r.resize(ann, 2, 2, "se", RC);
    assert.deepEqual(ann.bounds, { x: 12, y: 13, width: 52, height: 42 });
  });

  test("draw：无 viewportImage 时走半透明填充兜底", () => {
    const { ctx, calls } = createRecordingCtx();
    const ann = {
      id: "3",
      type: "privacy" as const,
      bounds: { x: 10, y: 10, width: 50, height: 40 },
    };
    const savedWindow = (globalThis as any).window;
    (globalThis as any).window = { devicePixelRatio: 1 };
    try {
      getRenderer("privacy").draw(ctx, ann, RC); // RC.viewportImage = null
    } finally {
      (globalThis as any).window = savedWindow;
    }
    assert.ok(calls.some((c) => c.startsWith("fillRect:")));
  });
});

describe("RendererRegistry: text", () => {
  test("getRenderer('text') 返回 type=text", () => {
    assert.equal(getRenderer("text").type, "text");
  });

  test("hitTest：背景框内命中、外不命中（node 无 2d ctx 走估算布局）", () => {
    const r = getRenderer("text");
    const ann = {
      id: "4",
      type: "text" as const,
      position: { x: 10, y: 10 },
      text: "hello world",
    };
    // 单行 "hello world"（10 字母 + 1 空格）：估算 maxW=10*6.7+3.6=70.6 → bgW=max(80, 70.6+20)=90.6，bgH=32
    // 命中区 = (10-4,10-4) ~ (10+93.7+4, 10+32+4) = (6,6)~(107.7,46)
    assert.equal(r.hitTest(ann, 20, 20), true); // 内部
    assert.equal(r.hitTest(ann, 6, 44), true); // 左下角边界
    assert.equal(r.hitTest(ann, 167, 20), false); // 右边界外
    assert.equal(r.hitTest(ann, 500, 500), false); // 远处
  });

  test("hitTestHandle：text 无手柄返回 null", () => {
    const ann = {
      id: "4",
      type: "text" as const,
      position: { x: 10, y: 10 },
      text: "hello world",
    };
    assert.equal(getRenderer("text").hitTestHandle(ann, 20, 20), null);
  });

  test("drag：position 平移", () => {
    const ann = {
      id: "4",
      type: "text" as const,
      position: { x: 10, y: 10 },
      text: "hello world",
    };
    getRenderer("text").drag(ann, 5, -3);
    assert.deepEqual(ann.position, { x: 15, y: 7 });
  });

  test("resize：text 无手柄，no-op 不抛错", () => {
    const ann = {
      id: "4",
      type: "text" as const,
      position: { x: 10, y: 10 },
      text: "hello world",
    };
    getRenderer("text").resize(ann, 5, 5, "nw", RC);
    assert.deepEqual(ann.position, { x: 10, y: 10 });
  });

  test("draw：measureText 换行 + 背景框 fill + fillText", () => {
    const { ctx, calls } = createRecordingCtx();
    const ann = {
      id: "4",
      type: "text" as const,
      position: { x: 10, y: 10 },
      text: "hello world",
    };
    getRenderer("text").draw(ctx, ann, {
      selection: { x: 0, y: 0, width: 500, height: 500 },
      viewportImage: null,
    });
    const fillTextCalls = calls.filter((c) => c.startsWith("fillText:"));
    assert.ok(fillTextCalls.length >= 1);
    assert.ok(calls.some((c) => c.startsWith("fill:")));
  });
});
