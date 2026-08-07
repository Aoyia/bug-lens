import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSilentExportFailureEvent,
  getSilentExportFailure,
  injectAbsolutePathToPrompt,
  resolveSilentExportResult,
  type SilentExportPackResult,
} from "../src/domain/silent-export.ts";

test("静默导出只有后台明确成功时才允许展示成功提示", () => {
  assert.equal(
    getSilentExportFailure(
      { ok: true, session: { silentExportResult: { ok: true } } },
      "导出失败"
    ),
    undefined
  );
  assert.equal(
    getSilentExportFailure(
      {
        ok: true,
        session: { silentExportResult: { ok: false, error: "下载被拒绝" } },
      },
      "导出失败"
    ),
    "下载被拒绝"
  );
  assert.equal(getSilentExportFailure({ ok: true }, "导出失败"), "导出失败");
});

test("resolveSilentExportResult 打包成功且可下载时返回 ok=true", () => {
  const packResult: SilentExportPackResult = {
    ok: true,
    prompt: "prompt",
    blobUrl: "blob:url",
    filename: "bug-lens.zip",
  };
  assert.deepEqual(resolveSilentExportResult(packResult, undefined), {
    ok: true,
  });
});

test("resolveSilentExportResult 无打包结果时返回失败", () => {
  assert.deepEqual(resolveSilentExportResult(undefined, undefined), {
    ok: false,
    error: "导出未返回可下载文件",
  });
});

test("resolveSilentExportResult 打包结果带 error 时返回该 error", () => {
  const packResult: SilentExportPackResult = {
    ok: false,
    error: "ZIP 打包失败",
  };
  assert.deepEqual(resolveSilentExportResult(packResult, undefined), {
    ok: false,
    error: "ZIP 打包失败",
  });
});

test("resolveSilentExportResult ok=true 但缺少可下载文件时仍判定失败", () => {
  const packResult: SilentExportPackResult = { ok: true, prompt: "prompt" };
  assert.deepEqual(resolveSilentExportResult(packResult, undefined), {
    ok: false,
    error: "导出未返回可下载文件",
  });
});

test("resolveSilentExportResult 捕获到异常时优先返回异常信息", () => {
  const packResult: SilentExportPackResult = { ok: true, prompt: "prompt" };
  const caught = new Error("offscreen 文档不可用");
  assert.deepEqual(resolveSilentExportResult(packResult, caught), {
    ok: false,
    error: "Error: offscreen 文档不可用",
  });
});

test("buildSilentExportFailureEvent 产出可恢复的 export 来源 issue 事件", () => {
  const event = buildSilentExportFailureEvent("下载被拒绝", "safe");
  assert.equal(event.type, "capture-issue");
  if (event.type !== "capture-issue") return;
  assert.equal(event.issue.code, "SILENT_EXPORT_FAILED");
  assert.equal(event.issue.source, "export");
  assert.equal(event.issue.recoverable, true);
  assert.match(event.issue.message, /静默导出失败/);
});

test("buildSilentExportFailureEvent 在 safe 模式下对错误信息脱敏", () => {
  const event = buildSilentExportFailureEvent(
    "token=my-secret-token 导出失败",
    "safe"
  );
  if (event.type !== "capture-issue") return;
  assert.doesNotMatch(event.issue.message, /my-secret-token/);
  assert.match(event.issue.message, /REDACTED/);
});

test("buildSilentExportFailureEvent 在 raw 模式下保留原始错误信息", () => {
  const event = buildSilentExportFailureEvent(
    "token=my-secret-token 导出失败",
    "raw"
  );
  if (event.type !== "capture-issue") return;
  assert.match(event.issue.message, /my-secret-token/);
});

test("injectAbsolutePathToPrompt 将中英文 Prompt 模板中的相对文件名替换为实际物理绝对路径", () => {
  const promptZh = `请分析证据包：\n\n文件路径：\nweb-bug-report-123.zip\n\n元数据：...`;
  const resZh = injectAbsolutePathToPrompt(
    promptZh,
    "web-bug-report-123.zip",
    "/Users/zhijian/Downloads/web-bug-report-123.zip"
  );
  assert.equal(
    resZh,
    `请分析证据包：\n\n文件路径：\n/Users/zhijian/Downloads/web-bug-report-123.zip\n\n元数据：...`
  );

  const promptEn = `Please analyze package:\n\nFile Path:\nweb-bug-report-123.zip\n\nMetadata:...`;
  const resEn = injectAbsolutePathToPrompt(
    promptEn,
    "web-bug-report-123.zip",
    "/Users/zhijian/Downloads/web-bug-report-123.zip"
  );
  assert.equal(
    resEn,
    `Please analyze package:\n\nFile Path:\n/Users/zhijian/Downloads/web-bug-report-123.zip\n\nMetadata:...`
  );
});
