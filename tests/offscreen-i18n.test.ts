import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const OFFSCREEN_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/offscreen/index.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

// 改动前存在于 offscreen/index.ts 的硬编码中文/英文用户可见错误文案
const HARDCODED_LITERALS = ['"MediaRecorder error"'];

const OFFSCREEN_I18N_KEYS = ["mediaRecorderErrorEvent"];

const CJK = /[\u4e00-\u9fff]/;

test("offscreen 用户可见错误文案必须走 i18n（禁止硬编码）", () => {
  const source = readFileSync(OFFSCREEN_SOURCE, "utf8");
  for (const literal of HARDCODED_LITERALS) {
    assert.ok(
      !source.includes(literal),
      `offscreen/index.ts 不得硬编码 '${literal}'，应通过 t() 提供`
    );
  }
});

test("offscreen 新增 i18n 词条必须双语齐全且 en 无中文字符", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");
  for (const key of OFFSCREEN_I18N_KEYS) {
    assert.ok(zhDict[key]?.message, `zh_CN 词典缺少词条 ${key}`);
    assert.ok(enDict[key]?.message, `en 词典缺少词条 ${key}`);
    assert.ok(
      !CJK.test(enDict[key].message),
      `en 词典词条 ${key} 不得包含中文字符`
    );
  }
});
