import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { t, type I18nBundle } from "../src/shared/i18n.ts";

const SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/content/collector/selection-overlay.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

test("selection-overlay 的本地化键在 en 与 zh_CN 字典中均存在且非空", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = loadDict(locale);
    for (const key of ["removeSelectionMark", "issueSceneCaptureFailed"]) {
      assert.ok(dict[key], `${locale} 缺少 ${key}`);
      assert.ok(
        dict[key].message.trim().length > 0,
        `${locale} 的 ${key} 文案为空`
      );
    }
  }
});

test("selection-overlay 不再包含硬编码中文用户可见文案", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(!source.includes("移除该标记"), "移除按钮 tooltip 应走 i18n");
  assert.ok(!source.includes("问题现场采集失败"), "采集失败弹窗应走 i18n");
  assert.ok(!source.includes('"未知错误"'), "未知错误应复用 unknownError 键");
});

test("i18n: 注入 zh_CN 字典时移除标记 tooltip 渲染为中文", () => {
  const bundle: I18nBundle = {
    locale: "zh-CN",
    dict: {
      removeSelectionMark: { message: "移除该标记" },
      issueSceneCaptureFailed: { message: "问题现场采集失败：$ERROR$" },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("removeSelectionMark"), "移除该标记");
    assert.equal(
      t("issueSceneCaptureFailed", ["timeout"]),
      "问题现场采集失败：timeout"
    );
  } finally {
    (globalThis as any).window = prev;
  }
});

test("i18n: 注入 en 字典时移除标记 tooltip 渲染为英文", () => {
  const bundle: I18nBundle = {
    locale: "en-US",
    dict: {
      removeSelectionMark: { message: "Remove this mark" },
      issueSceneCaptureFailed: {
        message: "Issue scene capture failed: $ERROR$",
      },
    },
  };
  const prev = globalThis.window;
  (globalThis as any).window = { __WEB_BUG_REPORT_I18N__: bundle };
  try {
    assert.equal(t("removeSelectionMark"), "Remove this mark");
    assert.equal(
      t("issueSceneCaptureFailed", ["boom"]),
      "Issue scene capture failed: boom"
    );
  } finally {
    (globalThis as any).window = prev;
  }
});

test("selection-overlay 采集失败路径不再使用阻塞式原生 alert()", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.ok(
    !source.includes("alert("),
    "采集失败反馈应走扩展自身非阻塞 Toast，而非阻塞页面的原生 alert()"
  );
});

test("selection-overlay 采集失败路径通过 onError 依赖上报错误", () => {
  const source = readFileSync(SOURCE, "utf8");
  assert.match(
    source,
    /this\.deps\.onError\(\s*t\(\s*"issueSceneCaptureFailed"/,
    "失败分支应调用注入的 onError 回调并携带本地化错误文案"
  );
});

test("interaction-collector 为选区采集失败接线了非阻塞 error 音色 Toast", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/entrypoints/content/interaction-collector.ts"),
    "utf8"
  );
  assert.match(
    source,
    /onError:\s*\(message\)\s*=>\s*widget\.showToast\(message,\s*5_500,\s*"error"\)/,
    "选区失败应复用导出失败的 error 音色 Toast 模式，而非原生对话框"
  );
});
