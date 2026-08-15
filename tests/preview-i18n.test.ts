import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const VIEW_SOURCE = resolve(
  process.cwd(),
  "src/preview/evidence-report-view.ts"
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

// 预览页框架层新增的本地化 key（复用 issueScenes 的除外）
const NEW_KEYS = [
  "recordingPreviewFallback",
  "previewDuration",
  "unknownDuration",
  "metricSteps",
  "metricDeleted",
  "metricScreenshots",
  "restoreLabelSteps",
  "restoreLabelLogs",
  "restoreLabelRequests",
  "clipExportNoVideo",
  "reportDataMissing",
  "qualityComplete",
  "qualityPartial",
  "qualityFailed",
  "videoDecodeFailed",
  "noVideoPlayback",
  "aiPromptCopied",
  "zipPathCopied",
  "exportSuccessCopied",
];

// 硬编码中文用户可见文案（改动前存在于 evidence-report-view.ts 的字符串字面量）
const HARDCODED_CHINESE = [
  "录制预览",
  "时长未知",
  "有效步骤",
  "已删除",
  "步骤截图",
  "问题现场",
  "步骤",
  "日志",
  "请求",
  "当前会话无可用录像，无法导出视频片段",
];

test("预览页框架层用户可见文案必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(VIEW_SOURCE, "utf8");
  for (const literal of HARDCODED_CHINESE) {
    assert.ok(
      !source.includes(`"${literal}"`) && !source.includes(`'${literal}'`),
      `evidence-report-view.ts 不得硬编码 '${literal}'，应通过 t() 提供`
    );
  }
  // 保留词也应走 t()：不出现中文引号包裹的字面量
  assert.ok(
    !/"[\u4e00-\u9fff]/.test(source),
    "evidence-report-view.ts 不应存在含中文的双引号字符串字面量"
  );
});

test("预览页框架层新 key 必须双语言齐全且 en 文案不得混入中文", () => {
  const zhDict = loadDict("zh_CN");
  const enDict = loadDict("en");
  for (const key of NEW_KEYS) {
    assert.ok(key in zhDict, `i18n key '${key}' 缺失于 zh_CN/messages.json`);
    assert.ok(key in enDict, `i18n key '${key}' 缺失于 en/messages.json`);
    assert.ok(zhDict[key].message.trim().length > 0, `zh 文案 '${key}' 为空`);
    assert.ok(enDict[key].message.trim().length > 0, `en 文案 '${key}' 为空`);
    assert.ok(
      !/[\u4e00-\u9fff]/.test(enDict[key].message),
      `en 文案 '${key}' 不得混入中文`
    );
  }
});

test("previewDuration 占位符必须双语言齐全且可被 t() 替换", () => {
  for (const locale of ["zh_CN", "en"] as const) {
    const dict = loadDict(locale);
    assert.ok(
      dict.previewDuration.placeholders?.seconds,
      `${locale} previewDuration 缺少 seconds 占位符声明`
    );
    assert.ok(
      dict.previewDuration.message.includes("$SECONDS$"),
      `${locale} previewDuration 文案缺少 $SECONDS$ 占位符`
    );
  }
  // 替换结果校验（非扩展环境回退字典路径）
  const zhResult = loadDict("zh_CN").previewDuration.message.replace(
    /\$SECONDS\$/,
    "32"
  );
  assert.equal(zhResult, "32 秒");
  const enResult = loadDict("en").previewDuration.message.replace(
    /\$SECONDS\$/,
    "32"
  );
  assert.equal(enResult, "32 sec");
});
