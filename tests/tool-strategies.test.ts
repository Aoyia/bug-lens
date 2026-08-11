import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getToolStrategy,
  type ToolContext,
  type Point,
} from "../src/screenshot/tools/tool-registry.ts";
import type { AnnotationItem } from "../src/domain/screenshot-payload.ts";
import type { OverlayPhase } from "../src/screenshot/overlay-state.ts";

interface CallRecord {
  start: Point | null;
  temp: AnnotationItem | null;
  committed: AnnotationItem[];
  spawned: Point[];
}

function createToolCtx(overrides: Partial<ToolContext> = {}): {
  ctx: ToolContext;
  rec: CallRecord;
} {
  const rec: CallRecord = {
    start: null,
    temp: null,
    committed: [],
    spawned: [],
  };
  const ctx: ToolContext = {
    selection: { x: 0, y: 0, width: 100, height: 100 },
    getPhase: () => "drawing" as OverlayPhase,
    getStartPoint: () => rec.start,
    setStartPoint: (p) => {
      rec.start = p;
    },
    setTempAnnotation: (ann) => {
      rec.temp = ann;
    },
    commitTemp: () => {
      if (rec.temp) {
        rec.committed.push(rec.temp);
        rec.temp = null;
      }
    },
    spawnInlineTextInput: (x, y) => {
      rec.spawned.push({ x, y });
    },
    rerender: () => {},
    ...overrides,
  };
  return { ctx, rec };
}

describe("ToolStrategy: rect", () => {
  test("onDown：选区内按下写入 clamp 起点并返回 true；无选区返回 false", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("rect")!;
    assert.equal(t.onDown({ x: 10, y: 10 }, ctx), true);
    assert.deepEqual(rec.start, { x: 10, y: 10 });
    assert.equal(
      t.onDown({ x: 150, y: 50 }, { ...ctx, selection: null }),
      false
    );
  });

  test("onMove：由起点与当前点生成 bounds 临时批注（clamp + min/max）", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("rect")!;
    t.onDown({ x: 10, y: 10 }, ctx);
    t.onMove({ x: 60, y: 40 }, ctx);
    assert.ok(rec.temp);
    assert.equal(rec.temp!.type, "rect");
    assert.deepEqual((rec.temp as any).bounds, {
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    });
  });

  test("onUp：commitTemp 提交并返回 committed", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("rect")!;
    t.onDown({ x: 10, y: 10 }, ctx);
    t.onMove({ x: 60, y: 40 }, ctx);
    assert.equal(t.onUp({ x: 60, y: 40 }, ctx), "committed");
    assert.equal(rec.committed.length, 1);
    assert.equal(rec.temp, null);
  });
});

describe("ToolStrategy: arrow", () => {
  test("onMove：生成 startPoint/endPoint 临时批注", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("arrow")!;
    t.onDown({ x: 10, y: 10 }, ctx);
    t.onMove({ x: 80, y: 30 }, ctx);
    assert.equal(rec.temp!.type, "arrow");
    assert.deepEqual((rec.temp as any).startPoint, { x: 10, y: 10 });
    assert.deepEqual((rec.temp as any).endPoint, { x: 80, y: 30 });
  });
});

describe("ToolStrategy: privacy", () => {
  test("onMove：生成 bounds 临时批注（同 rect）", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("privacy")!;
    t.onDown({ x: 20, y: 20 }, ctx);
    t.onMove({ x: 70, y: 60 }, ctx);
    assert.equal(rec.temp!.type, "privacy");
    assert.deepEqual((rec.temp as any).bounds, {
      x: 20,
      y: 20,
      width: 50,
      height: 40,
    });
  });
});

describe("ToolStrategy: text", () => {
  test("onMove：no-op，不产生临时批注", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("text")!;
    t.onDown({ x: 10, y: 10 }, ctx);
    t.onMove({ x: 50, y: 50 }, ctx);
    assert.equal(rec.temp, null);
  });

  test("onUp：spawnInlineTextInput 并返回 spawned-text", () => {
    const { ctx, rec } = createToolCtx();
    const t = getToolStrategy("text")!;
    t.onDown({ x: 10, y: 10 }, ctx);
    assert.equal(t.onUp({ x: 30, y: 40 }, ctx), "spawned-text");
    assert.deepEqual(rec.spawned, [{ x: 30, y: 40 }]);
  });
});

describe("getToolStrategy", () => {
  test("未知工具返回 null；已知工具返回对应策略", () => {
    assert.equal(getToolStrategy("select"), null);
    assert.equal(getToolStrategy("rect")!.id, "rect");
    assert.equal(getToolStrategy("text")!.id, "text");
  });
});
