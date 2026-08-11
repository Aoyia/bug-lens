import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OverlayStateMachine } from "../src/screenshot/overlay-state.ts";

const ALL_PHASES = [
  "idle",
  "selecting",
  "resizing-selection",
  "dragging-selection",
  "locked",
  "drawing",
  "dragging-annotation",
  "resizing-annotation",
  "editing-text",
] as const;

const TABLE: Record<string, readonly string[]> = {
  idle: ["selecting", "locked", "drawing", "resizing-selection"],
  selecting: ["locked"],
  "resizing-selection": ["locked"],
  "dragging-selection": ["locked"],
  locked: [
    "drawing",
    "dragging-annotation",
    "resizing-annotation",
    "editing-text",
    "resizing-selection",
    "dragging-selection",
  ],
  drawing: ["locked", "editing-text"],
  "dragging-annotation": ["locked"],
  "resizing-annotation": ["locked"],
  "editing-text": ["locked"],
};

function pathTo(state: string): string[] {
  switch (state) {
    case "idle":
      return [];
    case "locked":
      return ["locked"];
    case "selecting":
      return ["selecting"];
    case "resizing-selection":
      return ["locked", "resizing-selection"];
    case "dragging-selection":
      return ["locked", "dragging-selection"];
    case "drawing":
      return ["locked", "drawing"];
    case "dragging-annotation":
      return ["locked", "dragging-annotation"];
    case "resizing-annotation":
      return ["locked", "resizing-annotation"];
    case "editing-text":
      return ["locked", "editing-text"];
  }
  return [];
}

describe("OverlayStateMachine", () => {
  test("初始 phase 为 idle", () => {
    const sm = new OverlayStateMachine();
    assert.equal(sm.phase, "idle");
  });

  test("典型交互路径：idle → selecting → locked → drawing → editing-text → locked", () => {
    const sm = new OverlayStateMachine();
    sm.transition("selecting");
    assert.equal(sm.phase, "selecting");
    sm.transition("locked");
    assert.equal(sm.phase, "locked");
    sm.transition("drawing");
    assert.equal(sm.phase, "drawing");
    sm.transition("editing-text");
    assert.equal(sm.phase, "editing-text");
    sm.transition("locked");
    assert.equal(sm.phase, "locked");
  });

  test("全量转移表：每个 phase 的合法目标与 TABLE 一致", () => {
    for (const from of ALL_PHASES) {
      for (const to of ALL_PHASES) {
        const sm = new OverlayStateMachine();
        for (const p of pathTo(from)) sm.transition(p as any);
        assert.equal(
          sm.can(to as any),
          TABLE[from].includes(to),
          `can(${from} -> ${to}) 应与转移表一致`
        );
      }
    }
  });

  test("非法转移被拒绝且 phase 不变", () => {
    const sm = new OverlayStateMachine();
    sm.transition("dragging-selection"); // idle -> dragging-selection 非法
    assert.equal(sm.phase, "idle");
    sm.transition("editing-text"); // idle -> editing-text 非法
    assert.equal(sm.phase, "idle");
    sm.transition("locked");
    sm.transition("locked"); // locked -> locked 非法
    assert.equal(sm.phase, "locked");
    sm.transition("idle"); // locked -> idle 非法
    assert.equal(sm.phase, "locked");
    sm.transition("selecting"); // locked -> selecting 非法
    assert.equal(sm.phase, "locked");
  });

  test("reset 回到 idle", () => {
    const sm = new OverlayStateMachine();
    sm.transition("locked");
    sm.transition("drawing");
    sm.reset();
    assert.equal(sm.phase, "idle");
  });
});
