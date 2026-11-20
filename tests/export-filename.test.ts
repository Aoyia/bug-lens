import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { injectAbsolutePathToPrompt } from "../src/domain/silent-export.ts";
import {
  buildScreenshotZipFilename,
  buildSessionReportFilename,
  formatLocalTimestamp,
  resolveTicketTargetZipName,
} from "../src/shared/export-filename.ts";
import {
  clearPackCache,
  getPackWorkspaceDir,
  openPack,
} from "../src/triage-cli/pack/open.ts";
import {
  buildRealScreenshotZipBytes,
  buildRealSessionZipBytes,
} from "./helpers/triage-cli-fixture.ts";

test("formatLocalTimestamp 使用本地时间并支持 minute/second 精度与两位补零", () => {
  const localMorning = new Date(2026, 0, 5, 2, 4, 9);
  assert.equal(
    formatLocalTimestamp(localMorning, "minute"),
    "2026-01-05_02-04"
  );
  assert.equal(
    formatLocalTimestamp(localMorning, "second"),
    "2026-01-05_02-04-09"
  );
  assert.equal(formatLocalTimestamp(localMorning), "2026-01-05_02-04-09");

  const invalid = new Date("invalid");
  assert.match(
    formatLocalTimestamp(invalid, "minute"),
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/
  );
});

test("buildSessionReportFilename 生成 sessionId 在中间、本地分钟时间在后的文件名", () => {
  const localTime = new Date(2026, 10, 19, 18, 24, 55);
  assert.equal(
    buildSessionReportFilename(
      "9bf8fef7-1234-5678-9abc-def012345678",
      localTime
    ),
    "web-bug-report-9bf8fef7-2026-11-19_18-24.zip"
  );
  // 短 ID 与含特殊字符的 ID 都能安全生成
  assert.equal(
    buildSessionReportFilename("ab:c", localTime),
    "web-bug-report-ab_c-2026-11-19_18-24.zip"
  );
});

test("buildScreenshotZipFilename 保留秒数并将日期与时间分隔符统一为下划线", () => {
  const localTime = new Date(2026, 10, 19, 18, 24, 5);
  assert.equal(
    buildScreenshotZipFilename(localTime),
    "bug-lens-screenshot-2026-11-19_18-24-05.zip"
  );
});

test("resolveTicketTargetZipName 优先提取已导出文件名，未导出时回退带时间默认名", () => {
  const localTime = new Date(2026, 10, 19, 9, 8, 7);
  assert.equal(
    resolveTicketTargetZipName(
      "9bf8fef7-xxxx",
      '"/Users/zhijian/Downloads/web-bug-report-9bf8fef7-2026-11-19_09-08.zip"',
      localTime
    ),
    "web-bug-report-9bf8fef7-2026-11-19_09-08.zip"
  );
  assert.equal(
    resolveTicketTargetZipName(
      "9bf8fef7-xxxx",
      "C:\\Users\\tester\\Downloads\\web-bug-report-9bf8fef7-2026-11-19_09-08.zip",
      localTime
    ),
    "web-bug-report-9bf8fef7-2026-11-19_09-08.zip"
  );
  assert.equal(
    resolveTicketTargetZipName("9bf8fef7-xxxx", undefined, localTime),
    "web-bug-report-9bf8fef7-2026-11-19_09-08.zip"
  );
});

test("injectAbsolutePathToPrompt 与带时间戳文件名协作精确替换绝对路径", () => {
  const filename = buildSessionReportFilename(
    "9bf8fef7-1234",
    new Date(2026, 10, 19, 18, 24, 0)
  );
  const absPath = `/Users/zhijian/Downloads/${filename}`;
  const promptZh = `分析包：\n\n文件路径：\n${filename}\n\n摘要：...`;
  assert.equal(
    injectAbsolutePathToPrompt(promptZh, filename, absPath),
    `分析包：\n\n文件路径：\n${absPath}\n\n摘要：...`
  );
});

test("triage-cli openPack 兼容带时间戳的录制报告与截图 ZIP 命名格式", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bug-lens-filename-cli-"));
  const prevWs = process.env.BUG_LENS_CLI_WORKSPACE;
  process.env.BUG_LENS_CLI_WORKSPACE = join(tempRoot, "ws");
  try {
    clearPackCache();
    const sessionName = buildSessionReportFilename(
      "d6135e69-0000",
      new Date(2026, 10, 19, 18, 24, 0)
    );
    const screenshotName = buildScreenshotZipFilename(
      new Date(2026, 10, 19, 18, 24, 5)
    );
    const sessionZip = join(tempRoot, sessionName);
    const screenshotZip = join(tempRoot, screenshotName);
    writeFileSync(sessionZip, buildRealSessionZipBytes());
    writeFileSync(screenshotZip, await buildRealScreenshotZipBytes());

    const loadedSession = openPack(sessionZip);
    assert.equal(loadedSession.kind, "session");
    assert.ok(
      getPackWorkspaceDir(loadedSession)?.includes(
        "web-bug-report-d6135e69-2026-11-19_18-24"
      )
    );

    const loadedByShortId = openPack("d6135e69");
    assert.equal(
      realpathSync(getPackWorkspaceDir(loadedByShortId)!),
      realpathSync(getPackWorkspaceDir(loadedSession)!)
    );

    const loadedScreenshot = openPack(screenshotZip);
    assert.equal(loadedScreenshot.kind, "screenshot");
    assert.ok(
      getPackWorkspaceDir(loadedScreenshot)?.includes(
        "bug-lens-screenshot-2026-11-19_18-24-05"
      )
    );
  } finally {
    clearPackCache();
    if (prevWs === undefined) delete process.env.BUG_LENS_CLI_WORKSPACE;
    else process.env.BUG_LENS_CLI_WORKSPACE = prevWs;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
