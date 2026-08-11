import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createOverlayMarkup } from "../src/screenshot/overlay-template.ts";
import { t, type I18nBundle } from "../src/shared/i18n.ts";

/**
 * 截图工具栏 tooltip 国际化回归测试（260811-toolbar-tooltip-i18n）。
 * 锁定：工具栏所有按钮 tooltip 必须走 t()，禁止硬编码中文/中英混杂文案。
 */

const HARDCODED_LEFTOVERS = [
  "撤销 (Ctrl+Z / Cmd+Z)",
  "一键清空标注 (Clear All)",
];

test("overlay-template: 撤销/清空按钮 tooltip 不再硬编码中文", () => {
  const markup = createOverlayMarkup();
  for (const leftover of HARDCODED_LEFTOVERS) {
    assert.ok(
      !markup.includes(leftover),
      `模板不应包含硬编码文案: ${leftover}`
    );
  }
});

test("overlay-template: 撤销/清空按钮 tooltip 走 t()（无 chrome 环境回退为 key）", () => {
  const markup = createOverlayMarkup();
  // 测试环境无 chrome.i18n 且无注入字典时，t() 回退返回 key 本身
  assert.ok(
    markup.includes('title="shotUndo"'),
    'undo 按钮应使用 t("shotUndo")'
  );
  assert.ok(
    markup.includes('title="shotClear"'),
    'clear 按钮应使用 t("shotClear")'
  );
  // 其余 7 个按钮保持既有 t() 键不变
  for (const key of [
    "shotRect",
    "shotArrow",
    "shotPrivacy",
    "shotText",
    "shotStyleAdjust",
    "shotCancel",
    "shotConfirm",
  ]) {
    assert.ok(markup.includes(`title="${key}"`), `按钮应使用 t("${key}")`);
  }
});

test("i18n: shotUndo/shotClear 在 en 与 zh_CN 字典中均存在且非空", () => {
  const root = join(import.meta.dirname, "..", "src", "_locales");
  for (const locale of ["en", "zh_CN"]) {
    const dict = JSON.parse(
      readFileSync(join(root, locale, "messages.json"), "utf8")
    ) as Record<string, { message: string }>;
    for (const key of ["shotUndo", "shotClear"]) {
      assert.ok(dict[key], `${locale} 缺少 ${key}`);
      assert.ok(
        dict[key].message.trim().length > 0,
        `${locale} 的 ${key} 文案为空`
      );
    }
  }
});

test("i18n: 注入 en 字典时撤销/清空 tooltip 渲染为英文", () => {
  const bundle: I18nBundle = {
    locale: "en-US",
    dict: {
      shotUndo: { message: "Undo (Ctrl+Z / Cmd+Z)" },
      shotClear: { message: "Clear all annotations" },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("shotUndo"), "Undo (Ctrl+Z / Cmd+Z)");
    assert.equal(t("shotClear"), "Clear all annotations");
  } finally {
    (globalThis as any).window = prev;
  }
});

test("i18n: 注入 zh_CN 字典时撤销/清空 tooltip 渲染为中文（无英文尾巴）", () => {
  const bundle: I18nBundle = {
    locale: "zh-CN",
    dict: {
      shotUndo: { message: "撤销 (Ctrl+Z / Cmd+Z)" },
      shotClear: { message: "一键清空标注" },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("shotUndo"), "撤销 (Ctrl+Z / Cmd+Z)");
    assert.equal(t("shotClear"), "一键清空标注");
    assert.ok(!t("shotClear").includes("Clear All"), "中文文案不应带英文尾巴");
  } finally {
    (globalThis as any).window = prev;
  }
});
