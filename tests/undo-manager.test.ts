import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UndoManager } from "../src/shared/undo-manager.ts";
import type { AnnotationItem } from "../src/domain/screenshot-payload.ts";

function rect(id: string): AnnotationItem {
  return {
    id,
    type: "rect",
    bounds: { x: 10, y: 10, width: 100, height: 50 },
  };
}

describe("UndoManager (Generic Shared)", () => {
  test("record 深拷贝快照：修改源数组不影响快照", () => {
    const m = new UndoManager<AnnotationItem[]>();
    const a = rect("a");
    m.record([a]);
    a.bounds.x = 999;
    const out = m.undo([]);
    assert.deepEqual(out, [rect("a")]);
  });

  test("undo 非空列表：先记录快照再移除最后一个；列表空后回退快照", () => {
    const m = new UndoManager<AnnotationItem[]>();
    let list: AnnotationItem[] = [];
    m.record(list); // 添加 a 之前
    list = [rect("a")];
    m.record(list); // 添加 b 之前
    list = [rect("a"), rect("b")];

    list = m.undo(list); // 非空 → 移除 b，且先记录 [a,b]
    assert.deepEqual(
      list.map((x) => x.id),
      ["a"]
    );

    list = m.undo(list); // 非空 → 移除 a，且先记录 [a]
    assert.deepEqual(list, []);

    list = m.undo(list); // 空 → 回退最近快照
    assert.deepEqual(
      list.map((x) => x.id),
      ["a"]
    );

    list = m.undo(list); // 非空 → 移除 a
    assert.deepEqual(list, []);
  });

  test("undo 空列表且栈空：返回原数组（同一引用，无副作用）", () => {
    const m = new UndoManager<AnnotationItem[]>();
    const empty: AnnotationItem[] = [];
    assert.equal(m.undo(empty), empty);
  });

  test("栈上限 30：最早快照被丢弃", () => {
    const m = new UndoManager<AnnotationItem[]>({ limit: 30 });
    for (let i = 0; i < 31; i++) m.record([rect(`a${i}`)]);
    const empty: AnnotationItem[] = [];
    for (let i = 0; i < 30; i++) {
      const popped = m.undo(empty); // 空列表 → 弹出一个快照
      assert.equal(popped[0]?.id, `a${30 - i}`);
    }
    const before = empty;
    assert.equal(m.undo(empty), before); // 第 31 次栈已空，无操作
  });

  test("redo 重做测试：undo 后可成功 redo 回退", () => {
    const m = new UndoManager<string[]>();
    let list = ["step1"];
    m.record(list);
    list = ["step1", "step2"];

    list = m.undo(list);
    assert.deepEqual(list, ["step1"]);
    assert.equal(m.canRedo, true);

    list = m.redo(list);
    assert.deepEqual(list, ["step1", "step2"]);
    assert.equal(m.canRedo, false);
  });

  test("record 产生新动作时丢弃 future (Redo) 栈", () => {
    const m = new UndoManager<string[]>();
    let list = ["step1"];
    m.record(list);
    list = ["step1", "step2"];

    list = m.undo(list);
    assert.equal(m.canRedo, true);

    m.record(list); // 新记录产生
    assert.equal(m.canRedo, false);
  });

  test("reset 清空所有栈与状态", () => {
    const m = new UndoManager<AnnotationItem[]>();
    m.record([rect("a")]);
    m.reset();
    assert.equal(m.canUndo, false);
    assert.equal(m.canRedo, false);
    const empty: AnnotationItem[] = [];
    assert.equal(m.undo(empty), empty);
  });
});
