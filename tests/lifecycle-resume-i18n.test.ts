import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const LIFECYCLE_SOURCE = resolve(
  process.cwd(),
  "src/entrypoints/background/lifecycle.ts"
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

const RESUME_I18N_KEYS = [
  "resumeSessionNotFound",
  "sessionNotContinuable",
  "failedToReadTabForResume",
];

test("lifecycle 续录流程用户可见错误必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(LIFECYCLE_SOURCE, "utf8");
  assert.ok(
    !source.includes("未找到中断会话"),
    "不得硬编码续录会话未找到的错误提示"
  );
  assert.ok(
    !source.includes("该会话未处于可继续状态"),
    "不得硬编码会话不可续录的提示"
  );
  assert.ok(
    !source.includes("无法读取当前标签页"),
    "不得硬编码当前标签页读取失败的提示"
  );
});

test("lifecycle 续录流程新增 i18n 词条必须双语齐全且 en 无中文字符", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");

  for (const key of RESUME_I18N_KEYS) {
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

test("resumeSessionNotFound 占位符必须双语齐全且可被 t() 替换", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = loadDict(locale);
    assert.ok(
      dict.resumeSessionNotFound.placeholders?.id,
      `${locale} resumeSessionNotFound 缺少 id 占位符声明`
    );
    assert.ok(
      dict.resumeSessionNotFound.message.includes("$ID$"),
      `${locale} resumeSessionNotFound 文案缺少 $ID$ 占位符`
    );
  }
  const zhResult = loadDict("zh_CN").resumeSessionNotFound.message.replace(
    /\$ID\$/,
    "sess-1"
  );
  assert.ok(zhResult.includes("sess-1"), "zh resumeSessionNotFound 占位符可替换");
  const enResult = loadDict("en").resumeSessionNotFound.message.replace(
    /\$ID\$/,
    "sess-1"
  );
  assert.ok(enResult.includes("sess-1"), "en resumeSessionNotFound 占位符可替换");
});
