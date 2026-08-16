import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const CAPTURE_SOURCE = resolve(
  process.cwd(),
  "src/recording/issue-scene-capture.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

// 改动前存在于 issue-scene-capture.ts drain() 中的硬编码中文用户可见错误文案
const HARDCODED_CHINESE = ["问题现场写入未完成："];

const I18N_KEYS = ["cleanupIssueSceneWriteFailed"];

test("问题现场写入失败明细必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(CAPTURE_SOURCE, "utf8");
  for (const literal of HARDCODED_CHINESE) {
    assert.ok(
      !source.includes(literal),
      `issue-scene-capture.ts 不得硬编码 '${literal}'，应通过 t() 提供`
    );
  }
});

test("问题现场写入失败新增 i18n 词条必须双语齐全且 en 无中文字符", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");

  for (const key of I18N_KEYS) {
    assert.ok(key in zhDict, `i18n key '${key}' 缺失于 zh_CN/messages.json`);
    assert.ok(key in enDict, `i18n key '${key}' 缺失于 en/messages.json`);
    assert.ok(zhDict[key].message.trim().length > 0, `zh 文案 '${key}' 为空`);
    assert.ok(enDict[key].message.trim().length > 0, `en 文案 '${key}' 为空`);
    assert.ok(
      !/[\u4e00-\u9fff]/.test(enDict[key].message),
      `en 文案 '${key}' 不得包含中文`
    );
  }
});
