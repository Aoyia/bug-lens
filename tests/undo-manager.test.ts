import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UndoManager } from "../src/screenshot/undo-manager.ts";
import type { AnnotationItem } from "../src/domain/screenshot-payload.ts";

function rect(id: string): AnnotationItem {
  return {
    id,
    type: "rect",
    bounds: { x: 10, y: 10, width: 100, height: 50 },
  };
}

describe("UndoManager", () => {
  test("record 深拷贝快照：修改源数组不影响快照", () => {
    const m = new UndoManager();
    const a = rect("a");
    m.record([a]);
    a.bounds.x = 999;
    const out = m.undo([]);
    assert.deepEqual(out, [rect("a")]);
  });

  test("undo 非空列表：先记录快照再移除最后一个；列表空后回退快照", () => {
    const m = new UndoManager();
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
    const m = new UndoManager();
    const empty: AnnotationItem[] = [];
    assert.equal(m.undo(empty), empty);
  });

  test("栈上限 30：最早快照被丢弃", () => {
    const m = new UndoManager();
    for (let i = 0; i < 31; i++) m.record([rect(`a${i}`)]);
    const empty: AnnotationItem[] = [];
    for (let i = 0; i < 30; i++) {
      const popped = m.undo(empty); // 空列表 → 弹出一个快照
      assert.equal(popped[0]?.id, `a${30 - i}`);
    }
    const before = empty;
    assert.equal(m.undo(empty), before); // 第 31 次栈已空，无操作
  });

  test("reset 清空栈", () => {
    const m = new UndoManager();
    m.record([rect("a")]);
    m.reset();
    const empty: AnnotationItem[] = [];
    assert.equal(m.undo(empty), empty);
  });
});
