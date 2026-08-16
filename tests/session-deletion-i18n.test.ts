import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const SOURCE_PATH = resolve(process.cwd(), "src/storage/session-deletion.ts");

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<string, { message: string }>;
}

test("会话删除事务中止错误必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(
    !source.includes("会话删除事务已中止"),
    "session-deletion.ts 不得硬编码 '会话删除事务已中止'，应通过 i18n 提供"
  );
  assert.ok(
    source.includes('t("sessionDeleteAborted"'),
    "session-deletion.ts 应使用 sessionDeleteAborted key 提供事务中止错误"
  );
});

test("sessionDeleteAborted key 必须双语言齐全且 en 文案不得混入中文", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");
  assert.ok(
    zhDict.sessionDeleteAborted?.message,
    "zh_CN/messages.json 缺少 sessionDeleteAborted"
  );
  assert.ok(
    enDict.sessionDeleteAborted?.message,
    "en/messages.json 缺少 sessionDeleteAborted"
  );
  assert.ok(
    !/[\u4e00-\u9fff]/.test(enDict.sessionDeleteAborted.message),
    "en 文案 'sessionDeleteAborted' 不得混入中文"
  );
});
