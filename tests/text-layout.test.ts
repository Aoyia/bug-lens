import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeTextLayout,
  estimateTextWidth,
  TEXT_MIN_WIDTH,
  TEXT_MAX_WIDTH,
} from "../src/screenshot/text-layout.ts";
import { hitTestAnnotation } from "../src/screenshot/annotation-renderer.ts";

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

  test("空格宽度独立估算（3.6px < 字母 6.7px）", () => {
    assert.equal(estimateTextWidth("a b"), 6.7 + 3.6 + 6.7);
    assert.ok(estimateTextWidth("a b") < estimateTextWidth("abc"));
  });
});

describe("computeTextLayout 换行规则（浏览器 word-wrap 语义）", () => {
  test("英文按词断行：单词不切断、行首无空格", () => {
    // "hello world foo bar" = 18*6.7 + 3*3.6 = 131.4；maxWidth 80 只能容纳 2 个词
    const layout = computeTextLayout("hello world foo bar", {
      maxWidth: 80,
    });
    assert.deepEqual(layout.lines, ["hello world", "foo bar"]);
  });

  test("超长单词（无断行机会）才在词内硬切", () => {
    // 20 字母 × 6.7 = 134 > 30 → 每行最多 4 字母（4*6.7=26.8 ≤ 30）
    const layout = computeTextLayout("supercalifragilistic", {
      maxWidth: 30,
    });
    assert.equal(layout.lines.length, 5);
    assert.ok(
      layout.lines.every((l) => estimateTextWidth(l) <= 30),
      "硬切后每行不超 maxWidth"
    );
  });

  test("CJK 逐字断行：每行不超过 maxWidth", () => {
    // 13px/字，maxWidth 40 → 每行最多 3 字
    const layout = computeTextLayout("一二三四五六七八九十", {
      maxWidth: 40,
    });
    assert.deepEqual(layout.lines, ["一二三", "四五六", "七八九", "十"]);
  });

  test("中英混排：英文词整体移行不被切断", () => {
    // "页面加载"=52 ≤ 80；+"failed"=92.2 > 80 → failed 整体换行
    const layout = computeTextLayout("页面加载failed请重试", {
      maxWidth: 80,
    });
    assert.deepEqual(layout.lines, ["页面加载", "failed请重试"]);
  });

  test("手动换行 \\n 保留：空行占一行行高", () => {
    const layout = computeTextLayout("a\n\nb");
    assert.deepEqual(layout.lines, ["a", "", "b"]);
    assert.equal(layout.bgHeight, 14 + 3 * 18);
  });

  test("长文本多行：每行宽不超 maxWidth，bgWidth 取最长行", () => {
    const text = "hello world foo bar baz qux";
    const layout = computeTextLayout(text, { maxWidth: 80 });
    assert.ok(layout.lines.length >= 2);
    for (const l of layout.lines) {
      assert.ok(estimateTextWidth(l) <= 80, `行超宽: "${l}"`);
    }
    const maxLineW = Math.max(...layout.lines.map(estimateTextWidth));
    assert.equal(
      layout.bgWidth,
      Math.max(TEXT_MIN_WIDTH, Math.min(80, maxLineW + 20))
    );
  });
});

describe("computeTextLayout 默认估算布局", () => {
  test("短英文文本宽度受 TEXT_MIN_WIDTH 兜底", () => {
    const layout = computeTextLayout("hi");
    assert.equal(layout.bgWidth, TEXT_MIN_WIDTH);
    assert.equal(layout.bgHeight, 14 + 18); // 2*paddingY + 2px 容差 + 1 行
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

describe("布局统一：命中 / 绘制共用同一布局", () => {
  const textAnn = {
    id: "t1",
    type: "text" as const,
    position: { x: 100, y: 80 },
    text: "点击位置即气泡锚点",
  };

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
