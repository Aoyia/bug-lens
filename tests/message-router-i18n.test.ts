import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROUTER_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/background/message-router.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

const ROUTER_I18N_KEYS = ["cannotDeleteActiveRecording"];

test("message-router 用户可见错误必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(ROUTER_SOURCE, "utf8");
  assert.ok(
    !source.includes('"不能删除正在录制的会话"'),
    "不得硬编码中文错误提示"
  );
});

test("message-router 新增 i18n 词条必须双语齐全且 en 无中文字符", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");

  for (const key of ROUTER_I18N_KEYS) {
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
