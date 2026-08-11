import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeTextLayout,
  estimateTextWidth,
  TEXT_MIN_WIDTH,
  TEXT_MAX_WIDTH,
} from "../src/screenshot/text-layout.ts";
import {
  getDeleteButtonPosition,
  hitTestAnnotation,
} from "../src/screenshot/annotation-renderer.ts";

describe("text-layout 估算器", () => {
  test("CJK 字符宽度明显大于 ASCII（13px vs 6.7px）", () => {
    const cjk = estimateTextWidth("截图缺陷");
    const ascii = estimateTextWidth("hello");
    assert.equal(cjk, 13 * 4);
    assert.equal(ascii, 6.7 * 5);
    assert.ok(cjk > ascii * 1.5, "中文应显著宽于英文");
  });

  test("混合文本宽度 = 分类求和", () => {
    assert.equal(estimateTextWidth("a中文b"), 6.7 + 13 + 13 + 6.7);
  });

  test("空串宽度为 0", () => {
    assert.equal(estimateTextWidth(""), 0);
  });
});

describe("computeTextLayout 默认估算布局", () => {
  test("短英文文本宽度受 TEXT_MIN_WIDTH 兜底", () => {
    const layout = computeTextLayout("hi");
    assert.equal(layout.bgWidth, TEXT_MIN_WIDTH);
    assert.equal(layout.bgHeight, 12 + 18); // 2*paddingY + 1 行
    assert.deepEqual(layout.lines, ["hi"]);
  });

  test("中文超长文本按 maxWidth 换行，气泡不超宽", () => {
    const text = "这是一段非常长的中文标注文字用来验证自动换行行为是否正确";
    const layout = computeTextLayout(text, { maxWidth: 200 });
    assert.ok(layout.lines.length >= 2, "长中文应换行");
    assert.ok(layout.bgWidth <= 200, "气泡宽度不应超过 maxWidth");
    assert.ok(layout.bgWidth >= TEXT_MIN_WIDTH);
  });

  test("显式 measure 与默认估算共用同一换行/尺寸公式", () => {
    const text = "bug 截图 说明";
    const estimated = computeTextLayout(text);
    const measured = computeTextLayout(text, {
      measure: (s) => s.length * 6.7, // 模拟全 ASCII 度量
    });
    // 结构一致：行数相同、宽高公式相同（数值可能不同但形状一致）
    assert.equal(estimated.lines.length, measured.lines.length);
    assert.ok(estimated.bgHeight === measured.bgHeight);
  });
});

describe("布局统一：删除按钮 / 命中 / 绘制共用同一布局", () => {
  const textAnn = {
    id: "t1",
    type: "text" as const,
    position: { x: 100, y: 80 },
    text: "点击位置即气泡锚点",
  };

  test("删除按钮锚点 = position + 气泡宽 + 8（与 computeTextLayout 一致）", () => {
    const layout = computeTextLayout(textAnn.text);
    const del = getDeleteButtonPosition(textAnn);
    assert.ok(del, "text 应有删除按钮");
    assert.equal(del!.x, textAnn.position.x + layout.bgWidth + 8);
    assert.equal(del!.y, textAnn.position.y - 8);
  });

  test("命中区 = 气泡区域 ±4px：边缘命中、外侧不命中", () => {
    const layout = computeTextLayout(textAnn.text);
    const { x, y } = textAnn.position;

    // 气泡边缘内 1px → 命中
    assert.equal(
      hitTestAnnotation([textAnn], x + layout.bgWidth - 1, y + 1),
      textAnn
    );
    // 气泡外 10px → 不命中（旧实现按 320px 宽估算会误命中）
    assert.equal(
      hitTestAnnotation([textAnn], x + layout.bgWidth + 10, y + 1),
      null
    );
    // 左上容差边界命中
    assert.equal(hitTestAnnotation([textAnn], x - 4, y - 4), textAnn);
    // 远处不命中
    assert.equal(hitTestAnnotation([textAnn], x + 500, y + 500), null);
  });

  test("短文本：命中区宽度不低于 TEXT_MIN_WIDTH（与绘制一致）", () => {
    const short = {
      id: "t2",
      type: "text" as const,
      position: { x: 50, y: 50 },
      text: "ok",
    };
    const layout = computeTextLayout(short.text);
    assert.equal(layout.bgWidth, TEXT_MIN_WIDTH);
    assert.equal(
      hitTestAnnotation([short], 50 + TEXT_MIN_WIDTH + 2, 50),
      short
    );
    assert.equal(hitTestAnnotation([short], 50 + TEXT_MAX_WIDTH, 50), null);
  });
});
