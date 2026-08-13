import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const recordPanel = readFileSync(
  resolve(process.cwd(), "src/components/popup/RecordPanel.tsx"),
  "utf8"
);

const zhDict = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/_locales/zh_CN/messages.json"),
    "utf8"
  )
);

const enDict = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/_locales/en/messages.json"), "utf8")
);

test("截图按钮进入 pending 态：禁用按钮并提供截图反馈，防止双击重复触发截图", () => {
  // 截图触发后 popup 会保持打开直到后台完成 captureVisibleTab + overlay 注入，
  // 期间按钮必须禁用并提供反馈，避免用户误以为无响应而再次点击（发出两次
  // screenshot/trigger，叠出两个截图 overlay）——与「开始录制」的 starting 态对齐。
  assert.match(
    recordPanel,
    /const \[capturing, setCapturing\] = useState\(false\)/,
    "RecordPanel 必须声明 capturing 状态"
  );

  assert.match(
    recordPanel,
    /disabled=\{!canCapture \|\| capturing\}/,
    "截图按钮必须在截图进行中（capturing）时禁用"
  );

  assert.match(
    recordPanel,
    /capturing \? t\("screenshotCapturing"\)/,
    "截图按钮必须在进行中显示截图反馈文案"
  );

  assert.match(
    recordPanel,
    /setCapturing\(true\)/,
    "handleTakeScreenshot 必须在发送截图消息前置位 pending 状态"
  );

  assert.match(
    recordPanel,
    /setCapturing\(false\)/,
    "handleTakeScreenshot 必须在截图失败时复位 pending 状态"
  );
});

test("截图 pending 文案 i18n key 必须同时存在于中英双语 locale 包", () => {
  for (const [dict, label] of [
    [zhDict, "zh_CN"],
    [enDict, "en"],
  ] as const) {
    assert.ok(
      "screenshotCapturing" in dict,
      `${label}/messages.json 必须定义 'screenshotCapturing'`
    );
  }
});
