import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("page-shell 委托复制失败通知必须走 i18n（禁止硬编码中文）", () => {
  const pageShellCode = readFileSync(
    resolve(process.cwd(), "src/preview/page-shell.ts"),
    "utf8"
  );
  const zhDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
      "utf8"
    )
  );
  const enDict = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src/_locales/en/messages.json"),
      "utf8"
    )
  );

  // 委托复制（.code-copy-btn / .copy-locator-btn）失败路径不得残留硬编码中文，
  // 必须复用现有 copyFailed key，与 NetworkTab / Playwright / 图片查看器保持一致
  assert.ok(
    !pageShellCode.includes("复制失败"),
    "page-shell 不得硬编码 '复制失败'，应通过 copyFailed key 提供"
  );

  const copyFailedUsageCount = pageShellCode.split('t("copyFailed"').length - 1;
  assert.equal(
    copyFailedUsageCount,
    2,
    '两处委托复制失败路径都应使用 t("copyFailed")'
  );

  // key 必须在双语言 bundle 中齐全，且 en 文案不得混入中文
  assert.ok(
    "copyFailed" in zhDict,
    "i18n key 'copyFailed' missing in zh_CN/messages.json"
  );
  assert.ok(
    "copyFailed" in enDict,
    "i18n key 'copyFailed' missing in en/messages.json"
  );
  assert.ok(
    !/[\u4e00-\u9fff]/.test(enDict.copyFailed.message),
    "en bundle 的 'copyFailed' 不得包含中文字符"
  );

  // zh 文案与原硬编码字符串逐字一致，保证中文界面零视觉变化
  assert.equal(zhDict.copyFailed.message, "复制失败：$ERROR$");
});
