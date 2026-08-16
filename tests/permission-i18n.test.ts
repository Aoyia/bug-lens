import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const PERMISSION_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/permission/index.ts"
);

function loadDict(locale: "zh_CN" | "en") {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `src/_locales/${locale}/messages.json`),
      "utf8"
    )
  ) as Record<
    string,
    { message: string; placeholders?: Record<string, unknown> }
  >;
}

const PERMISSION_KEYS = [
  "permissionStatusPleaseWait",
  "permissionStatusProcessing",
  "permissionStatusAuthIncomplete",
  "permissionErrorNoPendingRequest",
  "permissionStatusPromptSelectAllow",
  "permissionErrorNoAccess",
  "permissionStatusGrantedStarting",
  "permissionStatusRecordingStartedClosing",
  "permissionErrorStartFailed",
];

test("权限中转页面逻辑必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(PERMISSION_SOURCE, "utf8");
  // 检查源码中不含有非注释的中文硬编码字符串
  assert.ok(
    !source.includes('"未找到待处理的录制请求'),
    "不得硬编码中文提示"
  );
  assert.ok(
    !source.includes('"请在浏览器提示框中选择'),
    "不得硬编码中文提示"
  );
  assert.ok(
    !source.includes('"未授予全站访问权限'),
    "不得硬编码中文提示"
  );
  assert.ok(
    !source.includes('"已获授权，正在启动录制'),
    "不得硬编码中文提示"
  );
  assert.ok(
    !source.includes('"启动录制失败"'),
    "不得硬编码中文提示"
  );
  assert.ok(
    !source.includes('"录制已成功启动！正在关闭中转页'),
    "不得硬编码中文提示"
  );
});

test("权限页面新增 i18n 词条必须双语齐全且 en 无中文字符", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");

  for (const key of PERMISSION_KEYS) {
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
